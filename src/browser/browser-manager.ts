import { chromium, Browser, Page, BrowserContext, CDPSession } from 'playwright';

export interface BrowserPage {
  page: Page;
  cdp: CDPSession;
  context: BrowserContext;
}

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    return this.browser;
  }

  async createPage(url: string, timeout = 30000): Promise<BrowserPage> {
    if (!this.browser) {
      await this.launch();
    }

    const context = await this.browser!.newContext({
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Create CDP session - this replaces chrome.debugger.attach()
    const cdp = await context.newCDPSession(page);

    // Enable CDP domains - replaces onDebuggerAttach() from snipbackground.js:306-341
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // Navigate to URL
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });

    return { page, cdp, context };
  }

  async closePage(bp: BrowserPage): Promise<void> {
    try {
      await bp.cdp.detach();
    } catch {
      // CDP session may already be detached
    }
    await bp.page.close();
    await bp.context.close();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isRunning(): boolean {
    return this.browser !== null;
  }
}
