import { readdir, readFile, access, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { render, prefix, siteURL, escapeXML } from '../lib/render.js';
import { languages, t, localized } from '../lib/i18n.js';
import { filterProducts } from '../lib/products.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import sharp from 'sharp';
import { productSchema } from '../lib/products.js';
import { fileURLToPath } from 'node:url';
export async function build({dataDirectory='data', outputDirectory='dist', mediaDirectory='public'}={}) {
const mediaFile = async file => {
  const candidate = path.join(mediaDirectory, file.slice('public'.length));
  try { await access(candidate); return candidate; } catch { return file; }
};
async function files(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(path.join(dir,e.name)) : path.join(dir,e.name)))).flat(); }
let checked = 0;
for (const file of [...await files('api'), ...await files('lib'), ...await files('scripts'), ...await files('tests'), ...await files('public')].filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`); checked++;
}
for (const file of (await files('views')).filter(f => f.endsWith('.ejs'))) ejs.compile(await readFile(file, 'utf8'), { filename: file });
for (const file of ['public/style.css','public/site.js','public/admin.js','views/login.ejs','views/admin.ejs','views/editor.ejs']) await access(file);
const products = JSON.parse(await readFile(path.join(dataDirectory,'products.json'), 'utf8')).map(p => productSchema.parse(p));
const shop = JSON.parse(await readFile(path.join(dataDirectory,'shop.json'), 'utf8'));
for (const field of ['id','slug','sourceId','sourceUrl']) { const values = products.map(p => p[field]).filter(Boolean); assert.equal(new Set(values).size, values.length, `Duplicate ${field}`); }
const assets = new Set(['public/media/ayvatech-logo.png','public/media/ayvatech-icon.png']);
for (const image of [...products.flatMap(p => p.images), shop.logo, shop.cover]) {
  for (const file of [image.src, image.original, ...image.variants.map(v => v.src)]) assets.add('public'+file);
  for (const variant of image.variants) assert.equal((await sharp(await mediaFile('public'+variant.src)).metadata()).width, variant.width, variant.src);
}
for (const file of assets) { const meta = await sharp(await mediaFile(file)).metadata(); assert.ok(meta.width && meta.height, file); }
const published=products.filter(p=>p.status==='published');
const base=siteURL();
assert.equal(new URL(base).protocol,'https:','SITE_URL must use HTTPS');
await rm(outputDirectory,{recursive:true,force:true});
await cp('public',outputDirectory,{recursive:true,filter:source => {
  const normalized = source.replaceAll('\\','/');
  return !normalized.startsWith('public/media/') || assets.has(normalized);
}});
for (const file of assets) {
  const destination=path.join(outputDirectory,file.slice('public'.length));
  await mkdir(path.dirname(destination),{recursive:true});
  await cp(await mediaFile(file),destination);
}
await mkdir(path.join(outputDirectory,'modules'),{recursive:true});
for (const name of ['i18n.js','filter-products.js']) await cp('lib/'+name,path.join(outputDirectory,'modules',name));
async function page(route,html) {
  const file=path.join(outputDirectory,route.endsWith('/')?`${route}index.html`:`${route}.html`);
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,html);
}
let pageCount=0;
for (const lang of languages) {
  for (const route of ['/','/catalog','/about','/contacts','/privacy',...published.map(p=>'/product/'+p.slug)]) {
    const data={lang,route,products:published};let view;
    if (route==='/') {view='home';data.title=`AyvaTech — ${t('heroTitle',lang).replace('\n',' ')}`;}
    else if (route==='/catalog') {view='catalog';data.result=filterProducts(published,{},lang);}
    else if (route.startsWith('/product/')) {
      view='product';data.product=published.find(p=>p.slug===route.slice(9));
      data.related=published.filter(p=>p.categorySlug===data.product.categorySlug&&p.id!==data.product.id).slice(0,4);
      data.title=localized(data.product.title,lang)+' | AyvaTech';data.metaDescription=localized(data.product.description,lang);
    } else {view='info';data.kind=route==='/contacts'?'contact':route.slice(1);}
    await page(prefix(lang)+route,await render(view,data));pageCount++;
  }
}
await page('/404',await render('info',{route:'/404',kind:'notFound',noindex:true,title:t('notFound')}));
const paths=['/','/catalog','/about','/contacts',...published.map(p=>'/product/'+p.slug)];
await writeFile(path.join(outputDirectory,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.flatMap(p=>languages.map(l=>`<url><loc>${escapeXML(base+prefix(l)+p)}</loc>${languages.map(a=>`<xhtml:link rel="alternate" hreflang="${a}" href="${escapeXML(base+prefix(a)+p)}"/>`).join('')}</url>`)).join('')}</urlset>`);
await writeFile(path.join(outputDirectory,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
console.log(`Build OK: ${checked} JavaScript files, ${pageCount+1} static pages, ${products.length} products, ${assets.size} image files validated. Output: ${outputDirectory}. No GitHub API or admin secrets required.`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
