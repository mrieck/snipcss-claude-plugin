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
import {
  getAccount,
  setAccount,
  getProviderPreset,
  listAccounts,
  ImapCredentials,
} from './email/credential-manager.js';
import {
  testConnection,
  searchEmails,
  getEmailHtml,
} from './email/imap-client.js';
import { preprocessEmailHtml, extractBaseUrl } from './email/email-html-preprocessor.js';

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
        'Navigate to a URL (or load an email by UID) and list the major page elements with their CSS selectors, semantic types, ' +
        'hierarchy context, and visual properties. Scans 2-3 levels deep to find cards, widgets, and forms. ' +
        'Useful for discovering which elements to extract before calling extract_css_convert_tailwind or extract_email_design.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to analyze (provide this OR emailUid, not both)',
          },
          emailUid: {
            type: 'number',
            description: 'Email UID to load and analyze (alternative to url). Use search_emails to find UIDs.',
          },
          account: {
            type: 'string',
            description: 'Email account label (if using emailUid with multiple configured accounts)',
          },
        },
      },
    },
    {
      name: 'screenshot_page',
      description:
        'Take an annotated screenshot of a webpage (or email) with numbered labels (#1, #2, #3...) overlaid on ' +
        'discovered elements. Returns the screenshot image plus a legend mapping each number to its ' +
        'CSS selector, semantic type, size, and content preview. Use this to visually identify which ' +
        'element a user is describing (e.g., "the sidebar", "the pricing card") before extracting it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to screenshot (provide this OR emailUid, not both)',
          },
          emailUid: {
            type: 'number',
            description: 'Email UID to load and screenshot (alternative to url). Use search_emails to find UIDs.',
          },
          account: {
            type: 'string',
            description: 'Email account label (if using emailUid with multiple configured accounts)',
          },
          viewport: {
            type: 'string',
            enum: ['desktop', 'tablet', 'mobile'],
            default: 'desktop',
            description: 'Viewport size for the screenshot',
          },
        },
      },
    },
    {
      name: 'configure_email',
      description:
        'Configure an email account for newsletter extraction via IMAP. ' +
        'Supports Gmail (use App Password from myaccount.google.com/apppasswords), ' +
        'Outlook, Yahoo, iCloud, and any IMAP-compatible provider. ' +
        'Credentials are stored locally in ~/.snipcss/email.json.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          provider: {
            type: 'string',
            enum: ['gmail', 'outlook', 'yahoo', 'icloud', 'custom'],
            description: 'Email provider preset. Sets host/port automatically. Use "custom" for other providers.',
          },
          host: {
            type: 'string',
            description: 'IMAP server hostname (required if provider is "custom")',
          },
          port: {
            type: 'number',
            default: 993,
            description: 'IMAP port (993 for TLS)',
          },
          user: {
            type: 'string',
            description: 'Email address / username',
          },
          password: {
            type: 'string',
            description: 'Password or app-specific password (for Gmail, use an App Password)',
          },
          label: {
            type: 'string',
            default: 'default',
            description: 'Account label for managing multiple accounts',
          },
        },
        required: ['user', 'password'],
      },
    },
    {
      name: 'search_emails',
      description:
        'Search your email inbox for newsletters or specific emails. ' +
        'Returns a list of matching emails with subject, sender, date, and UID. ' +
        'Use the UID with extract_email_design, list_page_elements, or screenshot_page.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          from: {
            type: 'string',
            description: 'Filter by sender email or name (e.g., "newsletter@metv.com", "MeTV")',
          },
          subject: {
            type: 'string',
            description: 'Filter by subject keywords',
          },
          since: {
            type: 'string',
            description: 'Only emails after this date (ISO 8601, e.g., "2026-02-01")',
          },
          mailbox: {
            type: 'string',
            default: 'INBOX',
            description: 'Mailbox/folder to search',
          },
          limit: {
            type: 'number',
            default: 10,
            description: 'Max results to return (newest first)',
          },
          account: {
            type: 'string',
            description: 'Account label (if multiple configured)',
          },
        },
      },
    },
    {
      name: 'extract_email_design',
      description:
        'Extract CSS/design from an email newsletter and convert to Tailwind. ' +
        'Fetches the email HTML via IMAP, loads it in a browser, and runs the full extraction pipeline. ' +
        'Use search_emails first to find the email UID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          uid: {
            type: 'number',
            description: 'Email UID from search_emails results',
          },
          selector: {
            type: 'string',
            default: 'body',
            description: 'CSS selector for the element to extract (default: entire email body). Use list_page_elements with emailUid to discover selectors.',
          },
          mailbox: {
            type: 'string',
            default: 'INBOX',
            description: 'Mailbox/folder the email is in',
          },
          account: {
            type: 'string',
            description: 'Account label (if multiple configured)',
          },
          viewport: {
            type: 'string',
            enum: ['all', 'desktop', 'tablet', 'mobile'],
            default: 'desktop',
            description: 'Viewport(s) to extract CSS for',
          },
          resolveVariables: {
            type: 'boolean',
            default: true,
            description: 'Whether to resolve CSS custom properties',
          },
          includeHoverStates: {
            type: 'boolean',
            default: false,
            description: 'Whether to extract hover/focus states (usually not relevant for emails)',
          },
        },
        required: ['uid'],
      },
    },
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

  if (name === 'configure_email') {
    try {
      const provider = args?.provider as string | undefined;
      let host = args?.host as string | undefined;
      let port = (args?.port as number) || 993;
      let secure = true;
      const user = args!.user as string;
      const password = args!.password as string;
      const label = (args?.label as string) || 'default';

      // Apply provider preset if specified
      if (provider && provider !== 'custom') {
        const preset = getProviderPreset(provider);
        if (preset) {
          host = host || preset.host;
          port = preset.port;
          secure = preset.secure;
        }
      }

      if (!host) {
        return {
          content: [{
            type: 'text',
            text: 'Error: host is required. Either specify a provider (gmail, outlook, yahoo, icloud) or provide host directly.',
          }],
          isError: true,
        };
      }

      const creds: ImapCredentials = { host, port, user, password, secure };

      // Test the connection before saving
      const result = await testConnection(creds);
      if (!result.success) {
        let hint = '';
        if (provider === 'gmail') {
          hint = '\n\nFor Gmail, make sure you are using an App Password (not your regular password). ' +
            'Generate one at: https://myaccount.google.com/apppasswords';
        }
        return {
          content: [{
            type: 'text',
            text: `Connection failed: ${result.error}${hint}`,
          }],
          isError: true,
        };
      }

      setAccount(label, creds);

      let response = `Email account "${label}" configured successfully (${user} via ${host}:${port}).`;
      if (provider === 'gmail') {
        response += '\n\nGmail connected via App Password.';
      }
      response += '\n\nYou can now use search_emails to find newsletters.';

      return { content: [{ type: 'text', text: response }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error configuring email: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'search_emails') {
    try {
      const accountLabel = args?.account as string | undefined;
      const creds = getAccount(accountLabel);
      if (!creds) {
        const accounts = listAccounts();
        const hint = accounts.length > 0
          ? `Available accounts: ${accounts.join(', ')}`
          : 'Use configure_email to set up an email account first.';
        return {
          content: [{ type: 'text', text: `No email account configured.${accountLabel ? ` Account "${accountLabel}" not found.` : ''} ${hint}` }],
          isError: true,
        };
      }

      const results = await searchEmails(creds, {
        from: args?.from as string | undefined,
        subject: args?.subject as string | undefined,
        since: args?.since as string | undefined,
        mailbox: args?.mailbox as string | undefined,
        limit: args?.limit as number | undefined,
      });

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: 'No emails found matching your search criteria.' }],
        };
      }

      let output = `## Email Search Results\n\nFound ${results.length} email(s):\n\n`;
      output += `| # | UID | From | Subject | Date | HTML? |\n`;
      output += `|---|-----|------|---------|------|-------|\n`;

      for (let i = 0; i < results.length; i++) {
        const e = results[i];
        const from = e.from.replace(/\|/g, '\\|');
        const subject = e.subject.replace(/\|/g, '\\|').substring(0, 60);
        const date = e.date !== 'unknown' ? new Date(e.date).toLocaleDateString() : 'unknown';
        output += `| ${i + 1} | ${e.uid} | ${from} | ${subject} | ${date} | ${e.hasHtml ? 'Yes' : 'No'} |\n`;
      }

      output += `\n_Use the UID with extract_email_design to extract CSS, or with list_page_elements/screenshot_page (emailUid param) to preview._`;

      return { content: [{ type: 'text', text: output }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error searching emails: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'extract_email_design') {
    try {
      // Check usage/Pro access
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

      const uid = args!.uid as number;
      const selector = (args?.selector as string) || 'body';
      const mailbox = args?.mailbox as string | undefined;
      const accountLabel = args?.account as string | undefined;

      const creds = getAccount(accountLabel);
      if (!creds) {
        return {
          content: [{ type: 'text', text: 'No email account configured. Use configure_email first.' }],
          isError: true,
        };
      }

      // Fetch email HTML
      const email = await getEmailHtml(creds, uid, mailbox);
      const baseUrl = extractBaseUrl(email.html);
      const processedHtml = preprocessEmailHtml(email.html);

      // Run extraction pipeline on the email HTML
      if (!pipeline) {
        await browserManager.launch();
        pipeline = new ExtractionPipeline(browserManager);
      }

      const options: ExtractionOptions = {
        viewport: (args?.viewport as string) || 'desktop',
        resolveVariables: args?.resolveVariables !== false,
        includeHoverStates: args?.includeHoverStates === true, // default false for emails
      };

      const result = await pipeline.extractFromHtml(processedHtml, selector, {
        ...options,
        baseUrl,
      });

      const source = `email "${email.subject}" from ${email.from}`;
      let output = formatExtractionResult(result, source, selector);

      if (access.message) {
        output += `\n\n---\n_${access.message}_`;
      }

      return { content: [{ type: 'text', text: output }] };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error extracting email design: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === 'list_page_elements') {
    try {
      await browserManager.launch();

      let bp;
      let sourceLabel: string;

      if (args?.emailUid) {
        // Email mode: load email HTML into browser
        const creds = getAccount(args?.account as string | undefined);
        if (!creds) {
          return {
            content: [{ type: 'text', text: 'No email account configured. Use configure_email first.' }],
            isError: true,
          };
        }
        const email = await getEmailHtml(creds, args.emailUid as number);
        const processedHtml = preprocessEmailHtml(email.html);
        const baseUrl = extractBaseUrl(email.html);
        bp = await browserManager.createPageFromHtml(processedHtml, baseUrl);
        sourceLabel = `email "${email.subject}" (UID: ${args.emailUid})`;
      } else if (args?.url) {
        bp = await browserManager.createPage(args.url as string);
        sourceLabel = args.url as string;
      } else {
        return {
          content: [{ type: 'text', text: 'Either url or emailUid is required.' }],
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

      if (args?.emailUid) {
        // Email mode: load email HTML into browser
        const creds = getAccount(args?.account as string | undefined);
        if (!creds) {
          return {
            content: [{ type: 'text', text: 'No email account configured. Use configure_email first.' }],
            isError: true,
          };
        }
        const email = await getEmailHtml(creds, args.emailUid as number);
        const processedHtml = preprocessEmailHtml(email.html);
        const baseUrl = extractBaseUrl(email.html);
        bp = await browserManager.createPageFromHtml(processedHtml, baseUrl);
        pageTitle = `email "${email.subject}" (UID: ${args.emailUid})`;
      } else if (args?.url) {
        bp = await browserManager.createPage(args.url as string);
        pageTitle = args.url as string;
      } else {
        return {
          content: [{ type: 'text', text: 'Either url or emailUid is required.' }],
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
