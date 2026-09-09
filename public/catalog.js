import { filterProducts } from '/modules/filter-products.js';
import { t } from '/modules/i18n.js';
const products = JSON.parse(document.querySelector('#catalog-data').textContent);
const lang = document.documentElement.lang;
const form = document.querySelector('.filters');
const grid = document.querySelector('.catalogue-products');
const cards = new Map([...document.querySelectorAll('template[data-card]')].map(el => [el.dataset.card, el]));
const pagination = document.createElement('nav');
pagination.className = 'pagination';
pagination.setAttribute('aria-label', t('pagination', lang));
document.querySelector('.pagination')?.remove();
grid.after(pagination);
const canonical = document.querySelector('link[rel=canonical]').href.split('?')[0];
function update() {
  const query = Object.fromEntries(new URLSearchParams(location.search));
  const result = filterProducts(products, query, lang);
  for (const input of form.elements) if (input.name) input.value = query[input.name] || (input.name === 'sort' ? 'newest' : '');
  grid.replaceChildren(...result.items.map(p => cards.get(p.id).content.cloneNode(true)));
  document.querySelector('.empty-state')?.remove();
  if (!result.total) grid.before(document.querySelector('#catalog-empty').content.cloneNode(true));
  document.querySelector('.results-bar strong').textContent = result.total;
  document.querySelector('.results-bar > span:last-child').textContent = `${result.page} / ${result.pages}`;
  pagination.replaceChildren();
  for (let n = 1; n <= result.pages && result.pages > 1; n++) {
    const link = document.createElement('a');
    const params = new URLSearchParams(location.search); params.set('page', n);
    link.href = location.pathname + '?' + params;
    link.textContent = n;
    if (n === result.page) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', event => { event.preventDefault(); history.pushState(null, '', link.href); update(); });
    pagination.append(link);
  }
  document.querySelector('link[rel=canonical]').href = canonical + (result.page > 1 ? `?page=${result.page}` : '');
  const filtered = Object.keys(query).some(key => key !== 'page');
  let robots = document.querySelector('meta[name=robots]');
  if (filtered && !robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots); }
  if (robots) robots.content = filtered ? 'noindex, follow' : 'index, follow';
}
form.addEventListener('submit', event => {
  event.preventDefault();
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) if (value) params.set(key, value);
  history.pushState(null, '', location.pathname + '?' + params);
  update();
});
window.addEventListener('popstate', update);
update();
