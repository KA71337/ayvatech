import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createGitHub, HttpError } from '../lib/github.js';
import { productSchema } from '../lib/products.js';
import { filterProducts } from '../lib/products.js';
import { render } from '../lib/render.js';
import { authConfigured, issueSession, readSession, cookie, requireCSRF, checkPassword, limitLogin } from '../lib/admin-session.js';

const maxBody=3*1024*1024; // Below Vercel's 4.5 MB request/response limit.
async function readBody(req) {
  if (Number(req.headers['content-length'])>maxBody) throw new HttpError(413,'BODY_SIZE','Request is too large. Upload one image at a time (maximum 2 MB).');
  let raw;
  if (req.body!==undefined) raw=req.body;
  else {
    const chunks=[]; let size=0;
    for await (const chunk of req) {
      size+=chunk.length;
      if (size>maxBody) throw new HttpError(413,'BODY_SIZE','Request is too large.');
      chunks.push(chunk);
    }
    raw=Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw=raw.toString('utf8');
  if (typeof raw==='string') {
    if (Buffer.byteLength(raw)>maxBody) throw new HttpError(413,'BODY_SIZE','Request is too large.');
    try { raw=req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(raw)):JSON.parse(raw||'{}'); }
    catch { throw new HttpError(400,'INVALID_JSON','Invalid request body.'); }
  }
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new HttpError(400,'INVALID_INPUT','Expected an object.');
  // Vercel may parse JSON before invoking the handler; enforce the same bound there.
  if (Buffer.byteLength(JSON.stringify(raw))>maxBody) throw new HttpError(413,'BODY_SIZE','Request is too large.');
  return raw;
}
const json=(res,status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
const redirect=(res,url)=>{res.statusCode=303;res.setHeader('Location',url);res.end();};
const html=async(res,view,data)=>{const page=await render(view,{admin:true,noindex:true,...data});res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page);};
function method(req, allowed) { if (!allowed.includes(req.method)) throw new HttpError(405,'METHOD','Method not allowed.'); }
async function uploadImage(body, github) {
  if (typeof body.content!=='string' || body.content.length>2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.content)) throw new HttpError(400,'IMAGE_INVALID','Upload a JPEG, PNG or WebP image, maximum 2 MB.');
  const buffer=Buffer.from(body.content,'base64');
  if (buffer.length>2*1024*1024) throw new HttpError(413,'IMAGE_SIZE','Image exceeds 2 MB.');
  const source=sharp(buffer,{limitInputPixels:40000000,animated:false}).rotate();
  let files;
  const base='/media/admin-'+randomUUID();
  try {
    const metadata=await source.metadata();
    if (!['jpeg','png','webp'].includes(metadata.format) || metadata.pages>1) throw new Error();
    files=await Promise.all([320,640,1280].map(async width=>({width,src:`${base}-${width}.webp`,buffer:await source.clone().resize(width).webp({quality:84}).toBuffer()})));
  } catch { throw new HttpError(400,'IMAGE_INVALID','Invalid or unsupported image.'); }
  await github.upload(files);
  const full=files.at(-1), metadata=await sharp(full.buffer).metadata();
  return {images:[{src:full.src,original:full.src,width:metadata.width,height:metadata.height,variants:files.map(({width,src})=>({width,src}))}],preview:'data:image/webp;base64,'+files[0].buffer.toString('base64')};
}
export function createAdminHandler(github=createGitHub()) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);
    try {
      const url=new URL(req.url,'http://localhost');
      const route=String(req.query?.route??url.searchParams.get('route')??'').replace(/^\/+|\/+$/g,'');
      const query=Object.fromEntries([...url.searchParams].filter(([key])=>!['route','__proto__','constructor','prototype'].includes(key)));
      const lang=['ru','en'].includes(query.lang)?query.lang:'az';
      const session=readSession(req);
      if (route==='page/login') {
        method(req,['GET']);
        if (session?.admin) return redirect(res,'/admin');
        const issued=authConfigured()?issueSession():null;
        if (issued) res.setHeader('Set-Cookie',cookie(issued.value));
        return await html(res,'login',{route:'/admin/login',lang,configured:authConfigured(),csrf:issued?.session.csrf||'',error:query.error?'Incorrect password. Please try again.':null});
      }
      if (route==='login') {
        method(req,['POST']);
        if (!authConfigured()) throw new HttpError(503,'AUTH_CONFIG','Administration is not configured.');
        limitLogin(req);
        const body=await readBody(req);
        requireCSRF(req,session,body);
        if (!await checkPassword(body.password)) {
          if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return redirect(res,'/admin/login?error=1');
          throw new HttpError(401,'LOGIN_FAILED','Incorrect password.');
        }
        res.setHeader('Set-Cookie',cookie(issueSession(true).value));
        return redirect(res,'/admin');
      }
      if (!session?.admin) {
        if (route==='page' || route.startsWith('page/')) return redirect(res,'/admin/login');
        throw new HttpError(401,'UNAUTHORIZED','Sign in to administration.');
      }
      if (route==='logout') {
        method(req,['POST']);requireCSRF(req,session,await readBody(req));
        res.setHeader('Set-Cookie',cookie('',true));return redirect(res,'/admin/login');
      }
      if (route==='page' || route.startsWith('page/product/')) {
        method(req,['GET']);
        const {products,revision}=await github.read();
        const common={lang,query,csrf:session.csrf,revision,languageLinks:Object.fromEntries(['az','ru','en'].map(l=>[l,`/admin${route==='page'?'':'/product/'+route.slice(13)}?lang=${l}`]))};
        if (route==='page') return await html(res,'admin',{...common,route:'/admin',products,result:filterProducts(products,query,lang,20)});
        const id=route.slice('page/product/'.length);
        const product=id==='new'?null:products.find(p=>p.id===id);
        if (!product && id!=='new') throw new HttpError(404,'NOT_FOUND','Product not found.');
        return await html(res,'editor',{...common,route:'/admin/product/'+id,product});
      }
      if (route==='images') {
        method(req,['POST']);requireCSRF(req,session);
        return json(res,200,await uploadImage(await readBody(req),github));
      }
      if (route==='products' || /^products\/[a-z0-9-]{1,100}$/.test(route)) {
        const id=route.split('/')[1];
        method(req,id?['GET','PUT','DELETE']:['GET','POST']);
        if (req.method==='GET') {
          const result=await github.read();
          if (!id) return json(res,200,result);
          const product=result.products.find(p=>p.id===id);
          if (!product) throw new HttpError(404,'NOT_FOUND','Product not found.');
          return json(res,200,{product,revision:result.revision});
        }
        requireCSRF(req,session);
        const body=await readBody(req);
        const parsed=req.method==='DELETE'?null:productSchema.safeParse(body.product);
        if (parsed && (!parsed.success || (id && parsed.data.id!==id))) throw new HttpError(400,'INVALID_INPUT','Invalid product fields. Check price, required AZ text, slug and images.');
        const result=await github.mutate(body.revision,async products=>{
          const index=products.findIndex(p=>p.id===id);
          if (req.method!=='POST' && index<0) throw new HttpError(404,'NOT_FOUND','Product not found.');
          if (req.method==='DELETE') return products.filter(p=>p.id!==id);
          const p=parsed.data;
          await github.checkImages(p.images);
          if (req.method==='POST') {
            for (const field of ['sourceId','sourceUrl','sourceHash','sourceUpdatedAt']) delete p[field];
            p.importedAt=new Date().toISOString();products.push(p);
          } else {
            for (const field of ['sourceId','sourceUrl','sourceHash','sourceUpdatedAt','importedAt']) {
              if (products[index][field]!==undefined) p[field]=products[index][field]; else delete p[field];
            }
            products[index]=p;
          }
          return products;
        });
        return json(res,req.method==='POST'?201:200,{ok:true,revision:result.revision,publication:'Saved to GitHub. Public pages update after the Vercel deployment completes.'});
      }
      throw new HttpError(404,'NOT_FOUND','Route not found.');
    } catch (error) {
      const known=error instanceof HttpError;
      const status=known?error.status:error.name==='ZodError'?400:500;
      const code=known?error.code:error.name==='ZodError'?'INVALID_INPUT':'INTERNAL';
      // Never log request bodies, headers, upstream responses or error stacks.
      console.error(JSON.stringify({event:'admin_request_failed',requestId,status,code}));
      return json(res,status,{error:known?error.message:status===400?'Invalid product data.':'Unable to complete the request. Contact the administrator with the request ID.',code,requestId});
    }
  };
}
export default createAdminHandler();
