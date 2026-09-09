import { z } from 'zod';
export { filterProducts } from './filter-products.js';
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
