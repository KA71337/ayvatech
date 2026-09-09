const form = document.querySelector('#product-editor');
if (form) {
  let product = JSON.parse(form.dataset.product) || { id: `manual-${crypto.randomUUID()}`, images: [], properties: [] };
  let images = [...product.images];
  const previews = new Map();
  let revision = form.dataset.revision;
  const token = document.querySelector('meta[name="csrf-token"]').content;
  const message = document.querySelector('#editor-message');
  const showMessage = text => { message.textContent = text; message.hidden = false; };
  async function request(url, method, body) {
    const multipart = body instanceof FormData;
    const response = await fetch(url, { method, headers: { 'x-csrf-token': token, ...(!multipart ? { 'content-type': 'application/json' } : {}) }, body: multipart ? body : JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || form.dataset.error);
    return data;
  }
  function button(label, action) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b;
  }
  function addSpec(spec = { name: '', value: '' }) {
    const row = document.createElement('div'); row.className = 'spec-row';
    for (const key of ['name', 'value']) {
      const input = document.createElement('input'); input.value = spec[key]; input.dataset.specField = key;
      input.maxLength = key === 'name' ? 160 : 1000; input.required = true;
      input.setAttribute('aria-label', form.dataset[key === 'name' ? 'field' : 'value']); row.append(input);
    }
    const remove = button('×', () => row.remove()); remove.setAttribute('aria-label', form.dataset.remove); row.append(remove);
    document.querySelector('#spec-editor').append(row);
  }
  product.properties.forEach(addSpec);
  document.querySelector('#add-spec').addEventListener('click', () => addSpec());
  function renderImages() {
    const container = document.querySelector('#editor-images'); container.replaceChildren();
    images.forEach((image, index) => {
      const item = document.createElement('div'); item.className = 'editor-image';
      const img = document.createElement('img'); img.src = previews.get(image.src) || image.src; img.alt = `${index + 1}`; item.append(img);
      const actions = document.createElement('div'); actions.className = 'image-actions';
      for (const [delta, label, symbol] of [[-1, form.dataset.left, '←'], [1, form.dataset.right, '→']]) {
        const move = button(symbol, () => { [images[index], images[index + delta]] = [images[index + delta], images[index]]; renderImages(); });
        move.setAttribute('aria-label', label); move.disabled = !images[index + delta]; actions.append(move);
      }
      const remove = button('×', () => { images.splice(index, 1); renderImages(); }); remove.setAttribute('aria-label', form.dataset.remove); actions.append(remove);
      item.append(actions); container.append(item);
    });
  }
  renderImages();
  let busy = false;
  function setBusy(value) { busy = value; form.querySelectorAll('button[type="submit"], #image-upload, #delete-product').forEach(el => { el.disabled = value; }); }
  document.querySelector('#image-upload').addEventListener('change', async event => {
    const files = [...event.target.files]; if (!files.length || busy) return;
    if (files.length > 10 || images.length + files.length > 30 || files.some(f => f.size > 2 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(f.type))) { showMessage(form.dataset.imageInvalid); event.target.value = ''; return; }
    setBusy(true);
    try {
      for (const file of files) {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file);
        });
        const data = await request('/api/admin/images', 'POST', {content});
        for (const image of data.images) previews.set(image.src, data.preview);
        images.push(...data.images); renderImages();
      }
      message.hidden = true;
    }
    catch (error) { showMessage(error.message); }
    finally { setBusy(false); event.target.value = ''; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const fields = new FormData(form);
      const next = { ...product, images, properties: [...document.querySelectorAll('.spec-row')].map(row => ({ name: row.querySelector('[data-spec-field="name"]').value, value: row.querySelector('[data-spec-field="value"]').value })) };
      for (const key of ['title','description','category']) next[key] = Object.fromEntries(['az','ru','en'].map(lang => [lang, fields.get(`${key}.${lang}`)]));
      for (const key of ['slug','categorySlug','currency','brand','model','condition','availability','status']) next[key] = fields.get(key);
      next.price = Number(fields.get('price'));
      const creating = location.pathname.endsWith('/new');
      const data = await request(creating ? '/api/admin/products' : `/api/admin/products/${product.id}`, creating ? 'POST' : 'PUT', { product: next, revision });
      revision = data.revision; product = next; showMessage(form.dataset.saved + ' ' + data.publication);
      if (location.pathname.endsWith('/new')) location.assign(`/admin/product/${product.id}`);
    } catch (error) { showMessage(error.message); }
    finally { setBusy(false); }
  });
  document.querySelector('#delete-product')?.addEventListener('click', async () => {
    if (busy || !confirm(form.dataset.deleteConfirm)) return; setBusy(true);
    try { await request(`/api/admin/products/${product.id}`, 'DELETE', { revision }); location.assign('/admin'); }
    catch (error) { showMessage(error.message); setBusy(false); }
  });
}
