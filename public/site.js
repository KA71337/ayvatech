// The URL is the source of truth for locale; storage only remembers explicit choices.
try {
  const routeLocale = location.pathname.match(/^\/(ru|en)(?:\/|$)/)?.[1] || 'az';
  localStorage.setItem('ayva.lang', routeLocale);
  document.querySelectorAll('a[lang][hreflang]').forEach(link => link.addEventListener('click', () => localStorage.setItem('ayva.lang', link.lang)));
} catch { /* Storage can be disabled; route-based locale still works. */ }
const menu = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');

function openMenu() {
  if (!menu || !mobileMenu) return;
  menu.setAttribute('aria-expanded', 'true');
  mobileMenu.hidden = false;
  requestAnimationFrame(() => {
    mobileMenu.classList.add('is-open');
  });
  document.body.classList.add('menu-open');
  document.documentElement.classList.add('menu-open');
}

function closeMenu() {
  if (!menu || !mobileMenu) return;
  menu.setAttribute('aria-expanded', 'false');
  mobileMenu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  document.documentElement.classList.remove('menu-open');
  setTimeout(() => {
    if (menu.getAttribute('aria-expanded') === 'false') {
      mobileMenu.hidden = true;
    }
  }, 240);
}

menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  if (open) openMenu(); else closeMenu();
});

mobileMenu?.addEventListener('click', event => {
  if (event.target.closest('a')) closeMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    closeMenu();
    menu.focus();
  }
});

document.addEventListener('click', event => {
  if (menu?.getAttribute('aria-expanded') === 'true') {
    if (!event.target.closest('#mobile-menu') && !event.target.closest('.menu-toggle')) {
      closeMenu();
    }
  }
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
