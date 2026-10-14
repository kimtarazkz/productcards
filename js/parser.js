// Разбор надиктованного текста в позиции накладной.
// Работает полностью офлайн: на вход текст и каталог, на выход список позиций.
(function (root) {
  'use strict';

  const UNITS = {
    ноль: 0, один: 1, одна: 1, одно: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4,
    пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
    двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
    шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  };
  const TENS = {
    двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
    семьдесят: 70, восемьдесят: 80, девяносто: 90,
  };
  const HUNDREDS = {
    сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
    шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
  };
  // Дюймовые размеры словами.
  const FRACTION_PHRASES = [
    [/пол ?метра/g, ' 0.5 м '],
    [/полтора дюйма|полтора|полторы/g, ' 1.5 '],
    [/три четверти|три четвертых/g, ' 0.75 '],
    [/пол дюйма|полдюйма|одна вторая|половина/g, ' 0.5 '],
    [/одна четвертая|четверть/g, ' 0.25 '],
  ];

  // Слова-единицы, после которых число — это количество: «2 штуки», «3 баллона», «1 комплект».
  const QTY_WORDS = /^(шт|штук|штуки|штука|штучки|штучек|штуку|шту|pcs|баллон[а-я]*|комплект[а-я]*|рулон[а-я]*|тюбик[а-я]*|упаковк[а-я]*|пачк[а-я]*|пар|пары|пару|бутыл[а-я]*)$/;
  const LENGTH_WORDS = /^(м|метр|метра|метров|метры|метрa)$/;
  // Слова, которые не являются частью названия товара.
  const STOP_WORDS = new Set([
    'диаметр', 'диаметром', 'диаметра', 'диам', 'ф', 'д', 'd', 'мм', 'миллиметров',
    'на', 'по', 'x', 'х', 'и', 'с', 'еще', 'ещё', 'также', 'размер', 'дюйм', 'дюйма',
    'дюймов', 'длина', 'длиной', 'нужно', 'надо', 'дай', 'давай', 'плюс', 'для',
    'градусов', 'градуса', 'градус', 'вот', 'так', 'тоже', 'а', 'еще', 'добавь', 'запиши',
  ]);

  function normalize(text) {
    let s = ' ' + String(text || '').toLowerCase().replace(/ё/g, 'е') + ' ';
    s = s.replace(/½/g, ' 1/2 ').replace(/¾/g, ' 3/4 ').replace(/¼/g, ' 1/4 ').replace(/[ø⌀∅]/g, ' ф ');
    for (const [re, rep] of FRACTION_PHRASES) s = s.replace(re, rep);
    s = s.replace(/(\d),(\d)/g, '$1.$2');
    // «50х32», «32x3/4», «50*32» → «50 / 32»
    s = s.replace(/(\d)\s*[xх×*]\s*(\d)/g, '$1 / $2');
    s = s.replace(/([a-zа-я])(\d)/g, '$1 $2').replace(/(\d)([a-zа-я])/g, '$1 $2');
    s = s.replace(/[,;.!?]+(?!\d)/g, ' , ');
    s = s.replace(/[«»"()\-–—:]+/g, ' ');
    // Латиницу пишем русскими буквами: «Wilo» = «вило», «ERA» = «эра» (э → е).
    s = s.replace(/[a-z]/g, (c) => LAT[c]).replace(/э/g, 'е');
    return s.replace(/\s+/g, ' ').trim();
  }

  const LAT = {
    a: 'а', b: 'б', c: 'к', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'й', k: 'к', l: 'л', m: 'м',
    n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'й', z: 'з',
  };

  // Токены: {t:'num', v, raw} | {t:'word', w} | {t:'sep'} | {t:'slash'}
  function tokenize(text) {
    const raw = normalize(text).split(' ').filter(Boolean);
    const out = [];
    for (const r of raw) {
      if (r === ',') { out.push({ t: 'sep' }); continue; }
      if (r === '/') { out.push({ t: 'slash' }); continue; }
      let m = r.match(/^(\d+)\/(\d+)$/);
      if (m) {
        const a = +m[1], b = +m[2];
        if (a < b && [2, 4, 8].includes(b)) {
          out.push({ t: 'num', v: a / b, raw: r, frac: true });
        } else {
          out.push({ t: 'num', v: a, raw: m[1] }, { t: 'slash' }, { t: 'num', v: b, raw: m[2] });
        }
        continue;
      }
      if (/^\d+(\.\d+)?$/.test(r)) { out.push({ t: 'num', v: parseFloat(r), raw: r }); continue; }
      if (/^[a-zа-я0-9]+$/.test(r)) out.push({ t: 'word', w: r });
    }
    return addImplicitOne(joinNumberWords(joinMixedFractions(out)));
  }

  // «труба 50 метр» → «труба 50 1 м»
  function addImplicitOne(tokens) {
    const out = [];
    for (const tk of tokens) {
      const prev = out[out.length - 1];
      // «50 метр» — тоже 1 метр: после 50 сказали бы «метров».
      const one = prev && prev.t === 'num' && tk.w === 'метр' && !(prev.v % 10 === 1 && prev.v % 100 !== 11);
      if (tk.t === 'word' && LENGTH_WORDS.test(tk.w) && (!(prev && prev.t === 'num') || one)) {
        out.push({ t: 'num', v: 1, raw: '1' });
      }
      out.push(tk);
    }
    return out;
  }

  // «1 1/2» → 1.5
  function joinMixedFractions(tokens) {
    const out = [];
    for (const tk of tokens) {
      const prev = out[out.length - 1];
      if (tk.t === 'num' && tk.frac && prev && prev.t === 'num' && !prev.frac && Number.isInteger(prev.v) && prev.v < 10) {
        prev.v += tk.v;
        prev.raw += ' ' + tk.raw;
        continue;
      }
      out.push(tk);
    }
    return out;
  }

  // «сто десять» → 110, «пятьдесят две» → 52
  function joinNumberWords(tokens) {
    const out = [];
    let acc = null;
    let stage = 0; // 3 = были сотни, 2 = десятки, 1 = единицы
    const flush = () => {
      if (acc) out.push(acc);
      acc = null;
      stage = 0;
    };
    for (const tk of tokens) {
      if (tk.t === 'word') {
        const w = tk.w;
        let val = null, st = 0;
        if (w in HUNDREDS) { val = HUNDREDS[w]; st = 3; }
        else if (w in TENS) { val = TENS[w]; st = 2; }
        else if (w in UNITS) { val = UNITS[w]; st = UNITS[w] >= 10 ? 1.5 : 1; }
        else if (w === 'тысяча' || w === 'тысячи' || w === 'тысяч') {
          if (acc) { acc.v *= 1000; acc.raw += ' ' + w; stage = 4; continue; }
          acc = { t: 'num', v: 1000, raw: w, words: true }; stage = 4; continue;
        }
        if (val !== null) {
          const canJoin = acc && stage > st && !(stage === 1.5 && st === 1) && !(stage === 2 && st === 1.5);
          if (canJoin) {
            acc.v += val;
            acc.raw += ' ' + w;
            stage = st;
          } else {
            flush();
            acc = { t: 'num', v: val, raw: w, words: true };
            stage = st;
          }
          continue;
        }
      }
      flush();
      out.push(tk);
    }
    flush();
    return out;
  }

  // ---------- сравнение слов ----------
  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // Похожесть двух слов 0..1 с учётом окончаний и ошибок распознавания.
  const simCache = new Map();
  function wordSim(a, b) {
    if (a === b) return 1;
    const key = a < b ? a + '|' + b : b + '|' + a;
    let v = simCache.get(key);
    if (v === undefined) {
      v = wordSimRaw(a, b);
      if (simCache.size > 50000) simCache.clear();
      simCache.set(key, v);
    }
    return v;
  }
  function wordSimRaw(a, b) {
    const minLen = Math.min(a.length, b.length);
    if (minLen < 3) return 0;
    let p = 0;
    while (p < minLen && a[p] === b[p]) p++;
    // общая основа: «отвода» ~ «отвод», «шаровый» ~ «шаровой»
    if (p >= Math.max(3, Math.min(a.length, b.length) - 2) && Math.abs(a.length - b.length) <= 3) return 0.9;
    if (minLen >= 5) {
      const d = levenshtein(a, b);
      if (d <= 1) return 0.85;
      if (d <= 2 && minLen >= 7) return 0.7;
    }
    return 0;
  }

  // ---------- каталог ----------
  function numbersOf(text) {
    return tokenize(text).filter((t) => t.t === 'num').map((t) => t.v);
  }
  function wordsOf(text) {
    return tokenize(text)
      .filter((t) => t.t === 'word' && !STOP_WORDS.has(t.w) && !LENGTH_WORDS.test(t.w))
      .map((t) => t.w);
  }

  // Подготовка каталога: для каждого товара слова и числа названия и синонимов.
  function prepareCatalog(items) {
    const vocab = new Set();
    const products = items.map((it, idx) => {
      const aliases = [it.name].concat(it.synonyms || []).filter(Boolean).map((a) => {
        const words = wordsOf(a);
        words.forEach((w) => vocab.add(w));
        return { text: a, words, nums: numbersOf(a) };
      });
      return { ...it, idx, aliases, nums: numbersOf(it.name) };
    });
    return { products, vocab };
  }

  // «пол отвод» → «полотвод» ~ «полуотвод»
  function mergeSplitWords(tokens, vocab) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const a = tokens[i], b = tokens[i + 1];
      if (a.t === 'word' && b && b.t === 'word') {
        const joined = a.w + b.w;
        const joined2 = a.w + 'у' + b.w;
        const hit = [...vocab].some((v) => wordSim(joined, v) >= 0.85 || wordSim(joined2, v) >= 0.85);
        if (hit && !vocab.has(a.w) && !vocab.has(b.w)) {
          out.push({ t: 'word', w: vocab.has(joined2) ? joined2 : joined });
          i++;
          continue;
        }
      }
      out.push(a);
    }
    return out;
  }

  // ---------- разбор одной позиции ----------
  // Числа сегмента: количество («2 штуки»), остальные — размеры и длина.
  function analyzeSegment(seg) {
    const words = [];
    const sizes = [];
    const lengths = []; // «3 метра»
    let qty = null;
    for (let i = 0; i < seg.length; i++) {
      const tk = seg[i];
      if (tk.t === 'word') {
        if (!STOP_WORDS.has(tk.w) && !QTY_WORDS.test(tk.w) && !LENGTH_WORDS.test(tk.w)) words.push(tk.w);
        continue;
      }
      if (tk.t !== 'num') continue;
      const next = seg[i + 1];
      if (next && next.t === 'word' && QTY_WORDS.test(next.w) && qty === null) {
        qty = tk.v;
        continue;
      }
      if (next && next.t === 'word' && LENGTH_WORDS.test(next.w)) {
        lengths.push(tk.v);
        continue;
      }
      sizes.push(tk.v);
    }
    return { words, sizes, lengths, qty };
  }

  function numEq(a, b) {
    return Math.abs(a - b) < 1e-6;
  }

  // Сколько чисел товара нашлось среди чисел сегмента.
  function matchNumbers(productNums, sizes) {
    const left = sizes.slice();
    let matched = 0;
    for (const p of productNums) {
      const k = left.findIndex((s) => numEq(s, p));
      if (k >= 0) {
        matched++;
        left.splice(k, 1);
      }
    }
    return { matched, missing: productNums.length - matched, extra: left };
  }

  // Похожесть слов фразы на слова названия: 0..1 и число слов фразы, которых в названии нет.
  function wordScore(segWords, alias) {
    if (!alias.words.length || !segWords.length) return null;
    // Главное слово (первое) обязано совпасть, иначе это другой товар.
    let head = 0;
    for (const sw of segWords) head = Math.max(head, wordSim(sw, alias.words[0]));
    if (head === 0) return null;
    let sum = 0;
    for (const aw of alias.words) {
      let best = 0;
      for (const sw of segWords) best = Math.max(best, wordSim(sw, aw));
      sum += best;
    }
    let unknown = 0;
    let segHit = 0;
    for (const sw of segWords) {
      let best = 0;
      for (const aw of alias.words) best = Math.max(best, wordSim(sw, aw));
      segHit += best;
      if (best === 0) unknown++;
    }
    return { ws: (sum / alias.words.length + segHit / segWords.length) / 2, unknown };
  }

  function scoreProduct(product, a) {
    let best = null;
    product.aliases.forEach((al, k) => {
      // Числа синонима («угол 45 на 20» = 45 градусов) должны прозвучать, иначе синоним не подходит.
      const own = al.nums.filter((n) => !product.nums.some((p) => numEq(p, n)));
      const m = matchNumbers(own, a.sizes);
      if (m.missing) return;
      const w = wordScore(a.words, al);
      if (!w) return;
      // Название товара чуть важнее синонима при равенстве.
      const s = w.ws + (k === 0 ? 0.02 : 0) + own.length * 0.05;
      if (!best || s > best.s) best = { s, ws: w.ws, unknown: w.unknown, sizes: m.extra };
    });
    if (!best) return null;
    const nm = matchNumbers(product.nums, best.sizes.concat(a.lengths));
    // Длина, которой нет в названии («труба 50, 3 метра» при штучной трубе), — просто пояснение.
    const extraSizes = nm.extra.slice();
    for (const l of a.lengths) {
      const k = extraSizes.findIndex((x) => numEq(x, l));
      if (k >= 0) extraSizes.splice(k, 1);
    }
    // Число без «штук», оставшееся после размеров, считаем количеством.
    let qty = a.qty;
    let extra = extraSizes;
    if (qty === null && extra.length) {
      qty = extra[extra.length - 1];
      extra = extra.slice(0, -1);
    }
    const score = best.s * 10 + nm.matched * 3 - nm.missing * 4 - extra.length * 3 - best.unknown * 6;
    return { product, score, ws: best.ws, missing: nm.missing, extra, qty, spokenSizes: a.sizes.length };
  }

  // Варианты прочтения: «52 штуки» могло быть «50, 2 штуки» (пятьдесят две).
  function variants(a) {
    const list = [{ a, note: null, penalty: 0 }];
    const all = a.sizes.map((v, i) => ({ v, i, isQty: false }));
    if (a.qty !== null) all.push({ v: a.qty, i: -1, isQty: true });
    for (const n of all) {
      const u = n.v % 10;
      if (!Number.isInteger(n.v) || n.v < 20 || u === 0) continue;
      if (!n.isQty && a.qty !== null) continue; // количество уже названо отдельно
      const size = n.v - u;
      const sizes = a.sizes.slice();
      if (n.isQty) sizes.push(size);
      else sizes.splice(n.i, 1, size);
      list.push({
        a: { ...a, sizes, qty: u },
        note: `«${n.v}» понято как размер ${size} и ${u} шт`,
        penalty: 1,
      });
    }
    return list;
  }

  const UNKNOWN_SCORE = 0;

  function segText(seg) {
    return seg.map((t) => (t.t === 'num' ? t.raw : t.t === 'slash' ? '/' : t.w)).join(' ').replace(/ \/ /g, '/');
  }

  // Лучший товар для сегмента. Возвращает {score, result}.
  function matchSegment(seg, prepared) {
    const base = analyzeSegment(seg);
    const text = segText(seg);
    let best = null;
    let second = null;
    for (const vr of variants(base)) {
      for (const p of prepared.products) {
        const r = scoreProduct(p, vr.a);
        if (!r) continue;
        r.score -= vr.penalty;
        r.note = vr.note;
        if (!best || r.score > best.score) {
          if (best && best.product !== r.product) second = best;
          best = r;
        } else if (r.product !== best.product && (!second || r.score > second.score)) second = r;
      }
    }
    if (!best) {
      return {
        score: UNKNOWN_SCORE - (base.words.length ? 0 : 6),
        result: { text, hasWords: base.words.length > 0, productIdx: null, qty: base.qty || 1, status: 'error', note: 'Товар не найден в каталоге' },
      };
    }
    const notes = [];
    if (best.note) notes.push(best.note);
    const close = second && second.score > best.score - 2;
    // Размер не назван, а товаров с таким названием несколько — надо проверить.
    if (best.missing && (best.spokenSizes > 0 || close)) notes.push('размер не совпал — проверьте');
    else if (close) notes.push('похожий товар: ' + second.product.name);
    if (best.extra.length) notes.push('лишние числа: ' + best.extra.join(', '));
    if (best.ws < 0.75) notes.push('название распознано неточно');
    let qty = best.qty === null ? 1 : best.qty;
    if (best.qty === null) notes.push('количество не названо, поставлено 1');
    if (!(qty > 0)) qty = 1;
    return {
      score: best.score,
      result: { text, productIdx: best.product.idx, qty, status: notes.length ? 'warn' : 'ok', note: notes.join('; ') },
    };
  }

  // ---------- разбиение фразы на позиции ----------
  // Перебираем все разбиения и берём то, где товары узнаются лучше всего.
  const SEG_COST = 8;
  const MAX_SEG = 14;

  function splitChunks(tokens) {
    const chunks = [];
    let cur = [];
    for (const tk of tokens) {
      if (tk.t === 'sep') {
        if (cur.length) chunks.push(cur);
        cur = [];
      } else cur.push(tk);
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function canStart(tk) {
    return tk.t === 'word' && !QTY_WORDS.test(tk.w) && !LENGTH_WORDS.test(tk.w) && !STOP_WORDS.has(tk.w);
  }

  function bestSplit(chunk, prepared) {
    const n = chunk.length;
    const best = new Array(n + 1).fill(-Infinity);
    const from = new Array(n + 1).fill(-1);
    const res = new Array(n + 1);
    best[0] = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = Math.max(0, i - MAX_SEG); j < i; j++) {
        if (best[j] === -Infinity) continue;
        // Позиция начинается с названия, а не с числа (кроме самого начала фразы).
        if (j > 0 && !canStart(chunk[j])) continue;
        const seg = chunk.slice(j, i);
        if (!seg.some((t) => t.t === 'word' || t.t === 'num')) continue;
        const m = matchSegment(seg, prepared);
        const total = best[j] + m.score - SEG_COST;
        if (total > best[i]) {
          best[i] = total;
          from[i] = j;
          res[i] = m.result;
        }
      }
    }
    const out = [];
    for (let i = n; i > 0 && from[i] >= 0; i = from[i]) out.unshift(res[i]);
    return out;
  }

  // Главная функция: текст → позиции.
  function parse(text, prepared) {
    let tokens = tokenize(text);
    tokens = mergeSplitWords(tokens, prepared.vocab);
    // служебные слова в начале и «и» между позициями не мешают разбору
    tokens = tokens.filter((t) => !(t.t === 'word' && t.w === 'и'));
    const out = [];
    for (const chunk of splitChunks(tokens)) out.push(...bestSplit(chunk, prepared));
    // Непонятные кусочки без слов («1 штука») или только из служебных слов не показываем.
    return out.filter((r) => r.productIdx !== null || r.hasWords);
  }

  const api = { normalize, tokenize, prepareCatalog, parse, wordSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof window !== 'undefined' ? window : globalThis);
