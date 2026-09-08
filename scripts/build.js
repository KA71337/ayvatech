import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import sharp from 'sharp';
import { productSchema } from '../lib/products.js';
async function files(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(path.join(dir,e.name)) : path.join(dir,e.name)))).flat(); }
let checked = 0;
for (const file of ['server.js', ...await files('lib'), ...await files('scripts'), ...await files('tests'), ...await files('public')].filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`); checked++;
}
for (const file of (await files('views')).filter(f => f.endsWith('.ejs'))) ejs.compile(await readFile(file, 'utf8'), { filename: file });
for (const file of ['public/style.css','public/site.js','public/admin.js','views/login.ejs','views/admin.ejs','views/editor.ejs']) await access(file);
const products = JSON.parse(await readFile('data/products.json', 'utf8')).map(p => productSchema.parse(p));
const shop = JSON.parse(await readFile('data/shop.json', 'utf8'));
for (const field of ['id','slug','sourceId','sourceUrl']) { const values = products.map(p => p[field]).filter(Boolean); assert.equal(new Set(values).size, values.length, `Duplicate ${field}`); }
const assets = new Set();
for (const image of [...products.flatMap(p => p.images), shop.logo, shop.cover]) {
  for (const file of [image.src, image.original, ...image.variants.map(v => v.src)]) assets.add('public'+file);
  for (const variant of image.variants) assert.equal((await sharp('public'+variant.src).metadata()).width, variant.width, variant.src);
}
for (const file of assets) { const meta = await sharp(file).metadata(); assert.ok(meta.width && meta.height, file); }
console.log(`Build OK: ${checked} JavaScript files, all EJS templates, ${products.length} products, ${assets.size} image files validated. Express SSR: no static bundle required.`);
