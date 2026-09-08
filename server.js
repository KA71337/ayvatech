import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProducts, readShop, revision, mutateProducts } from './lib/storage.js';
import { productSchema, filterProducts } from './lib/products.js';
import { languages, t, localized, categoryName, propertyText, money } from './lib/i18n.js';
import { authConfigured, createSessionStore, equal, csrfToken, requireAdmin, requireCSRF } from './lib/security.js';
export const app=express();
const production=process.env.NODE_ENV==='production';
if(production&&(!process.env.SITE_URL||!process.env.SITE_URL.startsWith('https://')))throw new Error('Production requires HTTPS SITE_URL');
if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
app.disable('x-powered-by');app.set('view engine','ejs');app.set('views',path.resolve('views'));
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],fontSrc:["'self'"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:production?[]:null}},strictTransportSecurity:production?undefined:false}));
app.use(express.static('public',{maxAge:production?'1d':0,index:false}));
app.use(express.urlencoded({extended:false,limit:'200kb'}));app.use(express.json({limit:'250kb'}));
const sessionMiddleware=session({name:'ayva.sid',secret:process.env.SESSION_SECRET||randomBytes(48).toString('hex'),resave:false,saveUninitialized:false,store:createSessionStore(),cookie:{httpOnly:true,secure:production,sameSite:'strict',maxAge:8*60*60*1000}});
app.use((req,res,next)=>/^\/(admin|api\/admin)(\/|$)/.test(req.path)?sessionMiddleware(req,res,next):next());
const baseURL=()=>process.env.SITE_URL||`http://localhost:${process.env.PORT||3000}`;
const escapeXML=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const jsonSafe=obj=>JSON.stringify(obj).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
const prefix=lang=>lang==='az'?'':`/${lang}`;
app.use(async(req,res,next)=>{
  const match=req.path.match(/^\/(ru|en)(?=\/|$)/);
  const cookie=req.headers.cookie?.match(/(?:^|;\s*)ayva.lang=(az|ru|en)(?:;|$)/)?.[1];
  req.lang=match?.[1]||(/^\/(admin|api)(\/|$)/.test(req.path)?cookie||'az':'az');
  req.publicPath=match?req.path.slice(match[0].length)||'/':req.path;
  res.locals={lang:req.lang,t:key=>t(key,req.lang),loc:v=>localized(v,req.lang),cat:c=>categoryName(c,req.lang),prop:v=>propertyText(v,req.lang),money:p=>money(p,req.lang),url:p=>`${prefix(req.lang)}${p}`,jsonSafe,query:req.query,
    routePath:req.publicPath,languageLinks:Object.fromEntries(languages.map(l=>[l,`/language/${l}?next=${encodeURIComponent(req.publicPath+(req.url.includes('?')?'?'+req.url.split('?')[1]:''))}`])),admin:false};
  next();
});
app.get('/language/:lang',(req,res)=>{
  if(!languages.includes(req.params.lang))return res.sendStatus(400);
  let next=typeof req.query.next==='string'?req.query.next:'/';
  if(!/^\/(?!\/)/.test(next)||/[\\\r\n]/.test(next))next='/';
  next=next.replace(/^\/(az|ru|en)(?=\/|\?|$)/,'')||'/';
  res.cookie('ayva.lang',req.params.lang,{maxAge:365*86400000,sameSite:'lax',secure:production,httpOnly:true});
  res.redirect(/^\/(admin|api)(\/|$)/.test(next)?next:prefix(req.params.lang)+next);
});
async function render(req,res,view,data={}){
  const shop=await readShop();
  const lang=req.lang, route=req.publicPath;
  const canonical=baseURL()+prefix(lang)+route;
  const title=data.title||`${t('catalog',lang)} | AyvaTech`;
  const description=data.metaDescription||`${localized(shop.promo,lang)} ${t('heroText',lang)}`;
  const image=data.product?.images[0]?.src||shop.logo.src;
  const organization={'@context':'https://schema.org','@type':'Store','@id':baseURL()+'/#organization',name:shop.name,url:baseURL(),logo:baseURL()+shop.logo.src,image:baseURL()+shop.cover.src,telephone:shop.phones[0],address:{'@type':'PostalAddress',streetAddress:shop.address,addressLocality:'Bakı',addressCountry:'AZ'},geo:{'@type':'GeoCoordinates',latitude:shop.latitude,longitude:shop.longitude},sameAs:[shop.sourceUrl]};
  const structured=[organization];
  if(route!=='/')structured.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:t('home',lang),item:baseURL()+prefix(lang)+'/'},{'@type':'ListItem',position:2,name:t('catalog',lang),item:baseURL()+prefix(lang)+'/catalog'},...(data.product?[{'@type':'ListItem',position:3,name:localized(data.product.title,lang),item:canonical}]:[])]});
  if(data.product){const p=data.product;structured.push({'@context':'https://schema.org','@type':'Product',name:localized(p.title,lang),description:localized(p.description,lang),image:p.images.map(i=>baseURL()+i.src),sku:p.id,...(p.brand?{brand:{'@type':'Brand',name:p.brand}}:{}),offers:{'@type':'Offer',price:p.price,priceCurrency:p.currency,url:canonical,...(p.availability?{availability:`https://schema.org/${p.availability}`}:{})}});}
  res.render(view,{shop,title,metaDescription:description.slice(0,180),canonical,ogImage:baseURL()+image,alternates:languages.map(l=>({lang:l,url:baseURL()+prefix(l)+route})),structured,baseURL:baseURL(),noindex:false,product:null,error:null,csrf:req.session?csrfToken(req):'',...data});
}
app.get('/robots.txt',(req,res)=>res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /language/\nSitemap: ${baseURL()}/sitemap.xml\n`));
app.get('/sitemap.xml',async(req,res)=>{
  const products=(await readProducts()).filter(p=>p.status==='published');
  const paths=['/','/catalog','/about','/contact',...products.map(p=>'/product/'+p.slug)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.flatMap(p=>languages.map(l=>`<url><loc>${escapeXML(baseURL()+prefix(l)+p)}</loc>${languages.map(a=>`<xhtml:link rel="alternate" hreflang="${a}" href="${escapeXML(baseURL()+prefix(a)+p)}"/>`).join('')}</url>`)).join('')}</urlset>`);
});
const loginLimit=rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
app.get('/admin/login',async(req,res)=>{res.set('Cache-Control','no-store');if(req.session.admin&&authConfigured())return res.redirect('/admin');await render(req,res,'login',{admin:true,noindex:true,title:`${t('login',req.lang)} | AyvaTech`,configured:authConfigured()});});
app.post('/admin/login',loginLimit,requireCSRF,async(req,res,next)=>{
  if(!authConfigured()||typeof req.body.password!=='string'||!equal(req.body.password,process.env.ADMIN_PASSWORD))return render(req,res.status(401),'login',{admin:true,noindex:true,configured:authConfigured(),error:t('invalidLogin',req.lang)});
  req.session.regenerate(error=>{if(error)return next(error);req.session.admin=true;csrfToken(req);req.session.save(error=>error?next(error):res.redirect('/admin'));});
});
app.use(['/admin','/api/admin'],(req,res,next)=>{res.set('Cache-Control','no-store');next();},requireAdmin);
app.post('/admin/logout',requireCSRF,(req,res,next)=>req.session.destroy(error=>{if(error)return next(error);res.clearCookie('ayva.sid',{httpOnly:true,secure:production,sameSite:'strict'});res.redirect('/admin/login');}));
app.get('/admin',async(req,res)=>{const products=await readProducts();await render(req,res,'admin',{admin:true,noindex:true,title:`${t('admin',req.lang)} | AyvaTech`,products,result:filterProducts(products,req.query,req.lang,20),revision:revision(products)});});
app.get('/admin/product/:id',async(req,res)=>{const products=await readProducts();const product=req.params.id==='new'?null:products.find(p=>p.id===req.params.id);if(!product&&req.params.id!=='new')return res.sendStatus(404);await render(req,res,'editor',{admin:true,noindex:true,title:`${t('edit',req.lang)} | AyvaTech`,product,revision:revision(products)});});
app.get('/api/admin/products',async(req,res)=>{const products=await readProducts();res.json({products,revision:revision(products)});});
app.put('/api/admin/products/:id',requireCSRF,async(req,res)=>{
  const parsed=productSchema.safeParse(req.body.product);
  if(!parsed.success)return res.status(400).json({error:parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
  const p=parsed.data;if(p.id!==req.params.id)return res.sendStatus(400);
  for(const image of p.images)for(const file of [image.src,image.original,...image.variants.map(v=>v.src)])await access(path.join('public',file));
  const products=await mutateProducts(req.body.revision,products=>{
    const index=products.findIndex(x=>x.id===p.id);
    if(index<0){delete p.sourceId;delete p.sourceUrl;delete p.sourceHash;p.importedAt=new Date().toISOString();products.push(p);}
    else{const old=products[index];for(const field of ['sourceId','sourceUrl','sourceHash','sourceUpdatedAt','importedAt']){if(old[field]!==undefined)p[field]=old[field];else delete p[field];}products[index]=p;}
    return products;
  });res.json({ok:true,revision:revision(products)});
});
app.delete('/api/admin/products/:id',requireCSRF,async(req,res)=>{const products=await mutateProducts(req.body.revision,products=>products.filter(p=>p.id!==req.params.id));res.json({ok:true,revision:revision(products)});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:10},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
app.post('/api/admin/images',requireCSRF,upload.array('images',10),async(req,res)=>{
  if(!req.files?.length)return res.status(400).json({error:'JPEG, PNG or WebP required'});
  const images=[];
  for(const file of req.files){
    const processor=sharp(file.buffer,{limitInputPixels:40000000,animated:false}).rotate();const metadata=await processor.metadata();
    if(!['jpeg','png','webp'].includes(metadata.format)||metadata.pages>1)return res.status(400).json({error:'Unsupported image format'});
    const base='/media/admin-'+randomUUID();await mkdir('public/media',{recursive:true});
    const original=base+'-original.jpg';await processor.clone().jpeg({quality:92}).toFile('public'+original);
    const variants=[];for(const width of [320,640,1280]){const src=`${base}-${width}.webp`;await processor.clone().resize(width).webp({quality:84}).toFile('public'+src);variants.push({width,src});}
    const meta=await sharp('public'+variants[2].src).metadata();images.push({src:variants[2].src,original,width:meta.width,height:meta.height,variants});
  }
  res.json({images});
});
app.get(['/', '/ru', '/ru/', '/en','/en/','/catalog','/ru/catalog','/en/catalog','/about','/ru/about','/en/about','/contact','/ru/contact','/en/contact','/privacy','/ru/privacy','/en/privacy','/product/:slug','/ru/product/:slug','/en/product/:slug'],async(req,res)=>{
  if(req.path==='/'){
    const selected=req.headers.cookie?.match(/(?:^|;\s*)ayva.lang=(ru|en)(?:;|$)/)?.[1];
    if(selected){res.set('Cache-Control','private, no-store');return res.redirect(`/${selected}/`);}
  }
  const products=(await readProducts()).filter(p=>p.status==='published');
  const route=req.publicPath;
  if(route==='/')return render(req,res,'home',{products,title:`AyvaTech — ${t('heroTitle',req.lang).replace('\n',' ')}`});
  if(route==='/catalog')return render(req,res,'catalog',{products,result:filterProducts(products,req.query,req.lang),noindex:Object.keys(req.query).some(k=>k!=='page')});
  if(route.startsWith('/product/')){const product=products.find(p=>p.slug===req.params.slug);if(!product)return render(req,res.status(404),'info',{kind:'notFound',noindex:true,title:t('notFound',req.lang)});return render(req,res,'product',{product,related:products.filter(p=>p.categorySlug===product.categorySlug&&p.id!==product.id).slice(0,4),title:`${localized(product.title,req.lang)} | AyvaTech`,metaDescription:localized(product.description,req.lang)});}
  const kind=route.slice(1);return render(req,res,'info',{kind,title:`${t(kind,req.lang)} | AyvaTech`});
});
app.use(async(req,res)=>render(req,res.status(404),'info',{kind:'notFound',noindex:true,title:t('notFound',req.lang)}));
app.use((error,req,res,next)=>{console.error(error.name,error.message);if(res.headersSent)return next(error);const status=error.status||((error instanceof multer.MulterError||error.name==='ZodError')?400:500);if(req.originalUrl.startsWith('/api/'))return res.status(status).json({error:status===409?t('conflict',req.lang):t('error',req.lang)});res.status(status).type('text').send(t('error',req.lang));});
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))app.listen(Number(process.env.PORT)||3000,()=>console.log(`AyvaTech running at ${baseURL()}. Admin ${authConfigured()?'enabled':'disabled: configure environment'}.`));
