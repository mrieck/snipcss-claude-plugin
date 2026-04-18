# ⚠️ SnipCSS — Service Disruption Notice
 
> **Status: Offline** — I am actively working to restore full service. Updates will be posted here.
 
---
 
## What Happened
 
SnipCSS was targeted in a cyberattack. My Gmail accounts, website, domains, and SaaS infrastructure were all compromised in a coordinated takeover. I have been locked out of critical accounts and the service has been forced offline as a result.
 
I am currently working with domain registrars, email providers, and hosting services to verify ownership and reclaim control of everything.
 
---
 
## Current Status
 
| Service | Status |
|---|---|
| Gmail / email accounts | 🔴 Compromised — recovery seems impossible via Google recovery flow |
| snipcss.com domain & website | 🟡 Have control, in progress bringing back online |
| npm package (`@productivemark/snipcss`), github and extension | 🟢 No changes to code or packages |
| Claude Code plugin & MCP server | 🟡 Using Pro key not working due to server being down |
| Full service restoration | ⚪ In progress — updates to follow |
 
---
 
## 🎁 A Promise to Every Paying Customer
 
Once SnipCSS is back online, **every customer who had an active paid plan can email support@snipcss.com to receive a lifetime Pro subscription for free.**
 
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

## Updating the Plugin

If you're getting errors after an update, clear the plugin cache first, then reinstall.

**macOS / Linux:**
```bash
rm -rf ~/.claude/plugins/cache/snipcss/
```

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude\plugins\cache\snipcss"
```

Then remove and reinstall:
```
/plugin marketplace remove snipcss
/plugin marketplace add mrieck/snipcss-claude-plugin
/plugin install snipcss@snipcss
```

---

## npm Package

```
npx -y @productivemark/snipcss
```

Published at: https://www.npmjs.com/package/@productivemark/snipcss

---

## License

UNLICENSED — © Productive Mark LLC
