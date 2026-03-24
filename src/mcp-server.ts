#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BrowserManager } from './browser/browser-manager.js';
import { ExtractionPipeline } from './extraction/extraction-pipeline.js';
import { ExtractionOptions, DEFAULT_VIEWPORTS } from './types/index.js';
import { setApiKey } from './auth/config-manager.js';
import { checkAccess, verifyApiKey } from './auth/usage-gate.js';
import {
  discoverElements,
  injectLabelOverlay,
  removeLabelOverlay,
  formatElementLegend,
} from './extraction/element-discovery.js';
// Email tools disabled — uncomment when ready to test
// import {
//   getAccount,
//   setAccount,
//   getProviderPreset,
//   listAccounts,
//   ImapCredentials,
// } from './email/credential-manager.js';
// import {
//   testConnection,
//   searchEmails,
//   getEmailHtml,
// } from './email/imap-client.js';
// import { preprocessEmailHtml, extractBaseUrl } from './email/email-html-preprocessor.js';

const browserManager = new BrowserManager();
let pipeline: ExtractionPipeline;

const server = new Server(
  {
    name: 'snipcss',
    version: '1.0.6',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'extract_css_convert_tailwind',
      description:
        'Extract the CSS of an element subtree or get a Tailwind-converted version. ' +
        'Navigates to the URL, finds the element by CSS selector, extracts all matched CSS rules ' +
        '(including media queries, hover states, pseudo-elements), and converts to Tailwind utility classes.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to extract from',
          },
          selector: {
            type: 'string',
            description:
              'CSS selector for the target element (e.g., ".hero-section", "#main-nav", "header")',
          },
          viewport: {
            type: 'string',
            enum: ['all', 'desktop', 'tablet', 'mobile'],
            default: 'all',
            description:
              'Viewport(s) to extract CSS for. "all" extracts at desktop, tablet, and mobile breakpoints.',
          },
          resolveVariables: {
            type: 'boolean',
            default: true,
            description:
              'Whether to resolve CSS custom properties (--variables) to their computed values',
          },
          includeHoverStates: {
            type: 'boolean',
            default: true,
            description:
              'Whether to extract :hover, :active, and :focus pseudo-state styles',
          },
        },
        required: ['url', 'selector'],
      },
    },
    {
      name: 'set_api_key',
      description:
        'Set your SnipCSS Pro API key for unlimited CSS extractions. ' +
        'Find your API key on your SnipCSS dashboard at snipcss.com/dashboard after upgrading to Pro.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          api_key: {
            type: 'string',
            description: 'Your SnipCSS Pro API key from your dashboard',
          },
        },
        required: ['api_key'],
      },
    },
    {
      name: 'list_page_elements',
      description:
        'Navigate to a URL and list the major page elements with their CSS selectors, semantic types, ' +
        'hierarchy context, and visual properties. Scans 2-3 levels deep to find cards, widgets, and forms. ' +
        'Useful for discovering which elements to extract before calling extract_css_convert_tailwind.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to analyze',
          },
          // emailUid: {
          //   type: 'number',
          //   description: 'Email UID to load and analyze (alternative to url). Use search_emails to find UIDs.',
          // },
          // account: {
          //   type: 'string',
          //   description: 'Email account label (if using emailUid with multiple configured accounts)',
          // },
        },
        required: ['url'],
      },
    },
    {
      name: 'screenshot_page',
      description:
        'Take an annotated screenshot of a webpage with numbered labels (#1, #2, #3...) overlaid on ' +
        'discovered elements. Returns the screenshot image plus a legend mapping each number to its ' +
        'CSS selector, semantic type, size, and content preview. Use this to visually identify which ' +
        'element a user is describing (e.g., "the sidebar", "the pricing card") before extracting it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to screenshot',
          },
          // emailUid: {
          //   type: 'number',
          //   description: 'Email UID to load and screenshot (alternative to url). Use search_emails to find UIDs.',
          // },
          // account: {
          //   type: 'string',
          //   description: 'Email account label (if using emailUid with multiple configured accounts)',
          // },
          viewport: {
            type: 'string',
            enum: ['desktop', 'tablet', 'mobile'],
            default: 'desktop',
            description: 'Viewport size for the screenshot',
          },
        },
      },
    },
    // Email tools disabled — uncomment when ready to test
    // {
    //   name: 'configure_email',
    //   ...
    // },
    // {
    //   name: 'search_emails',
    //   ...
    // },
    // {
    //   name: 'extract_email_design',
    //   ...
    // },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'set_api_key') {
    try {
      const apiKey = args!.api_key as string;
      const result = await verifyApiKey(apiKey);
      if (result.isPro) {
        setApiKey(apiKey);
        return {
          content: [{
            type: 'text',
            text: `API key verified and saved. Welcome, ${result.email}! You now have unlimited extractions.`,
          }],
        };
      }
      return {
        content: [{
          type: 'text',
          text: `API key could not be verified as Pro. ${result.error || 'Please check your key and ensure you have an active Pro subscription.'}`,
        }],
        isError: true,
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error verifying API key: ${error.message}`,
        }],
        isError: true,
      };
    }
  }

  if (name === 'extract_css_convert_tailwind') {
    try {
      // Check usage/Pro access before launching browser
      const access = await checkAccess();
      if (!access.allowed) {
        return {
          content: [{
            type: 'text',
            text: access.message || 'Access denied. Please set your API key with the set_api_key tool.',
          }],
          isError: true,
        };
      }

      if (!pipeline) {
        await browserManager.launch();
        pipeline = new ExtractionPipeline(browserManager);
      }

      const options: ExtractionOptions = {
        viewport: (args?.viewport as string) || 'all',
        resolveVariables: args?.resolveVariables !== false,
        includeHoverStates: args?.includeHoverStates !== false,
      };

      const result = await pipeline.extract(
        args!.url as string,
        args!.selector as string,
        options
      );

      let output = formatExtractionResult(
        result,
        args!.url as string,
        args!.selector as string
      );

      // Append remaining extractions notice for free tier
      if (access.message) {
        output += `\n\n---\n_${access.message}_`;
      }

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error extracting CSS: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Email tool handlers disabled — uncomment when ready to test
  // if (name === 'configure_email') { ... }
  // if (name === 'search_emails') { ... }
  // if (name === 'extract_email_design') { ... }

  if (name === 'list_page_elements') {
    try {
      await browserManager.launch();

      let bp;
      let sourceLabel: string;

      // Email mode disabled — uncomment when ready to test
      // if (args?.emailUid) {
      //   const creds = getAccount(args?.account as string | undefined);
      //   if (!creds) {
      //     return {
      //       content: [{ type: 'text', text: 'No email account configured. Use configure_email first.' }],
      //       isError: true,
      //     };
      //   }
      //   const email = await getEmailHtml(creds, args.emailUid as number);
      //   const processedHtml = preprocessEmailHtml(email.html);
      //   const baseUrl = extractBaseUrl(email.html);
      //   bp = await browserManager.createPageFromHtml(processedHtml, baseUrl);
      //   sourceLabel = `email "${email.subject}" (UID: ${args.emailUid})`;
      // } else
      if (args?.url) {
        bp = await browserManager.createPage(args.url as string);
        sourceLabel = args.url as string;
      } else {
        return {
          content: [{ type: 'text', text: 'url is required.' }],
          isError: true,
        };
      }

      const elements = await discoverElements(bp.page);
      await browserManager.closePage(bp);

      let output = `## Page Elements for ${sourceLabel}\n\n`;
      output += `Found ${elements.length} elements:\n\n`;
      output += `| # | Selector | Type | Size | Context | Preview |\n`;
      output += `|---|----------|------|------|---------|--------|\n`;

      for (const el of elements) {
        const preview = el.textPreview.substring(0, 40).replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const bgNote = el.backgroundColor && el.backgroundColor !== 'transparent' ? ` bg:${el.backgroundColor}` : '';
        output += `| #${el.label} | \`${el.selector}\` | ${el.semanticType} | ${el.rect.width}x${el.rect.height}${bgNote} | ${el.parentContext} | ${preview} |\n`;
      }

      output += `\n_Use screenshot_page to see these elements visually with numbered labels._`;

      return {
        content: [{ type: 'text', text: output }],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error listing elements: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'screenshot_page') {
    try {
      await browserManager.launch();

      // Determine viewport
      const viewportName = (args?.viewport as string) || 'desktop';
      const viewportConfig = viewportName === 'tablet'
        ? DEFAULT_VIEWPORTS.ipad
        : viewportName === 'mobile'
          ? DEFAULT_VIEWPORTS.iphonexs
          : DEFAULT_VIEWPORTS.default;

      let bp;
      let pageTitle: string;

      // Email mode disabled — uncomment when ready to test
      // if (args?.emailUid) {
      //   const creds = getAccount(args?.account as string | undefined);
      //   if (!creds) {
      //     return {
      //       content: [{ type: 'text', text: 'No email account configured. Use configure_email first.' }],
      //       isError: true,
      //     };
      //   }
      //   const email = await getEmailHtml(creds, args.emailUid as number);
      //   const processedHtml = preprocessEmailHtml(email.html);
      //   const baseUrl = extractBaseUrl(email.html);
      //   bp = await browserManager.createPageFromHtml(processedHtml, baseUrl);
      //   pageTitle = `email "${email.subject}" (UID: ${args.emailUid})`;
      // } else
      if (args?.url) {
        bp = await browserManager.createPage(args.url as string);
        await browserManager.navigatePage(bp, args.url as string);
        pageTitle = args.url as string;
      } else {
        return {
          content: [{ type: 'text', text: 'url is required.' }],
          isError: true,
        };
      }

      // Set viewport if non-default
      if (viewportName !== 'desktop') {
        await bp.page.setViewportSize({
          width: viewportConfig.width,
          height: viewportConfig.height,
        });
        // Allow reflow
        await bp.page.waitForTimeout(500);
      }

      // Discover elements
      const elements = await discoverElements(bp.page);

      // Inject labeled overlay
      await injectLabelOverlay(bp.page, elements);

      // Take screenshot
      const screenshotBuffer = await bp.page.screenshot({
        fullPage: true,
        type: 'png',
      });

      // Remove overlay
      await removeLabelOverlay(bp.page);
      await browserManager.closePage(bp);

      // Build legend text
      const legend = formatElementLegend(elements);

      return {
        content: [
          {
            type: 'image' as const,
            data: screenshotBuffer.toString('base64'),
            mimeType: 'image/png',
          },
          {
            type: 'text',
            text: `## Annotated Screenshot: ${pageTitle}\n\nViewport: ${viewportConfig.width}x${viewportConfig.height} (${viewportName})\n${elements.length} elements labeled:\n\n${legend}\n\n_Use the # number with list_page_elements output, then call extract_css_convert_tailwind with the selector._`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `Error taking screenshot: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

function formatExtractionResult(
  result: any,
  url: string,
  selector: string
): string {
  const sections: string[] = [];

  sections.push(`## Extracted CSS for \`${selector}\` on ${url}\n`);

  sections.push('### HTML\n');
  sections.push('```html');
  sections.push(result.html);
  sections.push('```\n');

  sections.push('### CSS\n');
  sections.push('```css');
  sections.push(result.css);
  sections.push('```\n');

  if (result.tailwindHtml) {
    sections.push('### Tailwind HTML\n');
    sections.push('```html');
    sections.push(result.tailwindHtml);
    sections.push('```\n');
  }

  if (result.tailwindBodyClasses) {
    sections.push('### Tailwind Body Classes\n');
    sections.push('```');
    sections.push(result.tailwindBodyClasses);
    sections.push('```\n');
  }

  if (result.fonts && result.fonts.length > 0) {
    sections.push('### Fonts Used\n');
    for (const font of result.fonts) {
      sections.push(`- **${font.font_family}** (${font.font_weight || 'normal'}, ${font.font_style || 'normal'})`);
    }
    sections.push('');
  }

  if (result.cssVariables && Object.keys(result.cssVariables).length > 0) {
    sections.push('### CSS Variables Resolved\n');
    for (const [name, value] of Object.entries(result.cssVariables)) {
      sections.push(`- \`${name}\`: \`${value}\``);
    }
  }

  return sections.join('\n');
}

function installStdioErrorGuards() {
  const handleStreamError = (error: NodeJS.ErrnoException) => {
    if (error?.code === 'EPIPE') {
      void browserManager.close().finally(() => process.exit(0));
      return;
    }
    void browserManager.close().finally(() => process.exit(1));
  };

  process.stdout.on('error', handleStreamError);
  process.stderr.on('error', handleStreamError);
}

// Start the server
async function main() {
  installStdioErrorGuards();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SnipCSS MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});

// Prevent unhandled errors from crashing the server process
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  await browserManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await browserManager.close();
  process.exit(0);
});
