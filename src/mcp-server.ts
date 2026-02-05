#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BrowserManager } from './browser/browser-manager.js';
import { ExtractionPipeline } from './extraction/extraction-pipeline.js';
import { ExtractionOptions } from './types/index.js';

const browserManager = new BrowserManager();
let pipeline: ExtractionPipeline;

const server = new Server(
  {
    name: 'snipcss',
    version: '1.0.0',
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
      name: 'extract_tailwind',
      description:
        'Extract CSS from a live page element and convert to Tailwind CSS classes. ' +
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
      name: 'list_page_elements',
      description:
        'Navigate to a URL and list the major page elements with their CSS selectors. ' +
        'Useful for discovering which elements to extract before calling extract_tailwind.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the page to analyze',
          },
        },
        required: ['url'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'extract_tailwind') {
    try {
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

      const output = formatExtractionResult(
        result,
        args!.url as string,
        args!.selector as string
      );

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

  if (name === 'list_page_elements') {
    try {
      if (!pipeline) {
        await browserManager.launch();
        pipeline = new ExtractionPipeline(browserManager);
      }

      const bp = await browserManager.createPage(args!.url as string);

      const elements = await bp.page.evaluate(() => {
        const results: {
          tag: string;
          selector: string;
          classes: string;
          id: string;
          text: string;
          children: number;
          rect: { width: number; height: number };
        }[] = [];

        // Find major structural elements
        const selectors = [
          'header',
          'nav',
          'main',
          'footer',
          'aside',
          'section',
          'article',
          '[role="banner"]',
          '[role="navigation"]',
          '[role="main"]',
          '[role="contentinfo"]',
        ];

        const seen = new Set<Element>();

        for (const sel of selectors) {
          const elems = document.querySelectorAll(sel);
          for (const elem of elems) {
            if (seen.has(elem)) continue;
            seen.add(elem);

            const rect = elem.getBoundingClientRect();
            // Skip tiny/hidden elements
            if (rect.width < 50 || rect.height < 20) continue;

            let bestSelector = sel;
            if (elem.id) bestSelector = '#' + elem.id;
            else if (elem.classList.length > 0) {
              bestSelector = '.' + [...elem.classList].join('.');
            }

            results.push({
              tag: elem.tagName.toLowerCase(),
              selector: bestSelector,
              classes: [...elem.classList].join(' '),
              id: elem.id || '',
              text: (elem.textContent || '').trim().substring(0, 80),
              children: elem.children.length,
              rect: {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              },
            });
          }
        }

        // Also get direct children of body that are large
        const bodyChildren = document.body.children;
        for (const elem of bodyChildren) {
          if (seen.has(elem)) continue;
          seen.add(elem);

          const rect = elem.getBoundingClientRect();
          if (rect.width < 200 || rect.height < 50) continue;

          const tag = elem.tagName.toLowerCase();
          if (['script', 'style', 'link', 'meta', 'noscript'].includes(tag))
            continue;

          let bestSelector = tag;
          if (elem.id) bestSelector = '#' + elem.id;
          else if (elem.classList.length > 0) {
            bestSelector = '.' + [...elem.classList].join('.');
          }

          results.push({
            tag,
            selector: bestSelector,
            classes: [...elem.classList].join(' '),
            id: elem.id || '',
            text: (elem.textContent || '').trim().substring(0, 80),
            children: elem.children.length,
            rect: {
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          });
        }

        return results;
      });

      await browserManager.closePage(bp);

      let output = `## Page Elements for ${args!.url}\n\n`;
      output += `| Selector | Tag | Size | Children | Preview |\n`;
      output += `|----------|-----|------|----------|---------|\n`;

      for (const elem of elements) {
        const preview = elem.text.substring(0, 40).replace(/\|/g, '\\|');
        output += `| \`${elem.selector}\` | ${elem.tag} | ${elem.rect.width}x${elem.rect.height} | ${elem.children} | ${preview} |\n`;
      }

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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('SnipCSS MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
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
