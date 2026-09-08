import assert from 'node:assert/strict';
import { mkdir, copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { load } from 'cheerio';
import { t, localized, money, categoryName, propertyText } from '../lib/i18n.js';
const dir = path.resolve('.test-data', `e2e-${Date.now()}`);
await mkdir(dir, {recursive:true});
for (const file of ['products.json','shop.json']) await copyFile(`data/${file}`, path.join(dir,file));
process.env.DATA_DIR=dir;
process.env.ADMIN_PASSWORD=randomBytes(24).toString('hex');
process.env.SESSION_SECRET=randomBytes(48).toString('hex');
process.env.NODE_ENV='test';
const { app }=await import('../server.js');
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
process.env.SITE_URL=base;
const products=JSON.parse(await readFile('data/products.json','utf8'));
const multi=products.find(p=>p.images.length>1);
const uploaded=[];
let browser;
const summary={productPages:0,responsivePages:0,widths:[320,375,390,430,768,1024,1440],browserErrors:[]};
try {
  browser=await chromium.launch();
  const context=await browser.newContext({baseURL:base});
  const page=await context.newPage();
  page.on('pageerror',error=>summary.browserErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('status of 401')&&!message.text().includes('status of 403')&&!message.text().includes('status of 409'))summary.browserErrors.push(message.text());});
  async function visit(url) { const response=await page.goto(url); assert.equal(response.status(),200,url); await page.locator('h1').first().waitFor(); }
  async function imagesWork() {
    await page.locator('img').evaluateAll(images=>images.forEach(img=>img.loading='eager'));
    await expect.poll(()=>page.locator('img').evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0)),{timeout:15000}).toBe(true);
  }
  async function noOverflow(label) {
    const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed';}).slice(0,8).map(e=>e.className)}));
    assert.ok(overflow.scroll<=overflow.width+1,`${label}: ${JSON.stringify(overflow)}`);
  }
  async function roundedProductMedia() {
    for (const [selector,radius] of [['.card-image, .hero-product, .gallery-main, .lightbox',20],['.gallery-thumbs button',12]]) {
      const styles = await page.locator(selector).evaluateAll(elements=>elements.map(element=>{
        const style=getComputedStyle(element);
        return {corners:[style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomRightRadius,style.borderBottomLeftRadius],overflow:style.overflow};
      }));
      for (const style of styles) {
        assert.deepEqual(style.corners,Array(4).fill(`${radius}px`),`${page.url()} ${selector}`);
        assert.equal(style.overflow,'hidden','Images must stay clipped to the rounded container, including on hover');
      }
    }
  }
  // HTTP verification of every product in every language, including escaped copy and SEO.
  for(const lang of ['az','ru','en'])for(const p of products.filter(p=>p.status==='published')){
    const url=`${lang==='az'?'':'/'+lang}/product/${p.slug}`;
    const response=await context.request.get(url); assert.equal(response.status(),200,url);
    const $=load(await response.text());
    assert.equal($('html').attr('lang'),lang); assert.equal($('h1').text(),localized(p.title,lang));
    assert.equal($('.description-text').text(),localized(p.description,lang));
    assert.equal($('.product-price').text(),money(p,lang));
    assert.equal($('.gallery-thumbs button').length,p.images.length);
    assert.deepEqual($('.spec-table dt').toArray().slice(0,p.properties.length).map(el=>$(el).text()),p.properties.map(s=>propertyText(s.name,lang)));
    assert.deepEqual($('.spec-table dd').toArray().slice(0,p.properties.length).map(el=>$(el).text()),p.properties.map(s=>propertyText(s.value,lang)));
    assert.equal($('.product-summary > .eyebrow').text(),categoryName(p.category,lang));
    assert.equal($('link[rel=canonical]').attr('href'),base+url);
    assert.equal($('link[hreflang]').length,4);
    const json=JSON.parse($('script[type="application/ld+json"]').text());
    assert.equal(json.find(x=>x['@type']==='Product').offers.price,p.price);
    assert.equal(json.find(x=>x['@type']==='Product').image.length,p.images.length);
    summary.productPages++;
  }
  for(const width of summary.widths){
    await page.setViewportSize({width,height:900});
    for(const route of [...['','/ru','/en'].flatMap(prefix=>['/','/catalog',`/product/${multi.slug}`,'/about','/contact'].map(route=>prefix+route)),'/admin/login']){
      await visit(route); await imagesWork(); await noOverflow(`${width} ${route}`); await roundedProductMedia(); summary.responsivePages++;
    }
    await visit('/');
    if(width<=1024){
      await page.locator('.menu-toggle').click();await expect(page.locator('#mobile-menu')).toBeVisible();
      await expect(page.locator('#mobile-menu a[href^="tel:"]')).toBeVisible();
      await page.locator('#mobile-menu a[href="/catalog"]').click();await expect(page).toHaveURL(/\/catalog$/);
      await page.locator('.menu-toggle').click();await page.locator('#mobile-menu a[href="/catalog#search"]').click();
      await expect(page.locator('#search')).toBeVisible();await expect(page.locator('#search')).toBeFocused();
      await noOverflow(`mobile search ${width}`);
    } else if(width>1200) { await expect(page.locator('.header-cta')).toBeVisible(); }
    if(width<=768){await visit('/catalog');await page.locator('.filter-toggle').click();await expect(page.locator('#filter-panel')).toBeVisible();await page.locator('#search').fill(products[0].title.az);await page.locator('.filters button[type=submit]').click();await expect(page.locator('.product-card')).not.toHaveCount(0);}
    await visit(`/product/${multi.slug}`);await page.locator('.gallery-thumbs button').nth(1).click();await expect(page.locator('#main-product-image')).toHaveAttribute('src',multi.images[1].src);await page.locator('[data-open-gallery]').click();await expect(page.locator('dialog')).toBeVisible();await page.keyboard.press('ArrowLeft');await expect(page.locator('.lightbox-counter')).toHaveText(`1 / ${multi.images.length}`);await page.keyboard.press('Escape');await expect(page.locator('dialog')).not.toBeVisible();
    await visit('/');await page.locator('.card-image').first().hover();await roundedProductMedia();await noOverflow(`card hover ${width}`);await page.screenshot({path:path.join(dir,`home-${width}.png`),fullPage:true});
  }
  // Decode every product image in the real browser, not only file existence.
  await page.setViewportSize({width:1440,height:900});
  for(const p of products){await visit(`/product/${p.slug}`);await imagesWork();for(let i=0;i<p.images.length;i++){await page.locator('.gallery-thumbs button').nth(i).click();await imagesWork();}}
  for(const lang of ['ru','en','az']){
    await page.locator(`.languages a[lang="${lang}"]`).click();await expect(page.locator('html')).toHaveAttribute('lang',lang);
    await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang',lang);
  }
  await visit('/catalog');await page.locator('#category').selectOption(products[0].categorySlug);await page.locator('#brand').selectOption(products[0].brand);await page.locator('input[name=min]').fill(String(products[0].price));await page.locator('input[name=max]').fill(String(products[0].price));await page.locator('.filters button[type=submit]').click();await expect(page.locator('.product-card')).not.toHaveCount(0);
  await visit('/catalog?page=2');await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',base+'/catalog?page=2');
  await visit('/catalog?q=no-such-product-xyz');await expect(page.locator('.empty-state')).toBeVisible();
  const sitemap=await context.request.get('/sitemap.xml');assert.equal(sitemap.status(),200);assert.equal(load(await sitemap.text(),{xmlMode:true})('url').length,(products.length+4)*3);
  const robots=await context.request.get('/robots.txt');assert.match(await robots.text(),/Disallow: \/admin/);
  assert.equal((await context.request.get('/product/not-existing')).status(),404);
  assert.equal((await context.request.get('/api/admin/products')).status(),401);
  assert.equal((await context.request.put('/api/admin/products/not-existing',{data:{}})).status(),401);
  assert.equal((await context.request.post('/api/admin/images',{multipart:{images:{name:'x.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')}}})).status(),401);
  for(const next of ['//outside.example','/ru//outside.example','/en/\\outside.example']) {
    const redirect=await context.request.get('/language/az?next='+encodeURIComponent(next),{maxRedirects:0});
    assert.equal(redirect.headers().location,'/');
  }
  await page.goto('/admin');await expect(page).toHaveURL(/\/admin\/login$/);
  const sessionBefore=(await context.cookies()).find(c=>c.name==='ayva.sid').value;
  assert.equal((await context.request.post('/admin/login',{form:{password:process.env.ADMIN_PASSWORD}})).status(),403);
  await page.locator('#password').fill(process.env.ADMIN_PASSWORD);await page.locator('button[type=submit]').click();await expect(page).toHaveURL(/\/admin$/);
  const sessionCookie=(await context.cookies()).find(c=>c.name==='ayva.sid');assert.notEqual(sessionCookie.value,sessionBefore);assert.equal(sessionCookie.httpOnly,true);assert.equal(sessionCookie.sameSite,'Strict');
  let token=await page.locator('meta[name=csrf-token]').getAttribute('content');
  assert.equal((await context.request.put('/api/admin/products/test',{data:{}})).status(),403);
  assert.equal((await context.request.post('/api/admin/images',{headers:{'x-csrf-token':token,origin:'https://invalid.example'},multipart:{images:{name:'x.png',mimeType:'image/png',buffer:Buffer.from('bad')}}})).status(),403);
  assert.equal((await context.request.post('/api/admin/images',{headers:{'x-csrf-token':token},multipart:{images:{name:'x.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')}}})).status(),400);
  assert.equal((await context.request.post('/api/admin/images',{headers:{'x-csrf-token':token},multipart:{images:{name:'invalid.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not an image')}}})).status(),400);
  await page.locator('a[href="/admin/product/new"]').click();
  const original=products[0];
  await page.locator('#title-az').fill(original.title.az+' <script>alert(1)</script>');
  await page.locator('#description-az').fill(original.description.az);
  await page.locator('#category-az').fill(original.category.az);
  await page.locator('#title-ru').fill('Тест локализации');
  await page.locator('#title-en').fill('Localization test');
  await page.locator('#slug').fill('e2e-isolated-product');
  await page.locator('#categorySlug').fill(original.categorySlug);
  await page.locator('#price').fill(String(original.price));
  await page.locator('#status').selectOption('published');
  await page.locator('#add-spec').click();await page.locator('[data-spec-field=name]').fill('Model');await page.locator('[data-spec-field=value]').fill(original.title.az);
  const uploadResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/images')&&r.request().method()==='POST');
  await page.locator('#image-upload').setInputFiles(['public'+original.images[0].original,'public'+multi.images[1].original]);
  const uploadedData=await (await uploadResponse).json();assert.equal(uploadedData.images.length,2);uploaded.push(...uploadedData.images.flatMap(i=>[i.original,...i.variants.map(v=>v.src)]));
  await expect(page.locator('.editor-image')).toHaveCount(2);await page.locator('.image-actions button').nth(1).click();
  await page.locator('.editor-image').nth(1).locator('.image-actions button').last().click();await expect(page.locator('.editor-image')).toHaveCount(1);
  await page.locator('button[type=submit]').click();await expect(page).toHaveURL(/\/admin\/product\/manual-/);
  const id=page.url().split('/').at(-1);
  await expect(page.locator('#editor-images img').first()).toHaveAttribute('src',uploadedData.images[1].src);
  await page.locator('#price').fill(String(original.price+10));await page.locator('#description-en').fill('Isolated test description');
  await page.locator('button[type=submit]').click();await expect(page.locator('#editor-message')).toHaveText(t('saved','az'));
  let stored=await (await context.request.get('/api/admin/products')).json();assert.equal(stored.products.find(p=>p.id===id).price,original.price+10);
  assert.equal((await context.request.put(`/api/admin/products/${id}`,{headers:{'x-csrf-token':token},data:{product:stored.products.find(p=>p.id===id),revision:'stale'}})).status(),409);
  assert.equal((await context.request.put(`/api/admin/products/${id}`,{headers:{'x-csrf-token':token},data:{product:{...stored.products.find(p=>p.id===id),price:-1},revision:stored.revision}})).status(),400);
  for(const width of summary.widths){await page.setViewportSize({width,height:900});await noOverflow(`admin editor ${width}`);}
  await visit('/product/e2e-isolated-product');await expect(page.locator('h1')).toHaveText(original.title.az+' <script>alert(1)</script>');assert.equal(await page.locator('h1 script').count(),0);
  await visit('/en/product/e2e-isolated-product');await expect(page.locator('h1')).toHaveText('Localization test');await expect(page.locator('.description-text')).toHaveText('Isolated test description');
  await visit('/'); // A published manual product has no sourceUpdatedAt.
  await visit(`/admin/product/${id}`);await page.locator('#status').selectOption('draft');await page.locator('button[type=submit]').click();await expect(page.locator('#editor-message')).toHaveText(t('saved','az'));assert.equal((await context.request.get('/product/e2e-isolated-product')).status(),404);
  await visit('/'); // Regression: manually created products do not require sourceUpdatedAt.
  await visit(`/admin/product/${id}`);page.once('dialog',dialog=>dialog.accept());await page.locator('#delete-product').click();await expect(page).toHaveURL(/\/admin$/);
  stored=await (await context.request.get('/api/admin/products')).json();assert.ok(!stored.products.some(p=>p.id===id));assert.equal(stored.products.length,products.length);
  await page.locator('form[action="/admin/logout"] button').click();await expect(page).toHaveURL(/\/admin\/login$/);assert.equal((await context.request.get('/api/admin/products')).status(),401);
  assert.deepEqual(summary.browserErrors,[]);
  summary.status='passed';await writeFile(path.join(dir,'report.json'),JSON.stringify(summary,null,2));
  console.log(`E2E OK: ${summary.productPages} localized product responses; ${summary.responsivePages} responsive pages at ${summary.widths.join(', ')}px; all product images decoded; languages, search, filters, pagination, gallery, SEO, login/session/logout, CSRF, authorization, XSS and admin CRUD/upload/reorder verified. Screenshots/report: ${dir}`);
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  for(const file of uploaded)await unlink('public'+file).catch(()=>{});
}
