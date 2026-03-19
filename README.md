# SnipCSS — Claude Code Plugin & MCP Server

Extract pixel-perfect CSS from any live webpage and convert it to Tailwind. The most accurate way to clone designs or migrate an existing codebase to Tailwind — powered by Chrome DevTools Protocol.

---

## Install in Seconds (Claude Code)

Run these two commands in Claude Code to get started:

```
# Add the SnipCSS marketplace
❯ /plugin marketplace add mrieck/snipcss-claude-plugin
# Install the plugin
❯ /plugin install snipcss@snipcss
```

You only need to run these once. The plugin is then available across all your projects.

---

## Install in Seconds (Codex CLI)

Run this command in your terminal to get started:

```
# Add the SnipCSS MCP server
❯ codex mcp add snipcss -- npx -y @productivemark/snipcss
```

```
# Optional: set a longer timeout for complex pages
# Add to ~/.codex/config.toml:
[mcp_servers.snipcss]
tool_timeout_sec = 120
```

---

## What It Does

SnipCSS connects Claude to a headless browser that inspects live pages using Chrome DevTools Protocol — the same engine powering browser devtools. It captures every matched style rule, resolves CSS variables, handles hover/focus states, and converts the result to clean Tailwind classes.

**Use it to:**
- Clone the design of any element on any website
- Convert your existing CSS codebase to Tailwind
- Pull exact spacing, typography, and color tokens from a live site
- Get a screenshot of any page or element

---

## MCP Tools

| Tool | What it does |
|---|---|
| `extract_css_convert_tailwind` | Extract CSS from a URL + selector, returns CSS and/or Tailwind |
| `list_page_elements` | Discover structural elements on a page to find the right selector |
| `screenshot_page` | Screenshot a full page or specific element at any viewport |
| `set_api_key` | Set your SnipCSS Pro API key |

---

## How It Works

1. Launches a headless Chromium browser via [Patchwright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
2. Navigates to the target URL and waits for network idle
3. Labels every DOM element with a unique marker class
4. Uses `CSS.getMatchedStylesForNode` (CDP) to extract all matched rules per element
5. Forces pseudo-states (`:hover`, `:focus`, `:active`) via `CSS.forcePseudoState`
6. Resolves `var()` references, collects `@font-face` and `@keyframes`
7. Maps every CSS property to a Tailwind utility class (1,400+ mappings)
8. Returns clean CSS, Tailwind HTML, or both

---

## npm Package

```
npx -y @productivemark/snipcss
```

Published at: https://www.npmjs.com/package/@productivemark/snipcss

---

## License

UNLICENSED — © Productive Mark LLC
