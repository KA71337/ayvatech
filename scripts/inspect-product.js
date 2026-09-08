import { load } from 'cheerio';
import { writeFile } from 'node:fs/promises';
const url='https://tap.az/elanlar/elektronika/plansetler/48295401';
const html=await (await fetch(url)).text();
const $=load(html);
const data=JSON.parse($('#__NEXT_DATA__').text());
await writeFile('.cache/product-next.json',JSON.stringify(data,null,2));
console.log(JSON.stringify(data.props.pageProps,null,2).slice(0,27000));
