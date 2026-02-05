#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs';
import path from 'path';
import { BrowserManager } from './browser/browser-manager.js';
import { ExtractionPipeline } from './extraction/extraction-pipeline.js';
import { ExtractionOptions, ExtractionResult } from './types/index.js';

function makeFilename(
  urlStr: string,
  selector: string,
  variant: 'tailwind' | 'original',
  timestamp: string
): string {
  const domain = new URL(urlStr).hostname.replace(/^www\./, '');
  const sel = selector.replace(/^[.#]/, '').replace(/[^a-zA-Z0-9-]/g, '-');
  const ts = timestamp.replace(/[-:T]/g, '').replace(/\..+/, '');
  return `${domain}_${variant}_${sel}_${ts}.html`;
}

function buildTailwindHtmlFile(
  result: ExtractionResult,
  urlStr: string,
  selector: string,
  timestamp: string
): string {
  const domain = new URL(urlStr).hostname.replace(/^www\./, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${selector} (tailwind) \u2014 ${domain}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    /* Extracted CSS: variables, fonts, keyframes, fallback rules for unconverted properties */
${result.css.split('\n').map((l: string) => '    ' + l).join('\n')}
  </style>
</head>
<body class="${result.tailwindBodyClasses || ''}">
  <!-- Extracted from ${urlStr} | selector: ${selector} | ${timestamp} -->
  ${result.tailwindHtml || result.html}
</body>
</html>`;
}

function buildOriginalHtmlFile(
  result: ExtractionResult,
  urlStr: string,
  selector: string,
  timestamp: string
): string {
  const domain = new URL(urlStr).hostname.replace(/^www\./, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${selector} (original CSS) \u2014 ${domain}</title>
  <style>
${result.css.split('\n').map((l: string) => '    ' + l).join('\n')}
  </style>
</head>
<body>
  <!-- Extracted from ${urlStr} | selector: ${selector} | ${timestamp} -->
  ${result.html}
</body>
</html>`;
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 --url <url> --selector <selector> [options]')
    .option('url', {
      alias: 'u',
      type: 'string',
      description: 'URL of the page to extract from',
      demandOption: true,
    })
    .option('selector', {
      alias: 's',
      type: 'string',
      description: 'CSS selector for the target element',
      demandOption: true,
    })
    .option('viewport', {
      alias: 'v',
      type: 'string',
      description: 'Viewport: all, desktop, tablet, mobile, or a width in px',
      default: 'all',
    })
    .option('format', {
      alias: 'f',
      type: 'string',
      choices: ['css', 'tailwind', 'both', 'json', 'html'] as const,
      description: 'Output format (html writes preview files)',
      default: 'both',
    })
    .option('resolve-vars', {
      type: 'boolean',
      description: 'Resolve CSS variables to computed values',
      default: true,
    })
    .option('no-hover', {
      type: 'boolean',
      description: 'Skip hover/active state extraction',
      default: false,
    })
    .option('keep-unused-classes', {
      type: 'boolean',
      description: 'Keep CSS classes not found in extracted rules',
      default: false,
    })
    .option('keep-unused-attrs', {
      type: 'boolean',
      description: 'Keep data-* and other non-essential HTML attributes',
      default: false,
    })
    .option('output', {
      alias: 'o',
      type: 'string',
      description: 'Output file/directory path (default: stdout, or cwd for html format)',
    })
    .option('json', {
      type: 'boolean',
      description: 'Output as structured JSON',
      default: false,
    })
    .option('timeout', {
      type: 'number',
      description: 'Page load timeout in ms',
      default: 30000,
    })
    .help()
    .argv;

  const browserManager = new BrowserManager();

  try {
    await browserManager.launch();

    const pipeline = new ExtractionPipeline(browserManager);

    const options: ExtractionOptions = {
      viewport: argv.viewport as string,
      resolveVariables: argv['resolve-vars'] as boolean,
      includeHoverStates: !(argv['no-hover'] as boolean),
      removeUnusedClasses: !(argv['keep-unused-classes'] as boolean),
      removeUnusedAttributes: !(argv['keep-unused-attrs'] as boolean),
    };

    // Parse custom width viewport
    if (options.viewport && /^\d+$/.test(options.viewport)) {
      options.customWidth = parseInt(options.viewport, 10);
      options.viewport = 'custom' as any;
    }

    console.error(`Extracting CSS from ${argv.url} for selector: ${argv.selector}`);

    const result = await pipeline.extract(
      argv.url as string,
      argv.selector as string,
      options
    );

    const format = argv.format as string;
    const timestamp = new Date().toISOString();

    // HTML preview mode: write both tailwind and original files
    if (format === 'html') {
      const outDir = (argv.output as string) || process.cwd();
      const twFile = makeFilename(argv.url as string, argv.selector as string, 'tailwind', timestamp);
      const origFile = makeFilename(argv.url as string, argv.selector as string, 'original', timestamp);

      const twHtml = buildTailwindHtmlFile(result, argv.url as string, argv.selector as string, timestamp);
      const origHtml = buildOriginalHtmlFile(result, argv.url as string, argv.selector as string, timestamp);

      fs.writeFileSync(path.join(outDir, twFile), twHtml, 'utf-8');
      fs.writeFileSync(path.join(outDir, origFile), origHtml, 'utf-8');

      console.error(`Tailwind: ${path.join(outDir, twFile)}`);
      console.error(`Original: ${path.join(outDir, origFile)}`);
      return;
    }

    // JSON mode
    const useJson = argv.json as boolean || format === 'json';
    let output: string;

    if (useJson) {
      output = JSON.stringify({
        url: argv.url,
        selector: argv.selector,
        timestamp,
        html: result.html,
        css: result.css,
        tailwindHtml: result.tailwindHtml || result.html,
        tailwindBodyClasses: result.tailwindBodyClasses,
        fonts: result.fonts,
        cssVariables: result.cssVariables,
      }, null, 2);
    } else {
      const sections: string[] = [];

      if (format === 'css' || format === 'both') {
        sections.push('=== HTML ===');
        sections.push(result.html);
        sections.push('');
        sections.push('=== CSS ===');
        sections.push(result.css);
      }

      if (format === 'tailwind' || format === 'both') {
        if (result.tailwindHtml) {
          sections.push('');
          sections.push('=== TAILWIND HTML ===');
          sections.push(result.tailwindHtml);
        }
        if (result.tailwindBodyClasses) {
          sections.push('');
          sections.push('=== TAILWIND BODY CLASSES ===');
          sections.push(result.tailwindBodyClasses);
        }
      }

      output = sections.join('\n');
    }

    if (argv.output) {
      fs.writeFileSync(argv.output as string, output, 'utf-8');
      console.error(`Output written to ${argv.output}`);
    } else {
      console.log(output);
    }
  } catch (error: any) {
    console.error('Extraction error:', error.message);
    process.exit(1);
  } finally {
    await browserManager.close();
  }
}

main();
