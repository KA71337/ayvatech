import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { productSchema } from './products.js';
const root = path.resolve(process.env.DATA_DIR || 'data');
let queue = Promise.resolve();
export const revision = products => createHash('sha256').update(JSON.stringify(products)).digest('hex');
export async function readProducts() { return JSON.parse(await readFile(path.join(root,'products.json'),'utf8')).map(p=>productSchema.parse(p)); }
export async function readShop() { return JSON.parse(await readFile(path.join(root,'shop.json'),'utf8')); }
export async function mutateProducts(expected, action) {
  const task = queue.then(async()=>{
    const products=await readProducts();
    if(expected!==revision(products))throw Object.assign(new Error('conflict'),{status:409});
    const next=action(products).map(p=>productSchema.parse(p));
    if(new Set(next.map(p=>p.slug)).size!==next.length || new Set(next.map(p=>p.id)).size!==next.length)throw Object.assign(new Error('Duplicate product slug/id'),{status:409});
    await mkdir(root,{recursive:true});
    const temp=path.join(root,`products.${randomUUID()}.tmp`);
    await writeFile(temp,JSON.stringify(next,null,2)+'\n'); await rename(temp,path.join(root,'products.json'));
    return next;
  });
  queue=task.catch(()=>{}); return task;
}
