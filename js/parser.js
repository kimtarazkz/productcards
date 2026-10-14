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
    [/полтора дюйма|полтора|полторы/g, ' 1.5 '],
    [/три четверти|три четвертых/g, ' 0.75 '],
    [/пол дюйма|полдюйма|одна вторая|половина/g, ' 0.5 '],
    [/одна четвертая|четверть/g, ' 0.25 '],
  ];

  const QTY_WORDS = /^(шт|штук|штуки|штука|штучки|штучек|штуку|шту|pcs)$/;
  const LENGTH_WORDS = /^(м|метр|метра|метров|метры|метрa)$/;
  // Слова, которые не являются частью названия товара.
  const STOP_WORDS = new Set([
    'диаметр', 'диаметром', 'диаметра', 'диам', 'ф', 'д', 'd', 'мм', 'миллиметров',
    'на', 'по', 'x', 'х', 'и', 'с', 'еще', 'ещё', 'также', 'размер', 'дюйм', 'дюйма',
    'дюймов', 'длина', 'длиной', 'нужно', 'надо', 'дай', 'давай', 'плюс',
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
    return s.replace(/\s+/g, ' ').trim();
  }

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
    return joinNumberWords(joinMixedFractions(out));
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
  function wordSim(a, b) {
    if (a === b) return 1;
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

  function isVocabWord(w, vocab) {
    if (STOP_WORDS.has(w)) return false;
    if (vocab.has(w)) return true;
    for (const v of vocab) if (wordSim(w, v) >= 0.85) return true;
    return false;
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

  // ---------- разбиение на позиции ----------
  function segment(tokens, vocab) {
    const segs = [];
    let cur = [];
    const curHasNum = () => cur.some((t) => t.t === 'num');
    const curHasWord = () => cur.some((t) => t.t === 'word' && isVocabWord(t.w, vocab));
    const push = () => {
      if (cur.length) segs.push(cur);
      cur = [];
    };
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.t === 'sep') { push(); continue; }
      if (tk.t === 'word' && tk.w === 'и' && curHasNum()) { push(); continue; }
      if (tk.t === 'word' && isVocabWord(tk.w, vocab) && curHasNum() && curHasWord()) {
        const prev = cur[cur.length - 1];
        if (!(prev && prev.t === 'word' && isVocabWord(prev.w, vocab))) push();
      }
      cur.push(tk);
    }
    push();
    return segs;
  }

  // Разметка чисел сегмента: количество, длина, размер.
  function analyzeSegment(seg) {
    const words = [];
    const sizes = [];
    let qty = null;
    let qtyExplicit = false;
    for (let i = 0; i < seg.length; i++) {
      const tk = seg[i];
      if (tk.t === 'word') {
        if (!STOP_WORDS.has(tk.w) && !QTY_WORDS.test(tk.w) && !LENGTH_WORDS.test(tk.w)) words.push(tk.w);
        continue;
      }
      if (tk.t !== 'num') continue;
      const next = seg[i + 1];
      if (next && next.t === 'word' && QTY_WORDS.test(next.w) && !qtyExplicit) {
        qty = tk.v;
        qtyExplicit = true;
        continue;
      }
      sizes.push(tk.v);
    }
    // «штуки» без числа впереди, но с числом после: «штук 5»
    return { words, sizes, qty, qtyExplicit };
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

  function wordScore(segWords, alias) {
    if (!alias.words.length || !segWords.length) return 0;
    let sum = 0;
    for (const aw of alias.words) {
      let best = 0;
      for (const sw of segWords) best = Math.max(best, wordSim(sw, aw));
      sum += best;
    }
    // Главное слово (первое) обязано совпасть, иначе это другой товар.
    const head = Math.max(0, ...segWords.map((sw) => wordSim(sw, alias.words[0])));
    if (head === 0) return 0;
    // Слова фразы, которых нет в названии, тоже снижают оценку: «пол отвод» ближе к полуотводу, чем к отводу.
    let segHit = 0;
    for (const sw of segWords) segHit += Math.max(0, ...alias.words.map((aw) => wordSim(sw, aw)));
    return (sum / alias.words.length + segHit / segWords.length) / 2;
  }

  function scoreProduct(product, a) {
    let ws = 0;
    let sizes = a.sizes;
    product.aliases.forEach((al, k) => {
      // Числа синонима («отвод 45» = 45 градусов) должны прозвучать, иначе синоним не подходит.
      const own = al.nums.filter((n) => !product.nums.some((p) => numEq(p, n)));
      const m = matchNumbers(own, a.sizes);
      if (m.missing) return;
      // Название товара чуть важнее синонима при равенстве.
      let s = wordScore(a.words, al);
      if (s > 0 && k === 0) s += 0.05;
      if (s > ws) {
        ws = s;
        sizes = m.extra;
      }
    });
    if (ws === 0) return null;
    const nm = matchNumbers(product.nums, sizes);
    // Число без «штук», оставшееся после размеров, считаем количеством.
    let qty = a.qty;
    let extra = nm.extra;
    let qtyGuessed = false;
    if (qty === null && extra.length) {
      qty = extra[extra.length - 1];
      extra = extra.slice(0, -1);
      qtyGuessed = true;
    }
    const score = ws * 10 + nm.matched * 3 - nm.missing * 4 - extra.length * 2;
    return { product, score, ws, missing: nm.missing, extra, qty, qtyGuessed };
  }

  // Варианты прочтения: «52 штуки» могло быть «50, 2 штуки» (пятьдесят две).
  function variants(a) {
    const list = [{ a, note: null, penalty: 0 }];
    const all = a.sizes.map((v, i) => ({ v, i, isQty: false }));
    if (a.qty !== null) all.push({ v: a.qty, i: -1, isQty: true });
    for (const n of all) {
      const u = n.v % 10;
      if (!Number.isInteger(n.v) || n.v < 20 || u === 0) continue;
      const size = n.v - u;
      const sizes = a.sizes.slice();
      if (n.isQty) sizes.push(size);
      else sizes.splice(n.i, 1, size);
      if (!n.isQty && a.qty !== null) continue; // количество уже названо отдельно
      list.push({
        a: { ...a, sizes, qty: u, qtyExplicit: true },
        note: `«${n.v}» понято как размер ${size} и ${u} шт`,
        penalty: 1,
      });
    }
    return list;
  }

  function matchSegment(seg, prepared) {
    const base = analyzeSegment(seg);
    const text = seg.map((t) => (t.t === 'num' ? t.raw : t.t === 'slash' ? '/' : t.w)).join(' ').replace(/ \/ /g, '/');
    if (!base.words.length && !base.sizes.length) return null;
    let best = null;
    for (const vr of variants(base)) {
      for (const p of prepared.products) {
        const r = scoreProduct(p, vr.a);
        if (!r) continue;
        r.score -= vr.penalty;
        r.note = vr.note;
        if (!best || r.score > best.score) best = r;
      }
    }
    if (!best) {
      return { text, productIdx: null, qty: base.qty || 1, status: 'error', note: 'Товар не найден в каталоге' };
    }
    const notes = [];
    if (best.note) notes.push(best.note);
    if (best.missing) notes.push('размер не совпал полностью');
    if (best.extra.length) notes.push('лишние числа: ' + best.extra.join(', '));
    if (best.ws < 0.8) notes.push('название распознано неточно');
    let qty = best.qty === null ? 1 : best.qty;
    if (best.qty === null) notes.push('количество не названо, поставлено 1');
    if (!(qty > 0)) qty = 1;
    const status = notes.length ? 'warn' : 'ok';
    return { text, productIdx: best.product.idx, qty, status, note: notes.join('; ') };
  }

  // Главная функция: текст → позиции.
  function parse(text, prepared) {
    let tokens = tokenize(text);
    tokens = mergeSplitWords(tokens, prepared.vocab);
    return segment(tokens, prepared.vocab)
      .map((s) => matchSegment(s, prepared))
      .filter(Boolean);
  }

  const api = { normalize, tokenize, prepareCatalog, parse, wordSim };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parser = api;
})(typeof window !== 'undefined' ? window : globalThis);
