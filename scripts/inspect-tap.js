import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('.cache', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const pending = [];
page.on('response', response => {
  if (response.request().resourceType() === 'xhr' || response.request().resourceType() === 'fetch') {
    pending.push((async () => {
      try {
        const text = await response.text();
        if (text.startsWith('{')) {
          const name = `.cache/response-${pending.length}.json`;
          await writeFile(name, text);
          console.log(JSON.stringify({ url: response.url(), status: response.status(), file: name, request: response.request().postData()?.slice(0, 1800) }));
        }
      } catch {}
    })());
  }
});
await page.goto('https://tap.az/shops/ayvatech?user_id=31349132', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(6000);
console.log((await page.locator('body').innerText()).slice(-16000));
await writeFile('.cache/shop.html', await page.content());
await writeFile('.cache/shop-next.json', JSON.stringify(await page.locator('#__NEXT_DATA__').evaluate(el => JSON.parse(el.textContent)), null, 2));
await page.screenshot({path: '.cache/tap-shop.png', fullPage: true});
await Promise.all(pending);
await browser.close();
