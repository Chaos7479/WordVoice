// Export the repository's vector mark at Chrome's required icon sizes.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = await readFile('assets/icons/mark.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chromium' });
try {
  for (const size of [16, 48, 128]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: `assets/icons/icon${size}.png`, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
