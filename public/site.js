// Public language preference needs no server or authentication cookie.
try {
  document.querySelectorAll('.languages a[lang]').forEach(link => link.addEventListener('click', () => localStorage.setItem('ayva.lang', link.lang)));
  const preferred = localStorage.getItem('ayva.lang');
  if (location.pathname === '/' && ['ru','en'].includes(preferred)) location.replace('/' + preferred + '/');
} catch { /* Storage can be disabled; AZ remains the default. */ }
const menu = document.querySelector('.menu-toggle');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  document.querySelector('#mobile-menu').hidden = !open;
});
document.querySelector('#mobile-menu')?.addEventListener('click', event => {
  if (event.target.closest('a')) { menu.setAttribute('aria-expanded', 'false'); document.querySelector('#mobile-menu').hidden = true; }
});
document.querySelector('.filter-toggle')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  document.querySelector('#filter-panel').classList.toggle('is-open', open);
});
function revealSearch() {
  if (location.hash !== '#search') return;
  const search = document.querySelector('#search');
  if (!search) return;
  document.querySelector('#filter-panel')?.classList.add('is-open');
  document.querySelector('.filter-toggle')?.setAttribute('aria-expanded', 'true');
  search.focus({preventScroll:true});
  search.scrollIntoView({block:'center'});
}
window.addEventListener('hashchange', revealSearch);
revealSearch();
const thumbs = [...document.querySelectorAll('[data-image]')];
const mainImage = document.querySelector('#main-product-image');
const dialog = document.querySelector('.lightbox');
let index = 0;
function selectImage(next) {
  index = (next + thumbs.length) % thumbs.length;
  const selected = thumbs[index];
  mainImage.src = selected.dataset.image;
  mainImage.srcset = selected.dataset.srcset;
  thumbs.forEach((thumb, i) => thumb.setAttribute('aria-pressed', String(i === index)));
  dialog.querySelector('img').src = selected.dataset.original;
  dialog.querySelector('.lightbox-counter').textContent = `${index + 1} / ${thumbs.length}`;
}
thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => selectImage(i)));
document.querySelector('[data-open-gallery]')?.addEventListener('click', () => { selectImage(index); dialog.showModal(); });
document.querySelector('.lightbox-close')?.addEventListener('click', () => dialog.close());
document.querySelector('.lightbox-prev')?.addEventListener('click', () => selectImage(index - 1));
document.querySelector('.lightbox-next')?.addEventListener('click', () => selectImage(index + 1));
dialog?.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectImage(index + (event.key === 'ArrowLeft' ? -1 : 1)); }
});
dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

// Reusable, progressively enhanced select: the native control keeps form semantics,
// while the visible control provides consistent styling and keyboard behaviour.
const customSelects = [];
function enhanceSelect(select) {
  if (select.dataset.enhanced === 'true') return;
  select.dataset.enhanced = 'true';
  select.classList.add('native-select');
  const root = document.createElement('div');
  root.className = 'custom-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-labelledby', [select.id, select.id + '-value'].filter(Boolean).join(' '));
  const value = document.createElement('span');
  value.id = select.id ? select.id + '-value' : '';
  const arrow = document.createElement('span');
  arrow.className = 'custom-select-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '⌄';
  trigger.append(value, arrow);
  const list = document.createElement('div');
  list.className = 'custom-select-options';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  root.append(trigger, list);
  select.after(root);

  let active = select.selectedIndex;
  const options = [...select.options].map((option, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'custom-select-option';
    item.setAttribute('role', 'option');
    item.dataset.index = index;
    item.textContent = option.textContent;
    item.disabled = option.disabled;
    item.addEventListener('click', () => choose(index));
    list.append(item);
    return item;
  });
  function sync() {
    active = Math.max(0, select.selectedIndex);
    value.textContent = select.options[active]?.textContent || '';
    options.forEach((item, index) => item.setAttribute('aria-selected', String(index === active)));
    trigger.disabled = select.disabled;
  }
  function close(focus = false) {
    root.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    if (focus) trigger.focus();
  }
  function open() {
    customSelects.forEach(control => control.close());
    root.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    list.hidden = false;
    options[active]?.focus({preventScroll: true});
    options[active]?.scrollIntoView({block: 'nearest'});
  }
  function choose(index) {
    if (options[index]?.disabled) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change', {bubbles: true}));
    sync();
    close(true);
  }
  function move(step) {
    let next = active;
    do next = (next + step + options.length) % options.length;
    while (options[next]?.disabled && next !== active);
    active = next;
    options[active]?.focus();
  }
  trigger.addEventListener('click', () => root.classList.contains('is-open') ? close() : open());
  trigger.addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      open();
      active = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[active]?.focus();
    }
  });
  list.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') { close(event.key === 'Escape'); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); active = event.key === 'Home' ? 0 : options.length - 1; options[active]?.focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(Number(document.activeElement.dataset.index)); }
  });
  select.addEventListener('change', sync);
  customSelects.push({root, close, sync});
  sync();
}
document.querySelectorAll('select').forEach(enhanceSelect);
document.addEventListener('click', event => customSelects.forEach(control => { if (!control.root.contains(event.target)) control.close(); }));
window.syncCustomSelects = () => customSelects.forEach(control => control.sync());
