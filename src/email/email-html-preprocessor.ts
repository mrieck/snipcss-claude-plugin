/**
 * Preprocess email HTML for browser rendering.
 * Email HTML has quirks (MSO conditionals, tracking pixels, etc.)
 * that need cleaning before we can extract CSS from it.
 */

export function extractBaseUrl(html: string): string | undefined {
  const match = html.match(/<base\s+href=["']([^"']+)["']/i);
  return match ? match[1] : undefined;
}

export function preprocessEmailHtml(html: string): string {
  let processed = html;

  // Strip MSO conditional comments: <!--[if mso]>...<![endif]-->
  processed = processed.replace(/<!--\[if\s+mso[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');

  // Strip <!--[if !mso]><!--> ... <!--<![endif]--> (keep the inner content)
  processed = processed.replace(/<!--\[if\s+!mso[^\]]*\]><!-->/gi, '');
  processed = processed.replace(/<!--<!\[endif\]-->/gi, '');

  // Remove other IE conditional comments
  processed = processed.replace(/<!--\[if\s+[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, '');

  // Remove tracking pixels (1x1 images)
  processed = processed.replace(
    /<img[^>]*(?:width\s*=\s*["']1["'][^>]*height\s*=\s*["']1["']|height\s*=\s*["']1["'][^>]*width\s*=\s*["']1["'])[^>]*\/?>/gi,
    ''
  );

  // Remove <script> tags (shouldn't be in emails but safety measure)
  processed = processed.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove mso-* CSS properties from inline styles
  processed = processed.replace(
    /style="([^"]*)"/gi,
    (match, styleContent: string) => {
      const cleaned = styleContent
        .split(';')
        .filter((prop: string) => !prop.trim().startsWith('mso-'))
        .join(';');
      return `style="${cleaned}"`;
    }
  );

  // Remove mso-* properties from <style> blocks
  processed = processed.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, open: string, content: string, close: string) => {
      const cleaned = content.replace(/\bmso-[^;:]+\s*:[^;]+;?/gi, '');
      return `${open}${cleaned}${close}`;
    }
  );

  // Ensure the HTML has a proper structure
  if (!/<html[\s>]/i.test(processed)) {
    processed = `<html><head></head><body>${processed}</body></html>`;
  } else if (!/<head[\s>]/i.test(processed)) {
    processed = processed.replace(/<html([^>]*)>/i, '<html$1><head></head>');
  }

  // Add viewport meta if missing
  if (!/<meta[^>]*viewport/i.test(processed)) {
    processed = processed.replace(
      /<head([^>]*)>/i,
      '<head$1><meta name="viewport" content="width=device-width, initial-scale=1">'
    );
  }

  return processed;
}
