---
name: workflow
description: Use snipcss tools to find elements, extract CSS or convert ANY ELEMENT to tailwind. You can use the tools to convert existing code to tailwind, or take code from other websites and receive both CSS and tailwind. Just describe what you want.
argument-hint: "<description of what to extract, including URL>"
user-invocable: true
allowed-tools: Bash(node *), Bash(npm *), Bash(npx tsc *)
---

# SnipCSS Design Extraction & Integration

Extract a design component from an external website and autonomously integrate it into the user's current project.

## Workflow

### Step 1: DISCOVER

Call the `screenshot_page` MCP tool with the target URL. This returns:
- An annotated screenshot with numbered labels (#1, #2, #3...) overlaid on page elements
- A text legend mapping each number to its CSS selector, semantic type, size, and content preview

Look at the screenshot visually to understand the page layout.

### Step 2: IDENTIFY

Match the user's natural language description to the numbered elements:
- "the sidebar" → look for elements labeled as Sidebar, aside tags, or side-positioned elements
- "the pricing cards" → look for Card-type elements with pricing-related text
- "the navigation" → look for Navigation/Header type elements
- "the hero section" → look for Hero Section type elements near the top

If the match is ambiguous (multiple possible elements), ask the user to clarify by referencing the numbered labels:
> "I see several card-like elements: #4 (Card, 350x280) and #7 (Card, 350x280). Which one did you mean, or should I extract the whole section containing them?"

If the user didn't specify a URL, ask for one.

### Step 3: EXTRACT

Call the `extract_css_convert_tailwind` MCP tool with:
- `url`: the target URL
- `selector`: the CSS selector from the identified element
- `viewport`: `"all"` for responsive extraction (default)
- `resolveVariables`: `true`
- `includeHoverStates`: `true`

The tool returns:
- `html` — clean extracted HTML
- `css` — complete CSS with fonts, variables, keyframes, media queries
- `tailwindHtml` — HTML with Tailwind utility classes
- `tailwindBodyClasses` — body-level Tailwind classes
- `fonts` — font definitions used
- `cssVariables` — resolved CSS custom properties

### Step 4: INTEGRATE

You have full context of the user's project. Read the codebase to understand:
- What language/framework is used (React, Vue, Svelte, Rails, Django, plain HTML, etc.)
- What styling approach is used (Tailwind, CSS Modules, styled-components, plain CSS, SCSS, etc.)
- What the component/file structure looks like
- What existing patterns to follow

Then adapt and integrate the extracted design:

**Styling decision:**
- If the project uses Tailwind → use the `tailwindHtml` output
- If the project uses plain CSS/SCSS → use the `html` + `css` output
- If the project uses CSS Modules/styled-components → convert the CSS to that format

**Framework adaptation:**
- React/Next.js → Convert to JSX (className, self-closing tags, camelCase style props)
- Vue → Convert to SFC template syntax
- Svelte → Convert to .svelte component format
- Rails ERB/HAML → Convert to template format
- Any other framework → adapt accordingly using your knowledge of that framework

**Integration:**
- Place the component where it makes sense in the project structure
- Adapt image URLs (note which ones need replacing with local assets)
- Add font imports if the extracted design uses fonts not already in the project
- Match the project's naming conventions, export patterns, and coding style
- Wire up the component where the user needs it (if the placement is clear)

### Step 5: REPORT

After integration, briefly tell the user:
- What was extracted and from where
- Where the component was placed in their project
- Any manual steps needed (e.g., "Replace the placeholder images at lines X-Y with your own assets")
- Any fonts or dependencies that may need to be added

## Notes

- The `screenshot_page` and `list_page_elements` tools share the same element discovery — the numbered labels match between them
- If extraction fails on a selector, try a broader parent selector or a more specific child
- For complex multi-part designs (e.g., an entire page section with nested cards), extract the outermost container to get everything
- The extraction tool handles responsive styles automatically when viewport is set to "all"
