import { Actor } from 'apify';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Jimp from 'jimp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { initLogger, log, closeLogger } from './logger.js';
import type { Page } from 'playwright';
import { BrowserManager } from '../../src/browser/browser-manager.js';
import { ExtractionPipeline } from '../../src/extraction/extraction-pipeline.js';
import { discoverElements } from '../../src/extraction/element-discovery.js';
import type { ExtractionResult } from '../../src/types/index.js';

dotenv.config();

// ========================================
// Types
// ========================================

interface ElementScreenshotData {
  selector: string;
  screenshot_key: string | null;
  screenshot_width: number | null;
  screenshot_height: number | null;
  mobilescreenshot_key: string | null;
  mobilescreenshot_width: number | null;
  mobilescreenshot_height: number | null;
  ipadscreenshot_key: string | null;
  ipadscreenshot_width: number | null;
  ipadscreenshot_height: number | null;
}

interface PreviewUrl {
  selector: string;
  snip_id: string | number;
  snip_index: number;
}

interface FontItem {
  font_source: 'url';
  url: string;
}

interface ExtractedItem {
  selector: string;
  snip_html: string;
  snip_css: string;
  tailwind_html: string;
  tailwind_body_classes: string[];
  element_dimensions: null;
  images: never[];
  fonts: FontItem[];
}

interface SnippetPreviewData {
  task_uid: string;
  snip_url: string;
  snip_selector: string;
  snip_index: number;
  snip_html: string;
  snip_css: string;
  snip_himages: string[];
  snip_cimages: Array<{ url: string; name: string }>;
  snip_customfonts: string[];
  snip_fonturls: string[];
  tailwind_body_classes: string[];
  tailwind_html: string;
  tailwind_css: string;
  snip_uid: string;
}

interface ScreenshotMetadata {
  task_uid: string;
  screenshot_selector: string;
  screenshot_type: string;
  s3_url: string;
  width: number | null;
  height: number | null;
}

// ========================================
// UID Generator
// ========================================

function generateUid(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

// ========================================
// Preview API Helper
// ========================================

async function saveSnippetPreview(
  snippetData: SnippetPreviewData,
  serviceToken: string,
  baseUrl: string
): Promise<{ success: boolean; snip_id?: string | number; preview_url?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/add_apify_snippet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extension_token: serviceToken,
        ...snippetData,
      }),
    });

    const result = (await response.json()) as { success: boolean; snip_id?: string | number };
    if (result.success) {
      const previewUrl = `${baseUrl}/apify_automation/${snippetData.task_uid}`;
      console.log(`Preview saved: ${previewUrl}`);
      return { success: true, snip_id: result.snip_id, preview_url: previewUrl };
    }
    console.error('Failed to save preview:', result);
    return { success: false };
  } catch (error) {
    console.error('Error saving snippet preview:', error);
    return { success: false };
  }
}

// ========================================
// AWS S3 Upload Helper
// ========================================

const AWS_CONFIG = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  region: process.env.AWS_REGION ?? 'us-east-1',
  bucket: process.env.AWS_S3_BUCKET ?? 'snipcss-images',
};

if (!AWS_CONFIG.accessKeyId || !AWS_CONFIG.secretAccessKey) {
  console.error('ERROR: AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env');
}

const s3Client = new S3Client({
  region: AWS_CONFIG.region,
  credentials: {
    accessKeyId: AWS_CONFIG.accessKeyId,
    secretAccessKey: AWS_CONFIG.secretAccessKey,
  },
});

async function uploadToS3(buffer: Buffer, fileName: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: AWS_CONFIG.bucket,
    Key: fileName,
    Body: buffer,
    ContentType: 'image/png',
    ACL: 'public-read',
    CacheControl: 'max-age=2592000',
  });
  await s3Client.send(command);
  const s3Url = `https://${AWS_CONFIG.bucket}.s3.amazonaws.com/${fileName}`;
  console.log(`Uploaded to S3: ${s3Url}`);
  return s3Url;
}

async function saveScreenshotMetadata(data: ScreenshotMetadata, baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/add_automation_screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as { success: boolean };
    if (!result.success) console.error('Failed to save screenshot metadata:', result);
  } catch (error) {
    console.error('Error saving screenshot metadata:', error);
  }
}

async function saveResultScreenshotMetadata(data: ScreenshotMetadata, baseUrl: string): Promise<void> {
  try {
    const response = await fetch(`${baseUrl}/api/update_automation_result_screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as { success: boolean };
    if (!result.success) console.error('Failed to save result screenshot metadata:', result);
  } catch (error) {
    console.error('Error saving result screenshot metadata:', error);
  }
}

async function createAutomationTask(
  taskData: { task_uid: string; start_url: string; task_type: string; selectors: string[] | null },
  serviceToken: string,
  baseUrl: string
): Promise<{ success: boolean; task_uid?: string; task_id?: number }> {
  try {
    const response = await fetch(`${baseUrl}/api/add_apify_automation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extension_token: serviceToken,
        snippet_limit: 100,
        ...taskData,
      }),
    });
    const result = (await response.json()) as { success: boolean; task_uid?: string; task_id?: number };
    if (result.success) {
      console.log(`Automation task created: ${result.task_uid} (ID: ${result.task_id})`);
    } else {
      console.error('Failed to create automation task:', result);
    }
    return result;
  } catch (error) {
    console.error('Error creating automation task:', error);
    return { success: false };
  }
}

// ========================================
// Screenshot Helper Functions
// ========================================

async function cropImage(
  fullPageBuffer: Buffer,
  rect: { x: number; y: number; width: number; height: number }
): Promise<Buffer> {
  const image = await Jimp.read(fullPageBuffer);
  image.crop(Math.floor(rect.x), Math.floor(rect.y), Math.ceil(rect.width), Math.ceil(rect.height));
  return await image.getBufferAsync(Jimp.MIME_PNG);
}

async function cropFullWidthImage(fullPageBuffer: Buffer, top: number, height: number): Promise<Buffer> {
  const image = await Jimp.read(fullPageBuffer);
  const fullWidth = image.bitmap.width;
  const safeHeight = Math.min(Math.ceil(height), image.bitmap.height - Math.floor(top));
  console.log(`Full width: ${fullWidth}, top: ${Math.floor(top)}, height: ${safeHeight}`);
  image.crop(0, Math.floor(top), fullWidth, safeHeight);
  return await image.getBufferAsync(Jimp.MIME_PNG);
}

async function cropExtraIpadSpace(fullPageBuffer: Buffer): Promise<Buffer> {
  const image = await Jimp.read(fullPageBuffer);
  if (image.bitmap.width > 768) {
    console.log(`Cropping iPad width from ${image.bitmap.width} to 768`);
    image.crop(0, 0, 768, image.bitmap.height);
  }
  return await image.getBufferAsync(Jimp.MIME_PNG);
}

async function ensureElementVisibility(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch (error: unknown) {
    console.log('Could not scroll element into view:', (error as Error).message);
  }
  const handle = await locator.elementHandle();
  if (handle) {
    await page.evaluate((el) => void (el as HTMLElement).offsetTop, handle);
  }
  await page.waitForTimeout(100);
}

async function getAbsoluteBoundingRect(
  locator: ReturnType<Page['locator']>
): Promise<{ x: number; y: number; width: number; height: number }> {
  return locator.evaluate((element: Element) => {
    const rect = element.getBoundingClientRect();
    const tag = element.tagName.toLowerCase();

    if (tag === 'body' || tag === 'html') {
      const width = Math.max(
        element.scrollWidth,
        (element as HTMLElement).offsetWidth,
        element.clientWidth,
        document.documentElement.scrollWidth
      );
      const height = Math.max(
        element.scrollHeight,
        (element as HTMLElement).offsetHeight,
        element.clientHeight,
        document.documentElement.scrollHeight
      );
      return { x: 0, y: 0, width, height };
    }

    if (rect.height === 0) {
      const height =
        element.scrollHeight ||
        (element as HTMLElement).offsetHeight ||
        parseFloat(window.getComputedStyle(element).height) ||
        0;
      const width =
        rect.width ||
        element.scrollWidth ||
        (element as HTMLElement).offsetWidth ||
        parseFloat(window.getComputedStyle(element).width) ||
        0;
      return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width, height };
    }

    if (rect.width === 0 && rect.height === 0) {
      const style = window.getComputedStyle(element);
      let x = 0;
      let y = 0;
      let cur: Element | null = element;
      while (cur) {
        x += (cur as HTMLElement).offsetLeft || 0;
        y += (cur as HTMLElement).offsetTop || 0;
        cur = (cur as HTMLElement).offsetParent as Element | null;
      }
      return { x, y, width: parseFloat(style.width), height: parseFloat(style.height) };
    }

    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    };
  });
}

// ========================================
// Original Screenshot Capture
// (replaces the screenshot loops from handleExtensionMessage)
// All postMessage viewport signals removed — just setViewportSize directly
// ========================================

async function captureOriginalScreenshots(
  page: Page,
  selectors: string[],
  task_uid: string,
  BASE_URL: string
): Promise<ElementScreenshotData[]> {
  const elementData: ElementScreenshotData[] = selectors.map((selector) => ({
    selector,
    screenshot_key: null,
    screenshot_width: null,
    screenshot_height: null,
    mobilescreenshot_key: null,
    mobilescreenshot_width: null,
    mobilescreenshot_height: null,
    ipadscreenshot_key: null,
    ipadscreenshot_width: null,
    ipadscreenshot_height: null,
  }));

  // Desktop loop
  console.log('Starting desktop screenshot capture...');
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(2000);

  for (let i = 0; i < selectors.length; i++) {
    const selector = selectors[i];
    console.log(`Desktop [${i}]: ${selector}`);
    const locator = page.locator(selector);
    if (!(await locator.count())) { console.log(`Not found: ${selector}`); continue; }

    await ensureElementVisibility(page, locator);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    try { rect = await getAbsoluteBoundingRect(locator); } catch (e) { console.log(`Rect error [${i}]:`, e); }

    if (rect) {
      try {
        const fullPage = await page.screenshot({ fullPage: true, omitBackground: true });
        const cropped = await cropImage(fullPage, rect);
        const key = `original_screenshot_${task_uid}_element_${i}`;
        await Actor.setValue(key, cropped, { contentType: 'image/png' });
        const s3Url = await uploadToS3(cropped, `${key}.png`);
        await saveScreenshotMetadata({ task_uid, screenshot_selector: selector, screenshot_type: 'original_extraction', s3_url: s3Url, width: rect.width, height: rect.height }, BASE_URL);
        elementData[i].screenshot_key = key;
        elementData[i].screenshot_width = rect.width;
        elementData[i].screenshot_height = rect.height;
      } catch (e) { console.log(`Desktop screenshot error [${i}]:`, e); }
    }
  }

  // Mobile loop
  console.log('Starting mobile screenshot capture...');
  for (let j = 0; j < selectors.length; j++) {
    const selector = selectors[j];
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(1000);
    const locator = page.locator(selector);
    if (!(await locator.count())) continue;

    await ensureElementVisibility(page, locator);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    try { rect = await getAbsoluteBoundingRect(locator); } catch (e) { console.log(`Mobile rect error [${j}]:`, e); }

    if (rect) {
      try {
        const fullPage = await page.screenshot({ fullPage: true, omitBackground: true });
        const cropped = await cropFullWidthImage(fullPage, rect.y, rect.height);
        const key = `original_mobile_screenshot_${task_uid}_element_${j}`;
        await Actor.setValue(key, cropped, { contentType: 'image/png' });
        const s3Url = await uploadToS3(cropped, `${key}.png`);
        await saveScreenshotMetadata({ task_uid, screenshot_selector: selector, screenshot_type: 'original_mobile_extraction', s3_url: s3Url, width: rect.width, height: rect.height }, BASE_URL);
        elementData[j].mobilescreenshot_key = key;
        elementData[j].mobilescreenshot_width = rect.width;
        elementData[j].mobilescreenshot_height = rect.height;
      } catch (e) { console.log(`Mobile screenshot error [${j}]:`, e); }
    }
  }

  // iPad loop
  console.log('Starting iPad screenshot capture...');
  for (let k = 0; k < selectors.length; k++) {
    const selector = selectors[k];
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(1000);
    const locator = page.locator(selector);
    if (!(await locator.count())) continue;

    await ensureElementVisibility(page, locator);
    let rect: { x: number; y: number; width: number; height: number } | null = null;
    try { rect = await getAbsoluteBoundingRect(locator); } catch (e) { console.log(`iPad rect error [${k}]:`, e); }

    if (rect) {
      try {
        let fullPage = await page.screenshot({ fullPage: true, omitBackground: true });
        fullPage = await cropExtraIpadSpace(fullPage);
        const cropped = await cropFullWidthImage(fullPage, rect.y, rect.height);
        const key = `original_ipad_screenshot_${task_uid}_element_${k}`;
        await Actor.setValue(key, cropped, { contentType: 'image/png' });
        const s3Url = await uploadToS3(cropped, `${key}.png`);
        await saveScreenshotMetadata({ task_uid, screenshot_selector: selector, screenshot_type: 'original_ipad_extraction', s3_url: s3Url, width: rect.width, height: rect.height }, BASE_URL);
        elementData[k].ipadscreenshot_key = key;
        elementData[k].ipadscreenshot_width = rect.width;
        elementData[k].ipadscreenshot_height = rect.height;
      } catch (e) { console.log(`iPad screenshot error [${k}]:`, e); }
    }
  }

  // Reset to desktop
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(500);
  return elementData;
}

// ========================================
// Result Screenshot Capture
// (postMessage viewport signals removed — setViewportSize only)
// ========================================

async function takeResultScreenshots(
  page: Page,
  previewUrls: PreviewUrl[],
  automationUid: string,
  baseUrl: string
): Promise<void> {
  console.log(`=== STARTING RESULT SCREENSHOT CAPTURE (${previewUrls.length} snippets) ===`);

  for (let i = 0; i < previewUrls.length; i++) {
    const preview = previewUrls[i];
    console.log(`\n[${i + 1}/${previewUrls.length}] Snippet ${preview.snip_index}: ${preview.selector}`);

    try {
      // CSS version
      await page.goto(`${baseUrl}/embedautomation/${automationUid}-${preview.snip_index}?version=css`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      for (const [vp, type] of [
        [{ width: 1366, height: 768 }, 'css_extraction'],
        [{ width: 320, height: 568 }, 'css_mobile_extraction'],
        [{ width: 768, height: 1024 }, 'css_ipad_extraction'],
      ] as [{ width: number; height: number }, string][]) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(1000);
        try {
          const buf = await page.screenshot({ fullPage: true, omitBackground: true });
          const key = `css_result_${automationUid}_${type}_${preview.snip_index}.png`;
          const s3Url = await uploadToS3(buf, key);
          await saveResultScreenshotMetadata({ task_uid: automationUid, screenshot_selector: preview.selector, screenshot_type: type, s3_url: s3Url, width: vp.width, height: null }, baseUrl);
          await Actor.setValue(key, buf, { contentType: 'image/png' });
        } catch (e) { console.error(`Error: ${type} screenshot:`, e); }
      }

      // Tailwind version
      await page.goto(`${baseUrl}/embedautomation/${automationUid}-${preview.snip_index}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      for (const [vp, type] of [
        [{ width: 1366, height: 768 }, 'tailwind_extraction'],
        [{ width: 320, height: 568 }, 'tailwind_mobile_extraction'],
        [{ width: 768, height: 1024 }, 'tailwind_ipad_extraction'],
      ] as [{ width: number; height: number }, string][]) {
        await page.setViewportSize(vp);
        await page.waitForTimeout(1000);
        try {
          const buf = await page.screenshot({ fullPage: true, omitBackground: true });
          const key = `tailwind_result_${automationUid}_${type}_${preview.snip_index}.png`;
          const s3Url = await uploadToS3(buf, key);
          await saveResultScreenshotMetadata({ task_uid: automationUid, screenshot_selector: preview.selector, screenshot_type: type, s3_url: s3Url, width: vp.width, height: null }, baseUrl);
          await Actor.setValue(key, buf, { contentType: 'image/png' });
        } catch (e) { console.error(`Error: ${type} screenshot:`, e); }
      }

      console.log(`✓ Snippet ${preview.snip_index} done`);
    } catch (e: unknown) {
      console.error(`Error processing snippet ${preview.snip_index}:`, (e as Error).message);
    }
  }

  console.log('\n=== RESULT SCREENSHOT CAPTURE COMPLETE ===');
}

// ========================================
// Main
// ========================================

const SNIPCSS_API_BASE_URL = 'https://templates.snipcss.com';
const APIFY_SERVICE_TOKEN = 'apify_service_token_placeholder'; // TODO: Replace with actual token

const __actorFilename = fileURLToPath(import.meta.url);
const __actorDirname = dirname(__actorFilename);
// actor/dist/actor/src/ → up 3 levels → actor/ → logs/
const LOGS_DIR = path.join(__actorDirname, '../../..', 'logs');

await Actor.init();
await initLogger(LOGS_DIR);

const BASE_URL = SNIPCSS_API_BASE_URL;
console.log(`Using API Base URL: ${BASE_URL}`);

const input = (await Actor.getInput()) as {
  url?: string;
  selectors?: string[];
  save_preview?: boolean;
  maxSegments?: number;
  skip_original_screenshots?: boolean;
} | null ?? {};

let {
  url = 'https://pmvibes.ai',
  selectors = [],
  save_preview = false,
  maxSegments = 6,
  skip_original_screenshots = false,
} = input;

// Validate selectors
const invalidSelectors = selectors.filter((s) => s === 'html' || s === 'head');
if (invalidSelectors.length > 0) {
  const msg = `Invalid selectors: '${invalidSelectors.join("', '")}'. Use specific selectors or leave empty to auto-segment.`;
  console.error(msg);
  await Actor.fail(msg);
  await Actor.exit();
}

const mode = selectors.length === 0 ? 'extract_all' : 'extract_selector';
const startTime = Date.now();
const automationUid = `apify_${generateUid(12)}`;

console.log(`Starting SnipCSS Actor...`);
console.log(`URL: ${url}`);
console.log(`Mode: ${mode}`);
console.log(`Selectors: ${selectors.length === 0 ? '[auto-segment]' : JSON.stringify(selectors)}`);
console.log(`Automation UID: ${automationUid}`);

try {
  // Create parent task record
  const taskResult = await createAutomationTask(
    { task_uid: automationUid, start_url: url, task_type: mode, selectors: selectors.length === 0 ? null : selectors },
    APIFY_SERVICE_TOKEN, BASE_URL
  );
  if (!taskResult.success) console.warn('Failed to create automation task. Continuing...');

  // Launch browser for element discovery + original screenshots
  const browserManager = new BrowserManager();
  const pipeline = new ExtractionPipeline(browserManager);

  const screenshotBp = await browserManager.createPage(url);
  const page = screenshotBp.page;
  await browserManager.navigatePage(screenshotBp, url);

  // Determine target selectors
  let targetSelectors: string[] = selectors;
  if (targetSelectors.length === 0) {
    console.log('Auto-segmenting page...');
    const discovered = await discoverElements(page);
    targetSelectors = discovered.slice(0, maxSegments).map((e) => e.selector);
    console.log(`Discovered ${discovered.length} elements, using ${targetSelectors.length}:`);
    targetSelectors.forEach((sel, idx) => console.log(`  [${idx}] ${sel}`));
  }

  if (targetSelectors.length === 0) {
    await browserManager.closePage(screenshotBp);
    await browserManager.close();
    const msg = `No suitable page sections found on ${url}.`;
    await Actor.fail(msg);
    await Actor.exit();
  }

  // Capture original screenshots (desktop, mobile, iPad)
  let screenshotData: ElementScreenshotData[];
  if (!skip_original_screenshots) {
    console.log('Capturing original screenshots...');
    screenshotData = await captureOriginalScreenshots(page, targetSelectors, automationUid, BASE_URL);
  } else {
    console.log('Skipping original screenshots.');
    screenshotData = targetSelectors.map((selector) => ({
      selector,
      screenshot_key: null, screenshot_width: null, screenshot_height: null,
      mobilescreenshot_key: null, mobilescreenshot_width: null, mobilescreenshot_height: null,
      ipadscreenshot_key: null, ipadscreenshot_width: null, ipadscreenshot_height: null,
    }));
  }

  // Close screenshot page — ExtractionPipeline opens its own pages per extraction
  await browserManager.closePage(screenshotBp);

  // Extract CSS for each selector using the plugin's native CDP pipeline
  const extractedItems: ExtractedItem[] = [];
  const previewUrls: PreviewUrl[] = [];
  let limitReached = false;

  for (let i = 0; i < targetSelectors.length; i++) {
    if (limitReached) break;
    const selector = targetSelectors[i];
    console.log(`\nExtracting CSS [${i}]: ${selector}`);

    try {
      const result: ExtractionResult = await pipeline.extract(url, selector, {
        viewport: 'all',
        resolveVariables: true,
        includeHoverStates: true,
        logger: log,
      });

      const fontUrls = result.fonts.map((f) => f.font_url).filter(Boolean);
      const tailwindBodyClassesArr = result.tailwindBodyClasses
        ? result.tailwindBodyClasses.split(/\s+/).filter(Boolean)
        : [];

      extractedItems.push({
        selector,
        snip_html: result.html,
        snip_css: result.css,
        tailwind_html: result.tailwindHtml,
        tailwind_body_classes: tailwindBodyClassesArr,
        element_dimensions: null,
        images: [],
        fonts: fontUrls.map((fontUrl) => ({ font_source: 'url' as const, url: fontUrl })),
      });

      if (result.html && result.css) {
        // Charge per segment
        try {
          const chargeResult = (await Actor.charge({ eventName: 'SEGMENT_EXTRACTED', count: 1 })) as { eventChargeLimitReached?: boolean };
          console.log(`Charged for segment: ${selector}`);
          if (chargeResult?.eventChargeLimitReached) {
            console.log('Charge limit reached — stopping extraction.');
            limitReached = true;
          }
        } catch (e) { console.error('Error charging:', e); }

        // Save preview
        if (save_preview) {
          const snippetUid = generateUid(12);
          const previewResult = await saveSnippetPreview({
            task_uid: automationUid,
            snip_url: url,
            snip_selector: selector,
            snip_index: i,
            snip_html: result.html,
            snip_css: result.css,
            snip_himages: [],
            snip_cimages: [],
            snip_customfonts: [],
            snip_fonturls: fontUrls,
            tailwind_body_classes: tailwindBodyClassesArr,
            tailwind_html: result.tailwindHtml ?? '',
            tailwind_css: result.tailwindCss,
            snip_uid: snippetUid,
          }, APIFY_SERVICE_TOKEN, BASE_URL);

          if (previewResult.success && previewResult.snip_id !== undefined) {
            previewUrls.push({ selector, snip_id: previewResult.snip_id, snip_index: i });
          }
        }
      }
    } catch (e) {
      console.error(`Extraction error [${i}] ${selector}:`, e);
    }
  }

  await browserManager.close();

  if (extractedItems.length === 0) {
    const msg = `No elements could be extracted from ${url}. Verify selectors are correct.`;
    console.error(msg);
    await Actor.fail(msg);
    await Actor.exit();
  }

  // Build result
  const screenshotMetadata = screenshotData!.map((elem) => ({
    selector: elem.selector,
    desktop: elem.screenshot_key ? { key: elem.screenshot_key, width: elem.screenshot_width, height: elem.screenshot_height } : null,
    mobile: elem.mobilescreenshot_key ? { key: elem.mobilescreenshot_key, width: elem.mobilescreenshot_width, height: elem.mobilescreenshot_height } : null,
    ipad: elem.ipadscreenshot_key ? { key: elem.ipadscreenshot_key, width: elem.ipadscreenshot_width, height: elem.ipadscreenshot_height } : null,
  }));

  const result = {
    url,
    mode,
    selectors,
    automation_uid: automationUid,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
    status: 'completed',
    extracted_data: extractedItems,
    screenshots: screenshotMetadata,
    preview_link: save_preview && previewUrls.length > 0
      ? { url: `${BASE_URL}/apify_automation/${automationUid}`, selectors: previewUrls }
      : {},
  };

  await Actor.pushData(result);
  console.log('Results saved to dataset.');

  // Capture result screenshots if previews were saved
  if (save_preview && previewUrls.length > 0) {
    console.log(`\nCapturing result screenshots for ${previewUrls.length} snippet(s)...`);
    try {
      const resultBm = new BrowserManager();
      const resultBp = await resultBm.createPage(`${BASE_URL}/apify_automation/${automationUid}`);
      await takeResultScreenshots(resultBp.page, previewUrls, automationUid, BASE_URL);
      await resultBm.close();
      console.log('Result screenshots done.');
    } catch (e) {
      console.error('Error during result screenshot capture:', e);
    }
    console.log(`\nPreview: ${BASE_URL}/apify_automation/${automationUid}`);
  }

} catch (error: unknown) {
  const e = error as Error;
  console.error('Error during execution:', e);
  await closeLogger();
  await Actor.pushData({
    url, mode, selectors,
    timestamp: new Date().toISOString(),
    status: 'error',
    error: e.message,
    stack: e.stack,
  });
  throw error;
}

await closeLogger();
console.log('SnipCSS Actor completed successfully!');
await Actor.exit();
