import { CDPSession, Page } from 'playwright';
import { CDPRuleMatch, CDPMatchedStyles, CDPDocument } from '../types/index.js';

/**
 * Handles forcing pseudo-states (:hover, :active, :checked) on elements
 * and extracting the resulting matched styles.
 *
 * Port of snipbackground.js:1822-1995
 */
export class PseudoStateHandler {
  /**
   * Check if an element is a hover-capable tag.
   */
  async getTagName(page: Page, classname: string): Promise<string> {
    return await page.evaluate((cls) => {
      const elem = document.querySelector('.' + cls);
      return elem ? elem.tagName : '';
    }, classname);
  }

  /**
   * Check if an input element is a checkbox or radio.
   */
  async isCheckboxOrRadio(page: Page, classname: string): Promise<boolean> {
    return await page.evaluate((cls) => {
      const elem = document.querySelector('.' + cls) as HTMLInputElement;
      if (!elem) return false;
      return elem.type === 'checkbox' || elem.type === 'radio';
    }, classname);
  }

  /**
   * Get parent element snipcss classnames for pseudo-state forcing.
   * Parents also need hover forced so that parent:hover child selectors work.
   */
  async getParentClassnames(page: Page, classname: string): Promise<string[]> {
    return await page.evaluate((cls) => {
      const elem = document.querySelector('.' + cls);
      if (!elem) return [];

      const parents: string[] = [];
      let parent = elem.parentElement;
      while (parent && parent !== document.body) {
        const classes = [...parent.classList];
        const snipcssClass = classes.find(c => c.startsWith('snipcss'));
        if (snipcssClass) {
          parents.push(snipcssClass);
        }
        parent = parent.parentElement;
      }
      return parents;
    }, classname);
  }

  /**
   * Force hover/active pseudo-state on an element and its parents,
   * then extract the hover-specific matched styles.
   *
   * Returns only the rules that contain :hover in their selector.
   */
  async extractHoverStyles(
    cdp: CDPSession,
    page: Page,
    nodeId: number,
    classname: string,
    docRootNodeId: number
  ): Promise<CDPRuleMatch[]> {
    const tagName = await this.getTagName(page, classname);

    // Only hover-capable elements
    const hoverCapable = ['A', 'SPAN', 'BUTTON', 'DIV', 'LI', 'IMG'];
    if (!hoverCapable.includes(tagName)) return [];

    const hoverRules: CDPRuleMatch[] = [];

    try {
      // Force hover/active on the element
      await cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: ['hover', 'active'],
      });

      // Force hover on parent elements too
      const parentClassnames = await this.getParentClassnames(page, classname);
      const parentNodes: number[] = [];

      for (const parentCls of parentClassnames) {
        try {
          const pnode = await cdp.send('DOM.querySelector', {
            nodeId: docRootNodeId,
            selector: '.' + parentCls,
          });
          if (pnode.nodeId) {
            parentNodes.push(pnode.nodeId);
            await cdp.send('CSS.forcePseudoState', {
              nodeId: pnode.nodeId,
              forcedPseudoClasses: ['hover', 'active'],
            });
          }
        } catch {
          // Parent may not be found
        }
      }

      // Re-fetch matched styles with hover state active
      const allMatchedStyles2 = await cdp.send('CSS.getMatchedStylesForNode', {
        nodeId,
      }) as CDPMatchedStyles;

      // Collect normal hover rules
      for (const matchNormal of allMatchedStyles2.matchedCSSRules || []) {
        const selectorText = matchNormal.rule.selectorList?.text || '';
        if (selectorText.includes(':hover')) {
          (matchNormal.rule as any).origin = 'pseudo';
          hoverRules.push(matchNormal);
        }
      }

      // Collect inherited hover rules
      for (const inheritMatch of allMatchedStyles2.inherited || []) {
        for (const iRule of inheritMatch.matchedCSSRules || []) {
          const selectorText = iRule.rule.selectorList?.text || '';
          if (selectorText.includes(':hover')) {
            (iRule as any).inherited = true;
            (iRule.rule as any).origin = 'pseudo';
            hoverRules.push(iRule);
          }
        }
      }

      // Collect pseudo-element hover rules
      for (const pseudoMatch of allMatchedStyles2.pseudoElements || []) {
        for (const pMatch of pseudoMatch.matches) {
          const selectorText = pMatch.rule.selectorList?.text || '';
          if (selectorText.includes(':hover')) {
            (pMatch.rule as any).origin = 'psuedo';
            hoverRules.push({
              rule: pMatch.rule,
              matchingSelectors: pMatch.matchingSelectors,
            });
          }
        }
      }

      // Reset pseudo states
      await cdp.send('CSS.forcePseudoState', {
        nodeId,
        forcedPseudoClasses: [],
      });

      for (const parentNodeId of parentNodes) {
        try {
          await cdp.send('CSS.forcePseudoState', {
            nodeId: parentNodeId,
            forcedPseudoClasses: [],
          });
        } catch {
          // Ignore cleanup failures
        }
      }
    } catch (e) {
      console.error('Pseudo hover extraction error:', e);
    }

    return hoverRules;
  }

  /**
   * Extract :checked pseudo-state styles for checkbox/radio inputs.
   * Port of snipbackground.js:1933-1988
   */
  async extractCheckedStyles(
    cdp: CDPSession,
    page: Page,
    nodeId: number,
    classname: string,
    docRootNodeId: number
  ): Promise<CDPRuleMatch[]> {
    const tagName = await this.getTagName(page, classname);
    if (tagName !== 'INPUT') return [];

    const isCheckbox = await this.isCheckboxOrRadio(page, classname);
    if (!isCheckbox) return [];

    const checkedRules: CDPRuleMatch[] = [];

    try {
      // Force hover on parents (same pattern as hover extraction)
      const parentClassnames = await this.getParentClassnames(page, classname);
      const parentNodes: number[] = [];

      for (const parentCls of parentClassnames) {
        try {
          const pnode = await cdp.send('DOM.querySelector', {
            nodeId: docRootNodeId,
            selector: '.' + parentCls,
          });
          if (pnode.nodeId) {
            parentNodes.push(pnode.nodeId);
            await cdp.send('CSS.forcePseudoState', {
              nodeId: pnode.nodeId,
              forcedPseudoClasses: ['hover', 'active'],
            });
          }
        } catch {
          // Ignore
        }
      }

      const allMatchedStyles2 = await cdp.send('CSS.getMatchedStylesForNode', {
        nodeId,
      }) as CDPMatchedStyles;

      for (const matchNormal of allMatchedStyles2.matchedCSSRules || []) {
        const selectorText = matchNormal.rule.selectorList?.text || '';
        if (selectorText.includes(':checked')) {
          checkedRules.push(matchNormal);
        }
      }

      // Reset parent pseudo states
      for (const parentNodeId of parentNodes) {
        try {
          await cdp.send('CSS.forcePseudoState', {
            nodeId: parentNodeId,
            forcedPseudoClasses: [],
          });
        } catch {
          // Ignore
        }
      }
    } catch (e) {
      console.error('Checkbox extraction error:', e);
    }

    return checkedRules;
  }
}
