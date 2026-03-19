import { chromium, Browser, Page, BrowserContext, CDPSession } from 'patchright';

export interface BrowserPage {
  page: Page;
  cdp: CDPSession;
  context: BrowserContext;
}

const STEALTH_INIT_SCRIPT = () => {
  // Hide webdriver property
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Fake plugins array (headless has empty array which is suspicious)
  Object.defineProperty(navigator, 'plugins', {
    get: () => {
      const plugins = [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
      ];
      plugins.length = 3;
      return plugins;
    },
  });

  // Fake languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
  });

  // Chrome runtime object (missing in automation)
  if (!(window as any).chrome) {
    (window as any).chrome = {};
  }
  (window as any).chrome.runtime = {};
};

const REALISTIC_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class BrowserManager {
  private browser: Browser | null = null;

  async launch(): Promise<Browser> {
    if (this.browser) return this.browser;

    this.browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
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
      userAgent: REALISTIC_USER_AGENT,
    });

    await context.addInitScript(STEALTH_INIT_SCRIPT);

    const page = await context.newPage();

    // Create CDP session - this replaces chrome.debugger.attach()
    const cdp = await context.newCDPSession(page);

    // Enable CDP domains - replaces onDebuggerAttach() from snipbackground.js:306-341
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    // NOTE: Navigation is intentionally NOT done here so the caller can attach
    // CSS.styleSheetAdded listeners before the page loads (to capture all stylesheets).
    // Call navigatePage() after attaching listeners.

    return { page, cdp, context };
  }

  async navigatePage(bp: BrowserPage, url: string, timeout = 30000): Promise<void> {
    await bp.page.goto(url, {
      waitUntil: 'networkidle',
      timeout,
    });
  }

  async createPageFromHtml(html: string, baseUrl?: string, timeout = 30000): Promise<BrowserPage> {
    if (!this.browser) {
      await this.launch();
    }

    const context = await this.browser!.newContext({
      viewport: { width: 1366, height: 768 },
      ignoreHTTPSErrors: true,
      userAgent: REALISTIC_USER_AGENT,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });

    await context.addInitScript(STEALTH_INIT_SCRIPT);

    const page = await context.newPage();

    const cdp = await context.newCDPSession(page);

    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    await page.setContent(html, {
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
