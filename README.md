# SnipCSS is now SnipKiwi, and it's free

This repo is kept only so existing installs keep resolving. **New home:**

## → [github.com/mrieck/snipkiwi-design-extract](https://github.com/mrieck/snipkiwi-design-extract)

Same extraction engine (authored CSS over the Chrome DevTools Protocol, converted to Tailwind),
now free with no account, no key and no extraction limit, plus a new `compare_to_reference` tool
that checks your rebuild against the original.

### Switch in Claude Code

```
/plugin uninstall snipcss@snipcss
/plugin marketplace remove snipcss
/plugin marketplace add mrieck/snipkiwi-design-extract
/plugin install snipkiwi@snipkiwi
```

### Codex CLI

```sh
codex mcp remove snipcss
git clone https://github.com/mrieck/snipkiwi-design-extract ~/snipkiwi
cd ~/snipkiwi && npm install --omit=dev
codex mcp add snipkiwi -- node ~/snipkiwi/dist/mcp-server.js
```

### About the old package

`@productivemark/snipcss` on npm is frozen at 1.1.4. It still carries the old 25-extraction free
limit and tries to verify Pro keys against a server that no longer exists, so please switch.

The Chrome extension is also free now:
[SnipCSS Kiwi](https://chromewebstore.google.com/detail/snipcss-kiwi-free/lhljehcbbofodgfkibklodekancpgolp).
Site: [snipkiwi.com](https://snipkiwi.com). Questions: support@snipkiwi.com.
