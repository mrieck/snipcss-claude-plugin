import { Page } from 'playwright';
import { LabelResult } from '../types/index.js';
import { randomLetters } from '../utils/helpers.js';

/**
 * Labels DOM elements with unique snipcss marker classes.
 * Replaces the content script's snipcssLabelSubelements function.
 * Runs entirely via page.evaluate() - no content script needed.
 */
export class DomLabeler {
  /**
   * Label the target element and all its descendants with unique snipcss classes.
   * Returns the list of classnames and the HTML.
   *
   * Port of snipcssLabelSubelements from sniptools.js
   */
  async labelElements(page: Page, selector: string): Promise<LabelResult> {
    const snipId = randomLetters(4);

    const result = await page.evaluate(
      ({ selector, snipId }) => {
        const root = document.querySelector(selector);
        if (!root) {
          return {
            error: `Element not found: ${selector}`,
            allClassnamesArr: [],
            allElementOuterHtml: '',
            allLabelOuterHtml: '',
            rootSelector: selector,
            rootClassname: '',
          };
        }

        const allClassnamesArr: string[] = [];
        let idCounter = 0;

        function labelElement(elem: Element, parentId: number, level: number): void {
          if (elem.nodeType !== 1) return; // Element nodes only
          const tagName = elem.tagName.toLowerCase();

          // Skip script/style/noscript
          if (['script', 'style', 'noscript', 'link', 'meta'].includes(tagName)) return;

          const currId = idCounter++;
          const className = `snipcss${snipId}-${level}-${parentId}-${currId}`;

          elem.classList.add(className);
          allClassnamesArr.push(className);

          // Label children recursively
          const children = elem.children;
          for (let i = 0; i < children.length; i++) {
            labelElement(children[i], currId, level + 1);
          }
        }

        // Label root and all descendants
        labelElement(root, 0, 0);

        const rootClassname = allClassnamesArr[0] || '';

        // Capture HTML after labeling
        const allElementOuterHtml = root.outerHTML;

        // Also capture a version with just the labels for Tailwind
        const allLabelOuterHtml = root.outerHTML;

        return {
          allClassnamesArr,
          allElementOuterHtml,
          allLabelOuterHtml,
          rootSelector: selector,
          rootClassname,
        };
      },
      { selector, snipId }
    );

    if ('error' in result && result.error) {
      throw new Error(result.error as string);
    }

    return result as LabelResult;
  }

  /**
   * Remove all snipcss marker classes from the page DOM.
   * Called after extraction is complete.
   */
  async removeLabels(page: Page): Promise<void> {
    await page.evaluate(() => {
      const elements = document.querySelectorAll('[class*="snipcss"]');
      elements.forEach((elem) => {
        const classes = [...elem.classList];
        classes.forEach((cls) => {
          if (cls.startsWith('snipcss')) {
            elem.classList.remove(cls);
          }
        });
        // Clean up empty class attributes
        if (elem.classList.length === 0) {
          elem.removeAttribute('class');
        }
      });
    });
  }

  /**
   * Get the outerHTML of an element after labels have been removed.
   */
  async getCleanHtml(page: Page, selector: string): Promise<string> {
    return await page.evaluate((sel) => {
      const elem = document.querySelector(sel);
      if (!elem) return '';

      // Clone and remove snipcss classes
      const clone = elem.cloneNode(true) as Element;
      const labeled = clone.querySelectorAll('[class*="snipcss"]');
      labeled.forEach((el) => {
        const classes = [...el.classList];
        classes.forEach((cls) => {
          if (cls.startsWith('snipcss')) {
            el.classList.remove(cls);
          }
        });
        if (el.classList.length === 0) {
          el.removeAttribute('class');
        }
      });

      // Also clean the root
      const rootClasses = [...clone.classList];
      rootClasses.forEach((cls) => {
        if (cls.startsWith('snipcss')) {
          clone.classList.remove(cls);
        }
      });
      if (clone.classList.length === 0) {
        clone.removeAttribute('class');
      }

      return clone.outerHTML;
    }, selector);
  }
}
