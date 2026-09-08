import { load } from 'cheerio';
import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, access, unlink } from 'node:fs/promises';
import path from 'node:path';
export const SOURCE = 'https://tap.az/shops/ayvatech?user_id=31349132';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function fetchSource(url, options = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['tap.az', 'tap.azstatic.com'].includes(u.hostname)) throw new Error('Untrusted source URL');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(u, { ...options, redirect: 'error', signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
      return response;
    } catch (error) { if (attempt === 2) throw error; await sleep(1500 * (attempt + 1)); }
  }
}
export async function nextData(url) {
  const $ = load(await (await fetchSource(url)).text());
  const text = $('#__NEXT_DATA__').text();
  if (!text) throw new Error('Tap.az structure changed: NEXT_DATA missing');
  return JSON.parse(text).props.pageProps;
}
export async function atomicJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await rename(temp, file);
}
export function mergeImported(existing, incoming) {
  const result = [...existing];
  const stats = { added: 0, updated: 0, skipped: 0, duplicates: 0 };
  const seen = new Set();
  for (const product of incoming) {
    if (seen.has(product.sourceId) || seen.has(product.sourceUrl)) { stats.duplicates++; continue; }
    seen.add(product.sourceId); seen.add(product.sourceUrl);
    const index = result.findIndex(p => p.sourceId === product.sourceId || p.sourceUrl === product.sourceUrl);
    if (index < 0) { result.push(product); stats.added++; continue; }
    const old = result[index];
    if (old.sourceHash === product.sourceHash) { stats.skipped++; continue; }
    // Imported AZ fields follow the source. Human translations, slug and publishing state survive imports.
    result[index] = { ...product, id: old.id, slug: old.slug, status: old.status,
      title: { ...old.title, az: product.title.az }, description: { ...old.description, az: product.description.az } };
    stats.updated++;
  }
  return { products: result, ...stats };
}
async function image(url, prefix, stats) {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const base = `/media/${prefix}-${hash}`;
  const original = `${base}-original.jpg`;
  const variants = [320, 640, 1280].map(width => ({ width, src: `${base}-${width}.webp` }));
  try { for (const p of [original, ...variants.map(v => v.src)]) await access(`public${p}`); }
  catch {
    const response = await fetchSource(url);
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('Invalid source image');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 25 * 1024 * 1024) throw new Error('Image too large');
    const source = sharp(buffer, { limitInputPixels: 60000000 }).rotate();
    await source.clone().jpeg({ quality: 95 }).toFile(`public${original}`);
    for (const v of variants) await source.clone().resize(v.width).webp({ quality: 84 }).toFile(`public${v.src}`);
    stats.photosDownloaded++;
  }
  const meta = await sharp(`public${variants[2].src}`).metadata();
  return { src: variants[2].src, original, sourceUrl: url, width: meta.width, height: meta.height, variants };
}
export async function importTap() {
  await mkdir('data', { recursive: true }); await mkdir('public/media', { recursive: true });
  const lockPath = 'data/import.lock';
  const { open } = await import('node:fs/promises');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Import already running (data/import.lock)'); });
  try {
    const startedAt = new Date().toISOString();
    const details = (await nextData(SOURCE)).shopDetails;
    if (details?.user?.legacyId !== '31349132') throw new Error('Unexpected shop identity');
    const nodes = []; let after = null; let expected = null; const cursors = new Set();
    do {
      const response = await fetchSource('https://tap.az/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        query: 'query GetShopAds($first:Int,$after:String,$filters:AdFilterInput!){ShopAds:ads(source:MOBILE,first:$first,after:$after,filters:$filters){edges{node{legacyResourceId path}}pageInfo{endCursor hasNextPage}totalCount}}',
        variables: { first: 20, after, filters: { userLegacyId: '31349132', isShop: true } }
      }) });
      const json = await response.json();
      if (json.errors) throw new Error(`Tap.az query failed: ${JSON.stringify(json.errors)}`);
      const ads = json.data.ShopAds;
      expected = ads.totalCount;
      nodes.push(...ads.edges.map(e => e.node));
      after = ads.pageInfo.hasNextPage ? ads.pageInfo.endCursor : null;
      if (after && cursors.has(after)) throw new Error('Repeated pagination cursor');
      cursors.add(after);
      await sleep(250);
    } while (after);
    if (new Set(nodes.map(n => n.legacyResourceId)).size !== expected) throw new Error('Incomplete catalogue; refusing partial write');
    const stats = { photosDownloaded: 0 };
    const assets = { photosDownloaded: 0 };
    const logo = await image(details.logo.url, 'logo', assets);
    const cover = await image(details.cover.url, 'cover', assets);
    const incoming = []; const raw = []; const seen = new Set(); let duplicates = 0;
    for (const node of nodes) {
      const sourceId = String(node.legacyResourceId);
      if (seen.has(sourceId)) { duplicates++; continue; } seen.add(sourceId);
      const sourceUrl = new URL(node.path, 'https://tap.az').href;
      const page = await nextData(sourceUrl);
      const ad = Object.values(page.apolloState || {}).find(v => v.__typename === 'Ad' && String(v.legacyResourceId) === sourceId);
      const shop = ad && page.apolloState[ad.shop?.__ref];
      if (!ad || shop?.uri !== '/shops/ayvatech') throw new Error(`Wrong/missing shop for ${sourceId}`);
      const structured = page.seoFullData.jsonLd.find(x => x['@type'] === 'Product');
      const breadcrumbs = page.seoFullData.jsonLd.find(x => x['@type'] === 'BreadcrumbList');
      const category = breadcrumbs?.itemListElement.at(-1);
      if (!category || !ad.photos?.length || !structured?.offers?.priceCurrency || !ad.body) throw new Error(`Incomplete product ${sourceId}`);
      const properties = ad.azProperties.map(p => ({ name: p.name.trim(), value: p.value }));
      const prop = name => properties.find(p => p.name === name)?.value || '';
      const images = [];
      for (const photo of ad.photos) images.push(await image(photo.url, sourceId, stats));
      const sourceFields = { title: ad.title, description: ad.body, price: ad.price, currency: structured.offers.priceCurrency, properties, images: ad.photos.map(p => p.url), status: ad.status, availability: structured.offers.availability, category: category.name };
      const slugTitle = ad.title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ə/g,'e').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75);
      incoming.push({ id: `tap-${sourceId}`, slug: `${slugTitle}-${sourceId}`, sourceId, sourceUrl,
        title: { az: ad.title, ru: '', en: '' }, description: { az: ad.body, ru: '', en: '' },
        price: ad.price, currency: structured.offers.priceCurrency,
        category: { az: category.name, ru: '', en: '' }, categorySlug: new URL(category.item, 'https://tap.az').pathname.split('/').at(-1),
        brand: prop('Marka'), model: prop('Model'), condition: prop('Yeni?'), availability: structured.offers.availability || '',
        properties, images, status: ad.status === 'APPROVED' ? 'published' : 'draft',
        sourceUpdatedAt: ad.updatedAt, importedAt: startedAt,
        sourceHash: createHash('sha256').update(JSON.stringify(sourceFields)).digest('hex') });
      raw.push({ sourceId, sourceUrl, ...sourceFields, updatedAt: ad.updatedAt });
      console.log(`Fetched ${incoming.length}/${expected}: ${sourceId} (${images.length} photos)`);
      await sleep(200);
    }
    let existing = [];
    try { existing = JSON.parse(await readFile('data/products.json', 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const merged = mergeImported(existing, incoming);
    const shopData = { name: details.name, promo: { az: details.promo, ru: 'Качественная электроника по доступной цене!', en: 'Quality electronics at affordable prices!' }, description: details.description, address: details.address, phones: details.phones,
      workingDays: details.workingDays, workingHours: details.workingHours, schedule: details.schedule, latitude: details.latitude, longitude: details.longitude, logo, cover, sourceUrl: SOURCE, sourceCount: expected, fetchedAt: startedAt };
    await atomicJSON('data/shop.json', shopData);
    await atomicJSON('data/source-products.json', raw);
    await atomicJSON('data/products.json', merged.products);
    const report = { startedAt, finishedAt: new Date().toISOString(), found: expected, added: merged.added, updated: merged.updated, skipped: merged.skipped, duplicates: merged.duplicates + duplicates, photosDownloaded: stats.photosDownloaded, brandAssetsDownloaded: assets.photosDownloaded, totalProductPhotos: incoming.reduce((s,p) => s+p.images.length,0) };
    await atomicJSON('data/import-report.json', report);
    return report;
  } finally { await lock.close(); await unlink(lockPath); }
}
