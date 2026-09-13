(() => {
  const roots = [...document.querySelectorAll('[data-custom-dropdown]')];
  let openRoot = null;
  const options = root => [...root.querySelectorAll('[data-dropdown-option]')];
  const close = (root, focus = false) => {
    if (!root) return;
    root.classList.remove('is-open', 'opens-up');
    root.querySelector('.custom-dropdown__trigger').setAttribute('aria-expanded', 'false');
    root.querySelector('.custom-dropdown__menu').hidden = true;
    if (openRoot === root) openRoot = null;
    if (focus) root.querySelector('.custom-dropdown__trigger').focus();
  };
  const position = root => {
    const trigger = root.querySelector('.custom-dropdown__trigger');
    const menu = root.querySelector('.custom-dropdown__menu');
    const rect = trigger.getBoundingClientRect();
    const below = innerHeight - rect.bottom;
    const above = rect.top;
    root.classList.toggle('opens-up', below < Math.min(menu.scrollHeight + 12, 340) && above > below);
  };
  const focusOption = (root, index) => {
    const items = options(root);
    if (!items.length) return;
    const item = items[(index + items.length) % items.length];
    item.focus({ preventScroll: true });
    item.scrollIntoView({ block: 'nearest' });
  };
  const open = (root, focusIndex) => {
    if (openRoot && openRoot !== root) close(openRoot);
    root.querySelector('.custom-dropdown__menu').hidden = false;
    position(root);
    root.classList.add('is-open');
    root.querySelector('.custom-dropdown__trigger').setAttribute('aria-expanded', 'true');
    openRoot = root;
    if (focusIndex != null) requestAnimationFrame(() => { if (openRoot === root) focusOption(root, focusIndex); });
  };
  const select = (root, option) => {
    const input = root.querySelector('[data-dropdown-input]');
    const value = option.dataset.value || '';
    root.dataset.value = value;
    root.querySelector('[data-dropdown-label]').textContent = option.querySelector('span').textContent;
    options(root).forEach(item => {
      const selected = item === option;
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    if (input && input.value !== value) {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(root, !option.matches('a[href]'));
  };
  roots.forEach(root => {
    const trigger = root.querySelector('.custom-dropdown__trigger');
    trigger.addEventListener('click', () => root.classList.contains('is-open') ? close(root) : open(root));
    trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        const selected = Math.max(0, options(root).findIndex(item => item.classList.contains('is-selected')));
        const index = event.key === 'End' ? options(root).length - 1 : event.key === 'ArrowUp' ? selected - 1 : event.key === 'ArrowDown' ? selected + 1 : selected;
        open(root, index);
      }
    });
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(root, true); return; }
      if (event.key === 'Tab') { close(root); return; }
      const items = options(root);
      const index = items.indexOf(document.activeElement);
      if (index < 0) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        focusOption(root, event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = document.activeElement;
        select(root, option);
        if (option.matches('a[href]')) location.assign(option.href);
      } else if (event.key === 'Tab') close(root);
      else if (event.key.length === 1 && /\S/.test(event.key)) {
        const term = event.key.toLocaleLowerCase();
        const match = items.find((item, itemIndex) => itemIndex > index && item.textContent.trim().toLocaleLowerCase().startsWith(term)) || items.find(item => item.textContent.trim().toLocaleLowerCase().startsWith(term));
        if (match) { event.preventDefault(); match.focus(); match.scrollIntoView({ block: 'nearest' }); }
      }
    });
    root.addEventListener('click', event => {
      const option = event.target.closest('[data-dropdown-option]');
      if (!option) return;
      select(root, option);
      if (option.lang) try { localStorage.setItem('ayva.lang', option.lang); } catch {}
    });
  });
  document.addEventListener('pointerdown', event => { if (openRoot && !openRoot.contains(event.target)) close(openRoot); });
  addEventListener('resize', () => { if (openRoot) position(openRoot); });
  addEventListener('scroll', () => { if (openRoot) position(openRoot); }, true);
  window.CustomDropdown = { close, open, select };
})();
