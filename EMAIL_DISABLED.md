# Email Tools Disabled

The email functionality (IMAP newsletter extraction) has been temporarily disabled to unblock builds and focus on other work.

## What was disabled

- **Imports**: Commented out all 3 email module imports in `src/mcp-server.ts`
- **Tool definitions**: Commented out `configure_email`, `search_emails`, `extract_email_design` from the tools list
- **Tool handlers**: Commented out the 3 email handler blocks
- **Email branches**: Commented out `emailUid`/`account` params and email-mode code paths in `list_page_elements` and `screenshot_page`
- **tsconfig.json**: Added `src/email` to `exclude` so those files won't cause build errors
- **package.json**: Removed `imapflow`, `mailparser`, and `@types/mailparser` from dependencies

## To re-enable

1. Uncomment the email imports, tool definitions, and handlers in `src/mcp-server.ts` (search for "Email" comments)
2. Uncomment the `emailUid`/`account` params in `list_page_elements` and `screenshot_page` tool schemas
3. Restore the email-mode `if (args?.emailUid)` branches in both handlers
4. Remove `"src/email"` from the `exclude` array in `tsconfig.json`
5. Re-add email deps: `npm install imapflow mailparser @types/mailparser`
6. Run `npm run build`
