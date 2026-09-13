import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import * as cheerio from 'cheerio';

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory)) {
    const file = path.join(directory, entry);
    (await stat(file)).isDirectory() ? result.push(...await files(file)) : result.push(file);
  }
  return result;
}

test('source templates contain no user-facing native selects', async () => {
  for (const file of (await files('views')).filter(file => file.endsWith('.ejs'))) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /<select\b/i, file);
  }
});

test('CustomDropdown renders hidden form semantics and accessible listbox state', async () => {
  const html = await ejs.renderFile('views/partials/custom-dropdown.ejs', {
    id: 'status', name: 'status', value: 'published', variant: '',
    options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }]
  });
  const $ = cheerio.load(html);
  assert.equal($('select').length, 0);
  assert.equal($('input[type="hidden"][name="status"]').val(), 'published');
  assert.equal($('[role="listbox"]').length, 1);
  assert.equal($('[role="option"][aria-selected="true"]').attr('data-value'), 'published');
  assert.equal($('.custom-dropdown__trigger').attr('aria-expanded'), 'false');
});

test('all nine migrated fields preserve names and hidden-input submission', async () => {
  const filters = await readFile('views/partials/filters.ejs', 'utf8');
  const editor = await readFile('views/editor.ejs', 'utf8');
  for (const name of ['category','brand','spec','availability','status','sort']) assert.match(filters, new RegExp(`name: '${name}'`));
  for (const name of ['currency','availability','status']) assert.match(editor, new RegExp(`name: '${name}'`));
  assert.doesNotMatch(filters + editor, /<select\b/i);
});

test('shared interaction primitive includes complete keyboard, dismissal, positioning, and change support', async () => {
  const script = await readFile('public/dropdown.js', 'utf8');
  for (const behavior of ['ArrowDown','ArrowUp','Home','End','Escape','pointerdown','scrollIntoView','opens-up','change']) assert.match(script, new RegExp(behavior));
  assert.doesNotMatch(await readFile('public/site.js', 'utf8'), /enhanceSelect|customSelects|languageDropdown/);
});
