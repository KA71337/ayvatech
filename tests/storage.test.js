import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, copyFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { acquireWriteLock } from '../lib/write-lock.js';

await mkdir('.test-data', {recursive:true});
const root = await mkdtemp(path.resolve('.test-data', 'storage-'));
process.env.DATA_DIR = root;
await copyFile('data/products.json', path.join(root, 'products.json'));
const {readProducts, mutateProducts, revision} = await import('../lib/storage.js');

test('real filesystem storage serializes edits, rejects conflicts and releases locks after failure', async () => {
  try {
    const initial = await readProducts();
    const rev = revision(initial);
    const results = await Promise.allSettled([
      mutateProducts(rev, products => { products[0].price += 1; return products; }),
      mutateProducts(rev, products => { products[0].price += 2; return products; })
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.status, 409);
    const current = await readProducts();
    assert.equal(current[0].price, initial[0].price + 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'products.json'), 'utf8')), current);
    const release = await acquireWriteLock(root);
    try {
      await assert.rejects(mutateProducts(revision(current), products => products), {status:409});
      await assert.rejects(acquireWriteLock(root), {status:409});
      assert.ok((await readdir(root)).includes('products.lock'));
    } finally { await release(); }
    await assert.rejects(mutateProducts(revision(current), products => { products[1].slug=products[0].slug; return products; }), {status:409});
    assert.deepEqual(await readProducts(), current);
    await assert.rejects(mutateProducts(revision(current), products => { products[0].price=-1; return products; }));
    assert.deepEqual(await readProducts(), current);
    const updated = await mutateProducts(revision(current), products => { products[0].title.ru='Проверка хранения'; return products; });
    assert.equal((await readProducts())[0].title.ru, 'Проверка хранения');
    assert.equal(updated.length, initial.length);
    assert.deepEqual(await readdir(root), ['products.json']);
  } finally { await rm(root, {recursive:true, force:true}); }
});
