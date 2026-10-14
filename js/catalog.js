// Загрузка каталога из Excel / CSV и хранение на телефоне.
(function (root) {
  'use strict';

  const KEY = 'pc.catalog';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function save(cat) {
    localStorage.setItem(KEY, JSON.stringify(cat));
  }

  function parsePrice(v) {
    if (typeof v === 'number') return v;
    const s = String(v || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function splitSynonyms(v) {
    return String(v || '')
      .split(/[,;\n|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Определяем колонки по заголовкам; если заголовков нет — A: название, B: цена, C: синонимы.
  function rowsToItems(rows) {
    rows = rows.filter((r) => r && r.some((c) => String(c ?? '').trim() !== ''));
    if (!rows.length) throw new Error('Таблица пустая');
    const head = rows[0].map((c) => String(c ?? '').toLowerCase());
    const find = (re) => head.findIndex((h) => re.test(h));
    let iName = find(/наимен|назван|товар|атауы/);
    let iPrice = find(/цен|стоим|баға/);
    let iSyn = find(/синон|как называ|другие/);
    let iUnit = find(/ед\.?\s*изм|единиц|^ед/);
    let start = 1;
    if (iName < 0 || iPrice < 0) {
      // без заголовков
      iName = 0;
      iPrice = 1;
      iSyn = rows[0].length > 2 ? 2 : -1;
      iUnit = -1;
      start = parsePrice(rows[0][1]) === null ? 1 : 0;
    }
    const items = [];
    const skipped = [];
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      const name = String(row[iName] ?? '').trim();
      const price = parsePrice(row[iPrice]);
      if (!name) continue;
      if (price === null) {
        skipped.push(name);
        continue;
      }
      items.push({
        name,
        price,
        synonyms: iSyn >= 0 ? splitSynonyms(row[iSyn]) : [],
        unit: iUnit >= 0 ? String(row[iUnit] ?? '').trim() || 'шт' : 'шт',
      });
    }
    if (!items.length) throw new Error('Не нашла ни одного товара с ценой. Нужны колонки «Наименование» и «Цена».');
    return { items, skipped };
  }

  function parseCsv(text) {
    const delim = (text.split('\n')[0].match(/;/g) || []).length >= (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function fromFile(file) {
    const name = file.name.toLowerCase();
    let rows;
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      rows = parseCsv(await file.text());
    } else {
      if (!root.XLSX) throw new Error('Модуль Excel не загрузился');
      const wb = root.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    }
    const res = rowsToItems(rows);
    const cat = { items: res.items, source: file.name, loadedAt: new Date().toISOString() };
    save(cat);
    return { cat, skipped: res.skipped };
  }

  async function fromUrl(url, label) {
    const resp = await fetch(url);
    const rows = parseCsv(await resp.text());
    const res = rowsToItems(rows);
    const cat = { items: res.items, source: label, loadedAt: new Date().toISOString() };
    save(cat);
    return { cat, skipped: res.skipped };
  }

  root.Catalog = { load, save, fromFile, fromUrl, rowsToItems, parseCsv };
})(window);
