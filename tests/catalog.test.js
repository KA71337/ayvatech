import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterProducts, productSchema } from '../lib/products.js';
import { localized, categoryName, t } from '../lib/i18n.js';
import { mergeImported, fetchSource } from '../lib/importer.js';
const products = JSON.parse(await readFile('data/products.json', 'utf8'));
const source = JSON.parse(await readFile('data/source-products.json', 'utf8'));
test('every imported title, price, description, category, spec and photo matches the source snapshot', () => {
  assert.equal(source.length, 45);
  for (const raw of source) {
    const p = products.find(p => p.sourceId === raw.sourceId); assert.ok(p, raw.sourceId);
    productSchema.parse(p);
    assert.equal(p.title.az, raw.title); assert.equal(p.description.az, raw.description);
    assert.equal(p.price, raw.price); assert.equal(p.currency, raw.currency);
    assert.equal(p.category.az, raw.category); assert.deepEqual(p.properties, raw.properties);
    assert.equal(p.sourceUrl, raw.sourceUrl); assert.deepEqual(p.images.map(i => i.sourceUrl), raw.images);
  }
});
test('first import adds, repeated import skips, updates preserve human translations', () => {
  const p = structuredClone(products[0]);
  const first = mergeImported([], [p]); assert.equal(first.added, 1);
  const repeat = mergeImported(first.products, [p,p]); assert.equal(repeat.skipped, 1); assert.equal(repeat.duplicates, 1); assert.equal(repeat.products.length, 1);
  const old = { ...p, title: {...p.title, ru:'Перевод'}, category:{...p.category, en:'Translated category'}, status:'draft' };
  const incoming = {...p, sourceHash:'changed', price:p.price+1};
  const result = mergeImported([old], [incoming]); assert.equal(result.updated, 1);
  assert.equal(result.products[0].price, p.price+1); assert.equal(result.products[0].title.ru, 'Перевод'); assert.equal(result.products[0].category.en,'Translated category'); assert.equal(result.products[0].status,'draft');
});
test('source timestamps normalize offsets without changing the instant', () => {
  const p = products[0];
  const parsed = productSchema.parse({...p, sourceUpdatedAt:'2026-09-09T00:41:18+04:00'});
  assert.equal(parsed.sourceUpdatedAt, '2026-09-08T20:41:18.000Z');
  assert.equal(productSchema.parse(parsed).sourceUpdatedAt, parsed.sourceUpdatedAt);
  for (const value of ['invalid', '2026-02-30T12:00:00+04:00', '2026-09-08T12:00:00']) {
    assert.equal(productSchema.safeParse({...p, sourceUpdatedAt:value}).success, false);
  }
  const older = productSchema.parse({...p, id:'older', sourceUpdatedAt:'2026-09-09T00:00:00+04:00'});
  const newer = productSchema.parse({...p, id:'newer', sourceUpdatedAt:'2026-09-08T21:00:00Z'});
  assert.deepEqual(filterProducts([older,newer],{sort:'newest'}).items.map(p=>p.id), ['newer','older']);
});
test('source timestamp updates are persisted even when listing content is unchanged', () => {
  const p = productSchema.parse(products[0]);
  const incoming = {...p, sourceUpdatedAt:'2026-09-09T01:00:00.000Z'};
  const edited = {...p, price:p.price+10, title:{...p.title, az:'Redaktə', ru:'Перевод'}};
  const result = mergeImported([edited], [incoming]);
  assert.equal(result.updated, 1);
  assert.equal(result.products[0].sourceUpdatedAt, incoming.sourceUpdatedAt);
  assert.equal(result.products[0].price, edited.price);
  assert.deepEqual(result.products[0].title, edited.title);
  assert.equal(mergeImported(result.products, [incoming]).skipped, 1);
});
test('source identity handles URL-only entries without undefined collisions', () => {
  const a = {...products[0]}; delete a.sourceId;
  const b = {...products[1]}; delete b.sourceId;
  assert.equal(mergeImported([], [a,b]).added, 2);
  assert.throws(() => mergeImported([], [{title:{az:'missing source'}}]), /source identity/);
});
test('combined filters, sorting and pagination', () => {
  const p = products[0]; const spec = p.properties[0];
  const result = filterProducts(products, {q:p.title.az, category:p.categorySlug, brand:p.brand, min:String(p.price), max:String(p.price), spec:`${spec.name}::${spec.value}`, availability:p.availability}, 'az');
  assert.ok(result.items.some(x=>x.id===p.id));
  const sorted = filterProducts(products, {sort:'price-asc'}, 'az', 100).items;
  assert.deepEqual(sorted.map(p=>p.price), sorted.map(p=>p.price).sort((a,b)=>a-b));
  assert.equal(filterProducts(products,{page:'-5'}).page,1);
  assert.equal(filterProducts(products,{q:'no-such-product-xyz'}).total,0);
  assert.equal(filterProducts(products,{q:['invalid'],min:'NaN'}).total,products.length);
  const pages = Array.from({length:Math.ceil(products.length/12)},(_,i)=>filterProducts(products,{page:String(i+1)}).items).flat();
  assert.equal(new Set(pages.map(p=>p.id)).size,products.length);
});
test('AZ fallback and UI translations', () => {
  assert.equal(localized({az:'Mətn',ru:'',en:''},'ru'),'Mətn');
  assert.equal(categoryName({az:'Telefonlar',ru:'',en:''},'en'),'Phones');
  for(const lang of ['az','ru','en']) for(const key of ['login','save','PreOrder','pagination','language','imageInvalid']) assert.notEqual(t(key,lang),key);
});
test('schema rejects unsafe paths, invalid prices and publication without images', () => {
  const p = structuredClone(products[0]);
  assert.equal(productSchema.safeParse({...p,price:-1}).success,false);
  assert.equal(productSchema.safeParse({...p,slug:'../../admin'}).success,false);
  assert.equal(productSchema.safeParse({...p,images:[]}).success,false);
  p.images[0].src='/media/../../server.js'; assert.equal(productSchema.safeParse(p).success,false);
});
test('importer rejects external and insecure sources before network access', async () => {
  await assert.rejects(fetchSource('https://example.com/test'),/Untrusted/);
  await assert.rejects(fetchSource('http://tap.az/test'),/Untrusted/);
});
