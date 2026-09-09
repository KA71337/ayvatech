import ejs from 'ejs';
import path from 'node:path';
import { languages, t, localized, categoryName, propertyText, money } from './i18n.js';
import { readFile } from 'node:fs/promises';
const readShop = async () => JSON.parse(await readFile(path.resolve('data/shop.json'), 'utf8'));
export const prefix = lang => lang === 'az' ? '' : `/${lang}`;
export const siteURL = () => (process.env.SITE_URL || 'https://ayvatech.vercel.app').replace(/\/$/, '');
export const escapeXML = s => String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export const jsonSafe = obj => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
export async function render(view, {lang='az', route='/', query={}, ...data}={}) {
  const shop = await readShop();
  const base = siteURL();
  const page = route === '/catalog' && Number(query.page) > 1 ? `?page=${Math.floor(Number(query.page))}` : '';
  const canonical = base + prefix(lang) + route + page;
  const title = data.title || `${t(route === '/contacts' ? 'contact' : route.slice(1), lang)} | AyvaTech`;
  const description = data.metaDescription || `${localized(shop.promo, lang)} ${t('heroText', lang)}`;
  const image = data.product?.images[0]?.src || shop.logo.src;
  const organization = {'@context':'https://schema.org','@type':'Store','@id':base+'/#organization',name:shop.name,url:base,logo:base+shop.logo.src,image:base+shop.cover.src,telephone:shop.phones[0],address:{'@type':'PostalAddress',streetAddress:shop.address,addressLocality:'Bakı',addressCountry:'AZ'},geo:{'@type':'GeoCoordinates',latitude:shop.latitude,longitude:shop.longitude},sameAs:[shop.sourceUrl]};
  const structured = [organization];
  if (route !== '/') structured.push({'@context':'https://schema.org','@type':'BreadcrumbList',itemListElement:[{'@type':'ListItem',position:1,name:t('home',lang),item:base+prefix(lang)+'/'},{'@type':'ListItem',position:2,name:t(data.product?'catalog':route==='/contacts'?'contact':route.slice(1),lang),item:data.product?base+prefix(lang)+'/catalog':canonical},...(data.product?[{'@type':'ListItem',position:3,name:localized(data.product.title,lang),item:canonical}]:[])]});
  if (data.product) {
    const p = data.product;
    structured.push({'@context':'https://schema.org','@type':'Product',name:localized(p.title,lang),description:localized(p.description,lang),image:p.images.map(i=>base+i.src),sku:p.id,...(p.brand?{brand:{'@type':'Brand',name:p.brand}}:{}),offers:{'@type':'Offer',price:p.price,priceCurrency:p.currency,url:canonical,...(p.availability?{availability:`https://schema.org/${p.availability}`}:{})}});
  }
  return ejs.renderFile(path.resolve('views', `${view}.ejs`), {
    shop, lang, t:key=>t(key,lang), loc:v=>localized(v,lang), cat:c=>categoryName(c,lang), prop:v=>propertyText(v,lang), money:p=>money(p,lang), url:p=>prefix(lang)+(p==='/contact'?'/contacts':p), jsonSafe, query,
    routePath:route, languageLinks:Object.fromEntries(languages.map(l=>[l,prefix(l)+route+page])),
    title, metaDescription:description.slice(0,180), canonical, ogImage:base+image, alternates:languages.map(l=>({lang:l,url:base+prefix(l)+route+page})), structured, baseURL:base,
    admin:false, noindex:false, product:null, error:null, csrf:'', ...data
  });
}
