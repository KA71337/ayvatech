import { z } from 'zod';
import { localized } from './i18n.js';
const localizedText = max => z.object({ az: z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Required'), ru: z.string().max(max).default(''), en: z.string().max(max).default('') });
const mediaPath = z.string().regex(/^\/media\/[a-zA-Z0-9_-]+\.(webp|jpg|png)$/);
export const imageSchema = z.object({ src: mediaPath, original: mediaPath, sourceUrl: z.string().url().optional(), width: z.number().int().positive().max(30000), height: z.number().int().positive().max(30000), variants: z.array(z.object({width:z.number().int().positive(),src:mediaPath})).min(2).max(5) });
export const productSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(160),
  title: localizedText(300), description: localizedText(25000), price:z.number().finite().nonnegative().max(10000000), currency:z.enum(['AZN','USD','EUR']),
  category: localizedText(160), categorySlug:z.string().regex(/^[a-z0-9-]+$/).max(100),
  brand:z.string().max(160).default(''), model:z.string().max(160).default(''), condition:z.string().max(100).default(''),
  availability:z.enum(['','LimitedAvailability','InStock','OutOfStock','PreOrder']).default(''),
  properties:z.array(z.object({name:z.string().trim().min(1).max(160),value:z.string().trim().min(1).max(1000)})).max(60),
  images:z.array(imageSchema).max(30), status:z.enum(['published','draft','archived']),
  sourceId:z.string().regex(/^\d+$/).optional(), sourceUrl:z.string().regex(/^https:\/\/tap\.az\/elanlar\/[a-z0-9/-]+$/).optional(),
  sourceUpdatedAt:z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString()).optional(), importedAt:z.iso.datetime().optional(), sourceHash:z.string().optional()
}).superRefine((p,ctx)=>{if(p.status==='published'&&!p.images.length)ctx.addIssue({code:'custom',path:['images'],message:'photoRequired'});});
export function filterProducts(products, query={}, lang='az', pageSize=12) {
  const str = key => typeof query[key] === 'string' ? query[key].slice(0,300) : '';
  const q=str('q').trim().toLocaleLowerCase(lang);
  const number = key => str(key) !== '' && Number.isFinite(Number(str(key))) ? Number(str(key)) : null;
  const min=number('min'), max=number('max');
  let items=products.filter(p => (!q || [localized(p.title,lang),p.title.az,localized(p.description,lang),p.brand,p.model,...p.properties.flatMap(s=>[s.name,s.value])].join(' ').toLocaleLowerCase(lang).includes(q))
    && (!str('category') || p.categorySlug===str('category')) && (!str('brand') || p.brand===str('brand'))
    && (min===null || p.price>=min) && (max===null || p.price<=max)
    && (!str('availability') || p.availability===str('availability'))
    && (!str('status') || p.status===str('status'))
    && (!str('spec') || p.properties.some(s=>`${s.name}::${s.value}`===str('spec'))));
  const sort=str('sort');
  items.sort((a,b)=>sort==='price-asc'?a.price-b.price:sort==='price-desc'?b.price-a.price:sort==='name'?localized(a.title,lang).localeCompare(localized(b.title,lang),lang):(b.sourceUpdatedAt||b.importedAt||'').localeCompare(a.sourceUpdatedAt||a.importedAt||''));
  const total=items.length,pages=Math.max(1,Math.ceil(total/pageSize));
  const page=Math.max(1,Math.min(pages,Math.floor(number('page')||1)));
  return {items:items.slice((page-1)*pageSize,page*pageSize),total,pages,page};
}
