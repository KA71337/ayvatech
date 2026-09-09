import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from '../scripts/build.js';
import { createPreview } from '../scripts/preview.js';
import { createAdminHandler } from '../api/admin.js';

test('build and public HTTP routes work without any admin/GitHub secrets or storage requests',async()=>{
  for(const key of ['GITHUB_TOKEN','GITHUB_OWNER','GITHUB_REPO','GITHUB_BRANCH','GITHUB_PRODUCTS_PATH','ADMIN_PASSWORD','SESSION_SECRET','SITE_URL'])delete process.env[key];
  await mkdir('.test-data',{recursive:true});
  const dir=await mkdtemp(path.resolve('.test-data','static-'));
  let server;
  let storageCalls=0;
  try {
    await build({outputDirectory:path.join(dir,'dist')});
    server=createPreview({directory:path.join(dir,'dist'),adminHandler:createAdminHandler({read:async()=>{storageCalls++;throw new Error('No GitHub on public requests');}})});
    server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    const products=JSON.parse(await readFile('data/products.json','utf8'));
    for(const prefix of ['','/ru','/en'])for(const route of ['/','/catalog','/about','/contacts','/product/'+products[0].slug]) {
      const response=await fetch(base+prefix+route);assert.equal(response.status,200,route);
      const html=await response.text();assert.match(html,/<html lang="(az|ru|en)"/);
      assert.ok(!html.includes('GITHUB_TOKEN'));assert.ok(!html.includes('SESSION_SECRET'));
    }
    assert.equal((await fetch(base+products[0].images[0].src)).status,200);
    const admin=await fetch(base+'/admin',{redirect:'manual'});assert.equal(admin.status,303);assert.equal(admin.headers.get('location'),'/admin/login');
    const login=await fetch(base+'/admin/login');assert.equal(login.status,200);assert.match(await login.text(),/disabled/);
    assert.equal((await fetch(base+'/api/admin/products')).status,401);
    assert.equal(storageCalls,0);
    const media=await readdir(path.join(dir,'dist/media'));
    const shop=JSON.parse(await readFile('data/shop.json','utf8'));
    const referenced=new Set([...products.flatMap(p=>p.images),shop.logo,shop.cover].flatMap(i=>[i.src,i.original,...i.variants.map(v=>v.src)]));
    assert.equal(media.length,referenced.size,'Only referenced product and branding images are published');
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
