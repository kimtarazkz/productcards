// Номер накладной, вид для печати и картинка для WhatsApp.
(function (root) {
  'use strict';

  const COUNTER_KEY = 'pc.counter';

  const pad2 = (n) => String(n).padStart(2, '0');

  // Номер: ДДММ-МСС-NN
  //   ДДММ — день и месяц
  //   М    — номер менеджера (1..9)
  //   СС   — скидка в процентах, две цифры (00 — без скидки)
  //   NN   — порядковый номер за день, с 01
  // Пример: 1410-100-07 — 14 октября, менеджер 1, без скидки, седьмая за день.
  function nextNumber(date, manager, discount) {
    const day = pad2(date.getDate()) + pad2(date.getMonth() + 1);
    const dayKey = date.getFullYear() + '-' + day;
    let counter = {};
    try {
      counter = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
    } catch (e) { /* пусто */ }
    const seq = counter.day === dayKey ? counter.seq + 1 : 1;
    localStorage.setItem(COUNTER_KEY, JSON.stringify({ day: dayKey, seq }));
    return day + '-' + manager + pad2(discount) + '-' + pad2(seq);
  }

  function money(n) {
    const r = Math.round(n * 100) / 100;
    return r.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatDate(d) {
    return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // inv = {number, date, lines:[{name, qty, unit, price}], total}
  function toHtml(inv) {
    const rows = inv.lines.map((l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.name)}</td>
        <td class="c">${esc(l.unit || 'шт')}</td>
        <td class="r">${money(l.qty)}</td>
        <td class="r">${money(l.price)}</td>
        <td class="r">${money(l.qty * l.price)}</td>
      </tr>`).join('');
    return `
      <div class="inv-title">Строительный магазин</div>
      <div class="inv-head">
        <div><b>Накладная № ${esc(inv.number)}</b></div>
        <div>от ${formatDate(new Date(inv.date))}</div>
      </div>
      <table class="inv-table">
        <thead><tr><th>№</th><th>Наименование</th><th>Ед.</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="5" class="r"><b>Итого:</b></td><td class="r"><b>${money(inv.total)}</b></td></tr></tfoot>
      </table>`;
  }

  function toText(inv) {
    const lines = inv.lines.map((l, i) => `${i + 1}. ${l.name} — ${money(l.qty)} ${l.unit || 'шт'} × ${money(l.price)} = ${money(l.qty * l.price)}`);
    return ['Строительный магазин', `Накладная № ${inv.number} от ${formatDate(new Date(inv.date))}`, '', ...lines, '', `Итого: ${money(inv.total)}`].join('\n');
  }

  // Рисуем накладную в картинку без сторонних библиотек.
  function toCanvas(inv) {
    const W = 1240, pad = 50;
    const cols = [
      { t: '№', w: 70, a: 'center' },
      { t: 'Наименование', w: 540, a: 'left' },
      { t: 'Ед.', w: 90, a: 'center' },
      { t: 'Кол-во', w: 140, a: 'right' },
      { t: 'Цена', w: 150, a: 'right' },
      { t: 'Сумма', w: 150, a: 'right' },
    ];
    const font = (size, bold) => `${bold ? 'bold ' : ''}${size}px Roboto, Arial, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font(28);
    const wrap = (text, width) => {
      const words = String(text).split(' ');
      const lines = [];
      let line = '';
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (measure.measureText(test).width > width && line) {
          lines.push(line);
          line = w;
        } else line = test;
      }
      lines.push(line);
      return lines;
    };
    const lh = 38;
    const rows = inv.lines.map((l, i) => {
      const nameLines = wrap(l.name, cols[1].w - 20);
      return { cells: [String(i + 1), nameLines, l.unit || 'шт', money(l.qty), money(l.price), money(l.qty * l.price)], h: nameLines.length * lh + 18 };
    });
    const headH = 190, thH = 56, footH = 70;
    const H = headH + thH + rows.reduce((s, r) => s + r.h, 0) + footH + pad;

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#000';
    g.textBaseline = 'middle';

    g.font = font(40, true);
    g.textAlign = 'center';
    g.fillText('Строительный магазин', W / 2, 60);
    g.font = font(32, true);
    g.textAlign = 'left';
    g.fillText('Накладная № ' + inv.number, pad, 130);
    g.font = font(30);
    g.textAlign = 'right';
    g.fillText('от ' + formatDate(new Date(inv.date)), W - pad, 130);

    g.strokeStyle = '#000';
    g.lineWidth = 2;
    let y = headH;
    const xs = [];
    let x = pad;
    for (const c of cols) { xs.push(x); x += c.w; }
    const right = x;

    const cellText = (txt, ci, cy) => {
      const c = cols[ci];
      g.textAlign = c.a;
      const tx = c.a === 'left' ? xs[ci] + 10 : c.a === 'right' ? xs[ci] + c.w - 10 : xs[ci] + c.w / 2;
      g.fillText(txt, tx, cy);
    };

    g.fillStyle = '#eee';
    g.fillRect(pad, y, right - pad, thH);
    g.fillStyle = '#000';
    g.font = font(26, true);
    cols.forEach((c, i) => cellText(c.t, i, y + thH / 2));
    g.strokeRect(pad, y, right - pad, thH);
    y += thH;

    g.font = font(28);
    for (const r of rows) {
      r.cells.forEach((cell, ci) => {
        if (Array.isArray(cell)) cell.forEach((ln, k) => cellText(ln, ci, y + 9 + lh / 2 + k * lh));
        else cellText(cell, ci, y + r.h / 2);
      });
      g.strokeRect(pad, y, right - pad, r.h);
      y += r.h;
    }
    const top = headH;
    for (let i = 1; i < xs.length; i++) {
      g.beginPath();
      g.moveTo(xs[i], top);
      g.lineTo(xs[i], y);
      g.stroke();
    }
    g.font = font(32, true);
    g.textAlign = 'right';
    g.fillText('Итого: ' + money(inv.total), right - 10, y + footH / 2 + 5);
    return cv;
  }

  function toBlob(inv) {
    return new Promise((resolve) => toCanvas(inv).toBlob(resolve, 'image/png'));
  }

  root.Invoice = { nextNumber, toHtml, toText, toBlob, money, formatDate };
})(window);
