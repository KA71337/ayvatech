import { localized } from './i18n.js';
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
