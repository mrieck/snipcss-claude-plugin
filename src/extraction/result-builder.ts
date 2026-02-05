import { ExtractionContext, SnippedRule, ExtractionResult } from '../types/index.js';
import { CssVariableResolver } from './css-variable-resolver.js';
import { KeyframeCollector } from './keyframe-collector.js';
import { stripMarkerClasses } from '../utils/helpers.js';

/**
 * Builds the final CSS output from collected extraction data.
 * Port of handleSnippedResult from snipbackground.js:3498-5800
 * Simplified version focusing on CSS generation without extension-specific features.
 */
export class ResultBuilder {
  private variableResolver = new CssVariableResolver();
  private keyframeCollector = new KeyframeCollector();

  /**
   * Build the final extraction result from collected data.
   */
  buildResult(
    ctx: ExtractionContext,
    elementHtml: string,
    options: { resolveVariables: boolean }
  ): ExtractionResult {
    const cssLines: string[] = [];

    // 1. Add Google Font imports
    for (const importUrl of ctx.importfontsArr) {
      cssLines.push(`@import url("${importUrl}");`);
    }

    // 2. Add @font-face declarations for used fonts
    const usedFontFamilies = this.getUsedFontFamilies(ctx);
    for (const font of ctx.customfontsArr) {
      if (usedFontFamilies.has(font.font_family.toLowerCase())) {
        if (font.full_rule) {
          cssLines.push(font.full_rule);
        }
      }
    }

    // 3. Add CSS variable definitions if resolving
    if (options.resolveVariables) {
      const varsCss = this.variableResolver.generateVariablesCss(ctx);
      if (varsCss) {
        cssLines.push('');
        cssLines.push(varsCss);
      }
    }

    // 4. Group rules by media query
    const noMedia: SnippedRule[] = [];
    const mediaGroups = new Map<string, SnippedRule[]>();

    for (const rule of ctx.snippedArr) {
      if (rule.media) {
        if (!mediaGroups.has(rule.media)) {
          mediaGroups.set(rule.media, []);
        }
        mediaGroups.get(rule.media)!.push(rule);
      } else {
        noMedia.push(rule);
      }
    }

    // 5. Add non-media rules
    if (noMedia.length > 0) {
      cssLines.push('');
      for (const rule of noMedia) {
        const body = this.formatRuleBody(rule.body);
        cssLines.push(`${rule.selector} {`);
        cssLines.push(body);
        cssLines.push('}');
        cssLines.push('');
      }
    }

    // 6. Add media query grouped rules
    for (const [media, rules] of mediaGroups) {
      cssLines.push(`@media ${media} {`);
      for (const rule of rules) {
        const body = this.formatRuleBody(rule.body);
        cssLines.push(`  ${rule.selector} {`);
        cssLines.push(body.split('\n').map(l => '  ' + l).join('\n'));
        cssLines.push('  }');
        cssLines.push('');
      }
      cssLines.push('}');
      cssLines.push('');
    }

    // 7. Add keyframe animations
    const keyframesCss = this.keyframeCollector.generateCss(ctx);
    if (keyframesCss) {
      cssLines.push(keyframesCss);
    }

    // 8. Clean HTML
    const cleanHtml = stripMarkerClasses(elementHtml);

    // Resolve variables in CSS if requested
    let finalCss = cssLines.join('\n');
    if (options.resolveVariables) {
      finalCss = this.variableResolver.resolveVarReferences(finalCss, ctx);
    }

    return {
      html: cleanHtml,
      css: finalCss,
      tailwindHtml: '', // Filled in by tailwind converter later
      tailwindBodyClasses: '',
      fonts: ctx.customfontsArr.filter(f =>
        usedFontFamilies.has(f.font_family.toLowerCase())
      ),
      cssVariables: this.variableResolver.getResolvedVariables(ctx),
    };
  }

  /**
   * Format rule body from semicolon-delimited string to indented lines.
   */
  private formatRuleBody(body: string): string {
    return body
      .split(';')
      .map(prop => prop.trim())
      .filter(prop => prop.length > 0)
      .map(prop => `  ${prop};`)
      .join('\n');
  }

  /**
   * Determine which font families are actually used in the extracted CSS.
   */
  private getUsedFontFamilies(ctx: ExtractionContext): Set<string> {
    const used = new Set<string>();

    for (const rule of ctx.snippedArr) {
      if (!rule.body) continue;

      const fontMatch = rule.body.match(/font-family\s*:\s*([^;]+)/i);
      if (fontMatch) {
        const families = fontMatch[1].split(',').map(f =>
          f.trim().replace(/['"]/g, '').toLowerCase()
        );
        families.forEach(f => used.add(f));
      }

      // Also check shorthand font property
      const shortFontMatch = rule.body.match(/(?:^|;)\s*font\s*:\s*([^;]+)/i);
      if (shortFontMatch) {
        // Extract font-family from shorthand (it's the last part after /)
        const parts = shortFontMatch[1].split('/');
        if (parts.length > 1) {
          const familyPart = parts[parts.length - 1].trim();
          const families = familyPart.split(',').map(f =>
            f.trim().replace(/['"]/g, '').toLowerCase()
          );
          families.forEach(f => used.add(f));
        }
      }
    }

    return used;
  }
}
