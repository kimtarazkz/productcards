// Интерфейс: диктовка, список позиций, накладная.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'pc.draft';
  const MANAGER_KEY = 'pc.manager';
  const HISTORY_KEY = 'pc.history';
  const DISCOUNT = 0; // скидки пока нет

  let catalog = Catalog.load();
  let prepared = catalog ? Parser.prepareCatalog(catalog.items) : null;
  let draft = loadDraft();
  let currentInvoice = null;

  // ---------- хранение ----------
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d && Array.isArray(d.items)) return d;
    } catch (e) { /* пусто */ }
    return { items: [], number: null, date: null };
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* пусто */ }
  }
  function manager() {
    return localStorage.getItem(MANAGER_KEY) || '1';
  }

  let nextId = Date.now();
  function makeItem(r) {
    const p = r.productIdx !== null ? catalog.items[r.productIdx] : null;
    return {
      id: nextId++,
      text: r.text,
      name: p ? p.name : null,
      price: p ? p.price : 0,
      unit: p ? p.unit || 'шт' : 'шт',
      qty: r.qty,
      status: r.status,
      note: r.note,
    };
  }

  // ---------- позиции ----------
  function addFromText(text, replaceId) {
    text = text.trim();
    if (!text) return;
    if (!prepared) {
      showMsg('Сначала загрузите каталог товаров (⚙ → Каталог).');
      return;
    }
    const items = Parser.parse(text, prepared).map(makeItem);
    if (!items.length) {
      showMsg('Не поняла: «' + text + '»');
      return;
    }
    if (replaceId) {
      const k = draft.items.findIndex((i) => i.id === replaceId);
      if (k >= 0) draft.items.splice(k, 1, ...items);
      else draft.items.push(...items);
    } else {
      draft.items.push(...items);
    }
    draft.number = null; // накладная изменилась — номер выдадим заново при формировании
    saveDraft();
    render();
    const last = $('items').lastElementChild;
    if (last && !replaceId) last.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  function total() {
    return draft.items.reduce((s, i) => s + (i.name ? i.qty * i.price : 0), 0);
  }

  function render() {
    const box = $('items');
    box.innerHTML = '';
    draft.items.forEach((it, n) => {
      const el = document.createElement('div');
      el.className = 'item ' + (it.name ? it.status : 'error');
      el.innerHTML = `
        <div class="item-top">
          <span class="num">${n + 1}</span>
          <button class="item-name" data-act="pick">${it.name ? esc(it.name) : 'Не найдено — выбрать товар'}</button>
          <button class="icon-btn small" data-act="redo" aria-label="Передиктовать">🎤</button>
          <button class="icon-btn small" data-act="del" aria-label="Удалить">✕</button>
        </div>
        <div class="heard">Услышано: «${esc(it.text)}»${it.note ? ' — <span class="note">' + esc(it.note) + '</span>' : ''}</div>
        <div class="item-calc">
          <button class="qbtn" data-act="minus">−</button>
          <input class="qty" type="number" inputmode="decimal" min="0" step="1" value="${it.qty}">
          <button class="qbtn" data-act="plus">+</button>
          <span class="unit">${esc(it.unit)} × ${Invoice.money(it.price)} =</span>
          <b class="sum">${Invoice.money(it.qty * it.price)}</b>
        </div>`;
      el.addEventListener('click', (e) => {
        const act = e.target.dataset.act;
        if (!act) return;
        if (act === 'del') {
          draft.items = draft.items.filter((x) => x.id !== it.id);
        } else if (act === 'redo') {
          Speech.start(it.id);
          return;
        } else if (act === 'pick') {
          openPicker(it);
          return;
        } else if (act === 'plus') {
          it.qty = +(it.qty + 1).toFixed(3);
          it.status = it.name ? 'ok' : it.status;
        } else if (act === 'minus') {
          it.qty = Math.max(1, +(it.qty - 1).toFixed(3));
          it.status = it.name ? 'ok' : it.status;
        }
        draft.number = null;
        saveDraft();
        render();
      });
      el.querySelector('.qty').addEventListener('change', (e) => {
        const v = parseFloat(String(e.target.value).replace(',', '.'));
        if (v > 0) {
          it.qty = v;
          if (it.name) it.status = 'ok';
        }
        draft.number = null;
        saveDraft();
        render();
      });
      box.appendChild(el);
    });
    $('empty').classList.toggle('hidden', draft.items.length > 0);
    $('total').textContent = Invoice.money(total());
    $('catalog-warning').classList.toggle('hidden', !!catalog);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  let msgTimer = null;
  function showMsg(text, sticky) {
    const m = $('speech-msg');
    m.textContent = text;
    m.classList.remove('hidden');
    clearTimeout(msgTimer);
    if (!sticky) msgTimer = setTimeout(() => m.classList.add('hidden'), 6000);
  }

  // ---------- выбор товара вручную ----------
  let pickFor = null;
  function openPicker(item) {
    if (!catalog) return;
    pickFor = item;
    $('pick-title').textContent = item ? 'Выберите товар' : 'Каталог';
    $('pick-search').value = '';
    fillPicker('');
    $('dlg-pick').showModal();
  }
  function fillPicker(q) {
    q = q.toLowerCase().trim();
    const ul = $('pick-list');
    ul.innerHTML = '';
    catalog.items.forEach((p) => {
      const hay = (p.name + ' ' + (p.synonyms || []).join(' ')).toLowerCase();
      if (q && !q.split(/\s+/).every((w) => hay.includes(w))) return;
      const li = document.createElement('li');
      li.innerHTML = `<span>${esc(p.name)}${p.synonyms && p.synonyms.length ? '<small>' + esc(p.synonyms.join(', ')) + '</small>' : ''}</span><b>${Invoice.money(p.price)}</b>`;
      li.addEventListener('click', () => {
        if (!pickFor) return;
        Object.assign(pickFor, { name: p.name, price: p.price, unit: p.unit || 'шт', status: 'ok', note: '' });
        draft.number = null;
        saveDraft();
        render();
        $('dlg-pick').close();
      });
      ul.appendChild(li);
    });
  }
  $('pick-search').addEventListener('input', (e) => fillPicker(e.target.value));
  $('pick-cancel').addEventListener('click', () => $('dlg-pick').close());

  // ---------- распознавание речи ----------
  const Speech = (function () {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let rec = null;
    let wanted = false; // пользователь хочет продолжать диктовку
    let target = null; // id позиции, которую передиктовываем
    let onDevice = localStorage.getItem('pc.ondevice') === '1';

    async function checkOnDevice() {
      // Новые версии Chrome умеют распознавать на самом телефоне (без интернета).
      if (!SR || typeof SR.available !== 'function') return 'unsupported';
      try {
        const st = await SR.available({ langs: ['ru-RU'], processLocally: true });
        onDevice = st === 'available';
        localStorage.setItem('pc.ondevice', onDevice ? '1' : '0');
        return st;
      } catch (e) {
        return 'unsupported';
      }
    }

    function create() {
      const r = new SR();
      r.lang = 'ru-RU';
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      if (onDevice && 'processLocally' in r) r.processLocally = true;
      r.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            $('live').textContent = res[0].transcript;
            addFromText(res[0].transcript, target);
            if (target) {
              target = null;
              wanted = false;
            }
          } else interim += res[0].transcript;
        }
        if (interim) {
          $('live').textContent = interim + ' …';
          $('live').classList.remove('hidden');
        }
      };
      r.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        wanted = false;
        if (e.error === 'network') {
          showMsg('Нет интернета для распознавания. Нажмите на поле ввода внизу и диктуйте через микрофон клавиатуры — он работает без интернета.', true);
        } else if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          showMsg('Разрешите доступ к микрофону для этого приложения.', true);
        } else if (e.error === 'language-not-supported') {
          showMsg('Русский язык для распознавания не установлен. ⚙ → «Скачать русский язык».', true);
        } else {
          showMsg('Ошибка распознавания: ' + e.error);
        }
      };
      r.onend = () => {
        // На Android распознавание останавливается после каждой фразы — перезапускаем, пока включено.
        if (wanted) {
          try { r.start(); return; } catch (e) { /* упадёт ниже */ }
        }
        setUi(false);
      };
      return r;
    }

    function setUi(on) {
      $('btn-mic').classList.toggle('on', on);
      if (!on) setTimeout(() => $('live').classList.add('hidden'), 2500);
      else {
        $('live').textContent = target ? 'Передиктуйте позицию…' : 'Говорите…';
        $('live').classList.remove('hidden');
        $('speech-msg').classList.add('hidden');
      }
    }

    function start(replaceId) {
      if (!SR) {
        showMsg('Этот браузер не умеет распознавать речь. Откройте приложение в Chrome или диктуйте через клавиатуру.', true);
        return;
      }
      if (wanted) stop();
      target = replaceId || null;
      wanted = !target; // передиктовка — одна фраза
      rec = rec || create();
      if (rec.processLocally !== undefined) rec.processLocally = onDevice;
      try {
        rec.start();
      } catch (e) {
        // уже запущено
      }
      setUi(true);
    }

    function stop() {
      wanted = false;
      target = null;
      if (rec) try { rec.stop(); } catch (e) { /* пусто */ }
      setUi(false);
    }

    async function install() {
      if (!SR || typeof SR.install !== 'function') return false;
      try {
        return await SR.install({ langs: ['ru-RU'], processLocally: true });
      } catch (e) {
        return false;
      }
    }

    return {
      supported: !!SR,
      start,
      stop,
      install,
      checkOnDevice,
      get listening() { return wanted; },
    };
  })();

  $('btn-mic').addEventListener('click', () => {
    if ($('btn-mic').classList.contains('on')) Speech.stop();
    else Speech.start();
  });

  // ---------- ввод текстом ----------
  $('btn-add-text').addEventListener('click', () => {
    addFromText($('text-input').value);
    $('text-input').value = '';
  });
  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('btn-add-text').click();
    }
  });

  // ---------- накладная ----------
  $('btn-make').addEventListener('click', () => {
    Speech.stop();
    const bad = draft.items.filter((i) => !i.name);
    if (!draft.items.length) {
      showMsg('Накладная пустая — добавьте товары.');
      return;
    }
    if (bad.length) {
      showMsg('Есть ненайденные позиции (красные). Выберите товар или удалите их.');
      return;
    }
    const now = new Date();
    if (!draft.number) {
      draft.number = Invoice.nextNumber(now, manager(), DISCOUNT);
      draft.date = now.toISOString();
      saveDraft();
    }
    currentInvoice = {
      number: draft.number,
      date: draft.date,
      lines: draft.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, price: i.price })),
      total: total(),
    };
    saveHistory(currentInvoice);
    $('invoice').innerHTML = Invoice.toHtml(currentInvoice);
    show('invoice');
  });

  function saveHistory(inv) {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').filter((x) => x.number !== inv.number);
      h.unshift(inv);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 100)));
    } catch (e) { /* пусто */ }
  }

  function show(name) {
    $('screen-draft').classList.toggle('hidden', name !== 'draft');
    $('screen-invoice').classList.toggle('hidden', name !== 'invoice');
    window.scrollTo(0, 0);
  }

  $('btn-back').addEventListener('click', () => show('draft'));
  $('btn-print').addEventListener('click', () => window.print());
  $('btn-new').addEventListener('click', () => {
    if (!confirm('Начать новую накладную? Текущая сохранена в истории.')) return;
    draft = { items: [], number: null, date: null };
    saveDraft();
    render();
    show('draft');
  });

  $('btn-share-img').addEventListener('click', async () => {
    const blob = await Invoice.toBlob(currentInvoice);
    const file = new File([blob], 'Накладная ' + currentInvoice.number + '.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Накладная ' + currentInvoice.number });
      } catch (e) { /* отменили */ }
    } else {
      // запасной вариант — скачать картинку
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  });

  $('btn-share-text').addEventListener('click', async () => {
    const text = Invoice.toText(currentInvoice);
    if (navigator.share) {
      try { await navigator.share({ text }); } catch (e) { /* отменили */ }
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  });

  // ---------- настройки ----------
  function refreshSettings() {
    $('catalog-info').textContent = catalog
      ? `Загружено товаров: ${catalog.items.length} (${catalog.source}, ${new Date(catalog.loadedAt).toLocaleString('ru-RU')})`
      : 'Каталог не загружен.';
    $('sel-manager').value = manager();
    updateSpeechInfo();
  }
  function openSettings() {
    refreshSettings();
    $('dlg-settings').showModal();
  }
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-open-settings').addEventListener('click', openSettings);
  $('sel-manager').addEventListener('change', (e) => localStorage.setItem(MANAGER_KEY, e.target.value));
  $('btn-view-catalog').addEventListener('click', () => openPicker(null));

  function catalogLoaded(res, silent) {
    catalog = res.cat;
    prepared = Parser.prepareCatalog(catalog.items);
    refreshSettings();
    render();
    let msg = 'Каталог загружен: ' + catalog.items.length + ' товаров.';
    if (res.skipped.length) msg += '\nПропущены без цены: ' + res.skipped.join(', ');
    if (!silent) alert(msg);
  }

  $('file-catalog').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      catalogLoaded(await Catalog.fromFile(f));
    } catch (err) {
      alert('Не удалось загрузить каталог: ' + err.message);
    }
    e.target.value = '';
  });
  // Встроенный каталог магазина. При изменении sample/catalog.csv увеличьте версию —
  // телефоны со встроенным каталогом обновят его сами (загруженный из файла не трогаем).
  const BUILTIN_SOURCE = 'встроенный каталог';
  const BUILTIN_VERSION = 1;

  async function loadBuiltin(silent) {
    const res = await Catalog.fromUrl('sample/catalog.csv', BUILTIN_SOURCE);
    res.cat.version = BUILTIN_VERSION;
    Catalog.save(res.cat);
    catalogLoaded(res, silent);
  }

  $('btn-sample').addEventListener('click', async () => {
    try {
      await loadBuiltin(false);
    } catch (err) {
      alert('Не удалось загрузить каталог: ' + err.message);
    }
  });

  // Проверка запускается только по кнопке: на некоторых браузерах она работает нестабильно.
  $('btn-install-speech').addEventListener('click', async () => {
    const info = $('speech-info');
    if (!Speech.supported) {
      info.textContent = 'Браузер не поддерживает распознавание речи. Используйте Chrome.';
      return;
    }
    info.textContent = 'Проверяю…';
    let st = await Speech.checkOnDevice();
    if (st === 'downloadable' || st === 'downloading') {
      info.textContent = 'Скачиваю русский язык…';
      await Speech.install();
      st = await Speech.checkOnDevice();
    }
    if (st === 'available') info.textContent = '✅ Русский язык установлен на телефон — микрофон работает без интернета.';
    else if (st === 'downloadable' || st === 'downloading') info.textContent = 'Скачивание ещё идёт, проверьте позже.';
    else info.textContent = 'Этот Chrome не умеет распознавать на телефоне — кнопка микрофона требует интернет. Без интернета диктуйте через клавиатуру.';
  });

  function updateSpeechInfo() {
    $('speech-info').textContent = localStorage.getItem('pc.ondevice') === '1'
      ? '✅ Русский язык установлен на телефон — микрофон работает без интернета.'
      : 'Нажмите кнопку ниже, чтобы микрофон работал без интернета (нужен свежий Chrome).';
  }

  // ---------- старт ----------
  render();
  // «пример» — тестовый каталог из 11 товаров первой версии, заменяем на каталог магазина.
  const outdated = catalog && (catalog.source === 'пример' || (catalog.source === BUILTIN_SOURCE && catalog.version !== BUILTIN_VERSION));
  if (!catalog || outdated) {
    loadBuiltin(true).catch(() => {});
  }
  if ('serviceWorker' in navigator) {
    // Когда скачалась новая версия приложения — перезагружаемся, чтобы она включилась сразу.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
  }
})();
