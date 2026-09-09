import { productSchema } from './products.js';
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export function githubConfig() {
  const {GITHUB_TOKEN:token,GITHUB_OWNER:owner='KA71337',GITHUB_REPO:repo,GITHUB_BRANCH:branch='main',GITHUB_PRODUCTS_PATH:productsPath='data/products.json'}=process.env;
  if (!token || !owner || !repo) throw new HttpError(503,'GITHUB_CONFIG','GitHub storage is not configured.');
  if (!/^[\w-]+$/.test(owner) || !/^[\w.-]+$/.test(repo) || !branch || !/^[\w./-]+\.json$/.test(productsPath) || productsPath.split('/').some(p=>p==='..'||p==='.'||!p)) throw new HttpError(503,'GITHUB_CONFIG','Invalid GitHub storage configuration.');
  return {token,owner,repo,branch,productsPath};
}
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
export function createGitHub(fetcher=fetch) {
  async function request(endpoint, method='GET', body) {
    const config=githubConfig();
    let response;
    try {
      response=await fetcher(`https://api.github.com/repos/${config.owner}/${config.repo}/${endpoint}`, {
        method, redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${config.token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'AyvaTech-admin',...(body?{'Content-Type':'application/json'}:{})},
        ...(body?{body:JSON.stringify(body)}:{})
      });
    } catch { throw new HttpError(502,'GITHUB_UNAVAILABLE','GitHub is unavailable. Reload the catalogue before retrying a write.'); }
    if (!response.ok) {
      const status=response.status;
      if (status===404) throw new HttpError(404,'GITHUB_NOT_FOUND','GitHub repository, branch or file was not found. Check storage configuration and token permissions.');
      if (status===409 || status===422) throw new HttpError(409,'CONFLICT','Data changed. Reload and retry.');
      if (status===401 || status===403 || status===429) throw new HttpError(503,'GITHUB_ACCESS','GitHub access denied or rate limit reached. Check token permissions or retry later.');
      throw new HttpError(502,'GITHUB_UNAVAILABLE','GitHub could not complete the request. Reload before retrying.');
    }
    try { return await response.json(); } catch { throw new HttpError(502,'GITHUB_RESPONSE','Invalid response from GitHub.'); }
  }
  async function read() {
    const c=githubConfig();
    const file=await request(`contents/${encodePath(c.productsPath)}?ref=${encodeURIComponent(c.branch)}`);
    try {
      if (file.encoding!=='base64' || typeof file.sha!=='string') throw new Error();
      const products=validateCatalogue(JSON.parse(Buffer.from(file.content,'base64').toString('utf8')));
      return {products,revision:file.sha};
    } catch { throw new HttpError(502,'CATALOGUE_INVALID','GitHub catalogue is invalid; no data was changed.'); }
  }
  async function mutate(expected, action) {
    const current=await read();
    if (typeof expected!=='string' || expected!==current.revision) throw new HttpError(409,'CONFLICT','Data changed. Reload and retry.');
    const products=validateCatalogue(await action(current.products));
    const c=githubConfig();
    const result=await request(`contents/${encodePath(c.productsPath)}`,'PUT',{
      message:'Update AyvaTech catalogue from authenticated administration',branch:c.branch,sha:current.revision,
      content:Buffer.from(JSON.stringify(products,null,2)+'\n').toString('base64')
    });
    return {products,revision:result.content.sha};
  }
  async function tree() {
    const c=githubConfig();
    const ref=await request(`git/ref/heads/${encodePath(c.branch)}`);
    const commit=await request(`git/commits/${ref.object.sha}`);
    return {head:ref.object.sha,tree:commit.tree.sha};
  }
  async function checkImages(images) {
    const current=await tree();
    const listing=await request(`git/trees/${current.tree}?recursive=1`);
    if (listing.truncated) throw new HttpError(503,'GITHUB_TREE','Repository tree is too large to validate images safely.');
    const paths=new Set(listing.tree.filter(x=>x.type==='blob').map(x=>x.path));
    if (images.some(i=>[i.src,i.original,...i.variants.map(v=>v.src)].some(p=>!paths.has('public'+p)))) throw new HttpError(400,'IMAGE_MISSING','An image is missing from GitHub. Upload it before saving.');
  }
  async function upload(files) {
    const current=await tree();
    const entries=await Promise.all(files.map(async file=>{
      const blob=await request('git/blobs','POST',{encoding:'base64',content:file.buffer.toString('base64')});
      return {path:'public'+file.src,mode:'100644',type:'blob',sha:blob.sha};
    }));
    const nextTree=await request('git/trees','POST',{base_tree:current.tree,tree:entries});
    const commit=await request('git/commits','POST',{message:'Store validated AyvaTech product image',tree:nextTree.sha,parents:[current.head]});
    await request(`git/refs/heads/${encodePath(githubConfig().branch)}`,'PATCH',{sha:commit.sha,force:false});
  }
  return {read,mutate,checkImages,upload};
}
export function validateCatalogue(value) {
  if (!Array.isArray(value)) throw new HttpError(400,'INVALID_INPUT','Catalogue must be an array.');
  const products=value.map(p=>productSchema.parse(p));
  for (const field of ['id','slug','sourceId','sourceUrl']) {
    const values=products.map(p=>p[field]).filter(Boolean);
    if (new Set(values).size!==values.length) throw new HttpError(409,'DUPLICATE','Duplicate product identity or slug.');
  }
  return products;
}
