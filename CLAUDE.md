# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

snipcss-playwright is a Playwright CDP-based CSS extraction tool that captures CSS from live webpages and converts to Tailwind CSS. It's a modernized port of the SnipCSS browser extension (`/Users/markr/Sites/snipcss/snip-extension`). Two entry points: a CLI (`src/index.ts`) and an MCP server (`src/mcp-server.ts`).

The long-term goal is to package this as a **Claude Code plugin** with an MCP server + skill, distributed via the Anthropic plugin marketplace. The plugin will include a soft usage counter (10 free extractions, then prompt for Pro email stored in `~/.snipcss/config.json`).

## Build & Dev Commands

```bash
npm run build          # tsc — compile to dist/
npm run dev            # tsc --watch
npm run start          # node dist/index.js (CLI)
npm run mcp            # node dist/mcp-server.js (MCP server on stdio)
```

No test framework is configured. Use the Claude Code skills (`/build-check`, `/test-extract`, `/test-mcp`, `/test-compare`) for validation.

## MCP Timeout Guidance

Long extractions (especially `viewport: "all"` on complex pages) can exceed default MCP tool timeouts in some clients.

For Codex CLI, set a higher timeout in `~/.codex/config.toml`:

```toml
[mcp_servers.snipcss]
command = "npx"
args = ["-y", "@productivemark/snipcss"]
tool_timeout_sec = 120
```

## CLI Usage

```bash
node dist/index.js --url <url> --selector <selector> [options]
```

Key flags: `--viewport all|desktop|tablet|mobile|<width>px`, `--format css|tailwind|both|json|html`, `--resolve-vars`, `--no-hover`, `--timeout 30000`

The `--format html` mode writes two preview files (tailwind + original CSS) to the output directory. JSON mode (`--format json` or `--json`) outputs structured `ExtractionResult`.

## Architecture

### Extraction Pipeline (`src/extraction/extraction-pipeline.ts`)

The core orchestrator runs a 13-step process:
1. Launch browser page → CDP session
2. Collect stylesheets via `CSS.styleSheetAdded` events
3. Wait for `networkidle`
4. Get DOM document via `DOM.getDocument`
5. Label all descendant elements with unique `snipcss{id}-{level}-{parentId}-{currId}` marker classes
6. Parse fonts, CSS variables from collected stylesheets
7. For each viewport: batch-extract matched styles via `CSS.getMatchedStylesForNode` (batch size 5, parallelized), then sequentially force pseudo-states via `CSS.forcePseudoState`
8. Build CSS output, convert to Tailwind, clean HTML, strip marker classes

### ExtractionContext (`src/types/index.ts`)

Central mutable state object passed through the pipeline. Key fields:
- `snippedArr` — all extracted CSS rules (`SnippedRule[]`)
- `matchingFinalRules` — element classname → matched rules mapping (drives Tailwind conversion)
- `cssvarDefinedArr` / `cssvarAllArr` — CSS variable definitions and resolved values
- `stylesheetArr` — all collected stylesheets

### Tailwind Conversion (`src/tailwind/`)

- `tailwind-converter.ts` — Loads labeled HTML into Cheerio, iterates elements, maps CSS rules to Tailwind classes via `matchingFinalRules`. Handles media query prefixes (sm:, md:, lg:), pseudo-class prefixes (hover:, focus:), pseudo-elements (before:, after:), and shorthand expansion.
- `css-to-tailwind.ts` — Property-level mapping (1400+ lines). Converts individual CSS property/value pairs to Tailwind utility classes.
- `shorthand-expander.ts` — Expands CSS shorthands (margin, padding, border, font, etc.) into individual properties before Tailwind mapping.
- `tailwind-reducer.ts` — Deduplicates and optimizes the final Tailwind class list.

### Browser Layer (`src/browser/`)

- `browser-manager.ts` — Launches headless Chromium, manages CDP sessions, page lifecycle
- `viewport-manager.ts` — Emulates viewports via `Emulation.setDeviceMetricsOverride`. Predefined: desktop (1366x768), iphonexs, ipad, ipadlandscape, pixel2, largedesktop

### MCP Server (`src/mcp-server.ts`)

Exposes two tools over stdio JSON-RPC:
- `extract_tailwind` — Full extraction + Tailwind conversion (url, selector, viewport, resolveVariables, includeHoverStates)
- `list_page_elements` — Discovers major structural elements on a page for selector discovery

### Key Extraction Modules (`src/extraction/`)

- `stylesheet-collector.ts` — CDP `CSS.styleSheetAdded` listener
- `dom-labeler.ts` — Injects marker classes into DOM
- `style-matcher.ts` — Processes `CSS.getMatchedStylesForNode` results, handles inherited rules
- `pseudo-state-handler.ts` — Forces `:hover`, `:active`, `:checked` via CDP, extracts additional matched styles
- `css-variable-resolver.ts` — Recursive `var()` resolution (max depth 10), fallback support
- `font-collector.ts` — Extracts `@font-face` and Google Font imports
- `keyframe-collector.ts` — Collects `@keyframes` animations
- `html-cleaner.ts` — Strips unused classes/attributes, preserves icon font classes (fa-, bi-, ti-, material-icons, etc.)
- `specificity.ts` + `utils/parsel.ts` — CSS specificity scoring

## Key Design Decisions

- **ES modules** (`"type": "module"`) — all imports use `.js` extensions
- **No global state** — `ExtractionContext` class replaces the extension's globals
- **CDP over Playwright APIs** — uses raw Chrome DevTools Protocol for CSS inspection (getMatchedStylesForNode, forcePseudoState) since Playwright doesn't expose these
- **Cheerio for HTML manipulation** — server-side jQuery-like DOM for Tailwind class injection
- **Status messages go to stderr** — stdout is reserved for extraction output (important for piping and MCP)
