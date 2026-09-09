// GitHub HTTP boundary fixture: exercises the real storage client without remote writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createGitHub } from '../../lib/github.js';
const sha = value => createHash('sha1').update(value).digest('hex');
export async function githubFixture(directory) {
  const catalogueFile = path.join(directory,'products.json');
  const files = new Map();
  const products = JSON.parse(await readFile(catalogueFile,'utf8'));
  for (const p of products) for (const image of p.images) for (const src of [image.src,image.original,...image.variants.map(v=>v.src)]) files.set('public'+src, true);
  const blobs = new Map(), trees = new Map(), commits = new Map();
  let head = 'initial-head';
  const response = (status,body={}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  const calls=[];
  async function fetcher(url, options) {
    const u = new URL(url);
    const endpoint = u.pathname.replace(/^\/repos\/[^/]+\/[^/]+\//,'');
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({endpoint,method:options.method});
    if (endpoint==='contents/data/products.json') {
      const content = await readFile(catalogueFile,'utf8');
      if (options.method==='GET') return response(200,{encoding:'base64',sha:sha(content),content:Buffer.from(content).toString('base64')});
      if (body.sha!==sha(content)) return response(409);
      const next = Buffer.from(body.content,'base64');
      await writeFile(catalogueFile,next); head=sha(next);
      return response(200,{content:{sha:head}});
    }
    if (endpoint==='git/ref/heads/main') return response(200,{object:{sha:head}});
    if (endpoint.startsWith('git/commits/')) return response(200,{tree:{sha:'current-tree'}});
    if (endpoint==='git/trees/current-tree') return response(200,{truncated:false,tree:[...files.keys()].map(path=>({type:'blob',path}))});
    if (endpoint==='git/blobs') {const buffer=Buffer.from(body.content,'base64'); const id=sha(buffer); blobs.set(id,buffer); return response(201,{sha:id});}
    if (endpoint==='git/trees') {const id=sha(JSON.stringify(body)); trees.set(id,body.tree); return response(201,{sha:id});}
    if (endpoint==='git/commits') {const id=sha(JSON.stringify(body)); commits.set(id,body); return response(201,{sha:id});}
    if (endpoint==='git/refs/heads/main') {
      const commit = commits.get(body.sha);
      if (commit.parents[0]!==head || body.force!==false) return response(422);
      for (const file of trees.get(commit.tree)) {
        const target=path.join(directory,file.path);
        await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,blobs.get(file.sha));
        files.set(file.path,true);
      }
      head=body.sha; return response(200,{object:{sha:head}});
    }
    throw new Error('Unexpected fixture endpoint: '+endpoint);
  }
  return {github:createGitHub(fetcher),calls,mediaDirectory:path.join(directory,'public')};
}
