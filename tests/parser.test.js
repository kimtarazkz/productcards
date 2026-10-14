// Запуск: node --test tests/parser.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../js/parser.js');

// Каталог магазина: sample/catalog.csv (разделитель «;»).
function loadCatalog() {
  const text = fs.readFileSync(path.join(__dirname, '../sample/catalog.csv'), 'utf8').trim();
  return text.split('\n').slice(1).map((line) => {
    const cells = [];
    let cell = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ';') { cells.push(cell); cell = ''; } else cell += ch;
    }
    cells.push(cell);
    return { name: cells[1], synonyms: cells[2].split(',').map((s) => s.trim()), price: +cells[3] };
  });
}
const items = loadCatalog();
const cat = P.prepareCatalog(items);
const parse = (t) => P.parse(t, cat).map((r) => [r.productIdx === null ? null : items[r.productIdx].name, r.qty]);
const check = (phrase, expected) => test(phrase, () => assert.deepStrictEqual(parse(phrase), expected));

test('каталог загружен', () => assert.strictEqual(items.length, 52));

test('числа словами', () => {
  const t = P.tokenize('сто десять пятьдесят две двадцать пять десять').filter((x) => x.t === 'num').map((x) => x.v);
  assert.deepStrictEqual(t, [110, 52, 25, 10]);
});

check('полуотвод диаметр 50 2 штуки', [['Полуотвод 50', 2]]);
check('труба 50 диаметр 3 штуки', [['Труба 50 армированная стекловолокном', 3]]);
check('кран 25 шаровый 2 штуки', [['Кран 25 шаровый', 2]]);
check('кран шаровый двадцать пять две штуки', [['Кран 25 шаровый', 2]]);
check('отводы 50 10 штук', [['Отвод 50', 10]]);
check('отвод 50 канализационный 4 штуки', [['Отвод 50 канализационный', 4]]);
check('пол отвод пятьдесят четыре штуки', [['Полуотвод 50', 4]]);
check('тройник 50 на 25 1 штука', [['Тройник 50/25', 1]]);
check('переходник 50 32 2 шт', [['Переходник 50/32', 2]]);
check('американка 50 на полтора наружная 2 штуки', [['Американка 50 х 1 1/2 наружная резьба', 2]]);
check('накидная гайка 32 на три четверти 2 штуки', [['Накидная гайка 32 х 3/4', 2]]);
check('манометр 1 штука', [['Манометр 1/2', 1]]);
check('котел эра 45 1 штука', [['Котел отопительный ERA-45 НМ', 1]]);
check('стабилизатор эра 1 штука', [['Стабилизатор напряжения ЭРА', 1]]);
check('насос вило 1 штука', [['Циркуляционный насос Wilo 100 E', 1]]);
check('клей 2 штуки', [['Клей для труб', 2]]);
check('труба канализационная 50 метр 3 штуки', [['Труба канализационная 50 (1м)', 3]]);
check('труба 50 полметра 2 штуки', [['Труба канализационная 50 (0.5м)', 2]]);
check('пена монтажная 2 баллона', [['Монтажная пена', 2]]);

test('«52 штуки» = 50 и 2 шт с пометкой', () => {
  const r = P.parse('полуотвод диаметр 52 штуки', cat);
  assert.deepStrictEqual(r.map((x) => [items[x.productIdx].name, x.qty]), [['Полуотвод 50', 2]]);
  assert.strictEqual(r[0].status, 'warn');
});

check('полуотвод 50 2 штуки труба 50 3 штуки хомут 50 8 штук', [
  ['Полуотвод 50', 2], ['Труба 50 армированная стекловолокном', 3], ['Хомут сантехнический 50', 8],
]);
check('кран 25 шаровый 2 штуки отвод 25 10 штук муфта 25 10 штук тройник 20 5 штук', [
  ['Кран 25 шаровый', 2], ['Отвод 25', 10], ['Муфта 25 полипропилен', 10], ['Тройник 20', 5],
]);
check('отвод двадцать пять десять штук и муфта двадцать пять пять штук', [
  ['Отвод 25', 10], ['Муфта 25 полипропилен', 5],
]);
check('скотч 1 перчатки 2 пена 3', [
  ['Скотч армированный сантехнический', 1], ['Перчатки рабочие (комплект)', 2], ['Монтажная пена', 3],
]);

test('неизвестный товар', () => {
  const r = P.parse('унитаз белый 1 штука', cat);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].status, 'error');
});

test('неизвестный товар среди известных', () => {
  assert.deepStrictEqual(parse('полуотвод 50 2 штуки унитаз белый 1 штука отвод 25 3 штуки'), [
    ['Полуотвод 50', 2], [null, 1], ['Отвод 25', 3],
  ]);
});

test('скорость: длинная фраза разбирается быстро', () => {
  const t0 = Date.now();
  P.parse('полуотвод 50 2 штуки труба 50 3 штуки хомут 50 8 штук кран 25 шаровый 2 штуки отвод 25 10 штук муфта 25 10 штук тройник 20 5 штук клипса 50 20 штук', cat);
  assert.ok(Date.now() - t0 < 1500, 'слишком медленно: ' + (Date.now() - t0) + ' мс');
});

test('труба 50 диаметр 3 штуки 3 метра — длина не мешает', () => {
  const r = P.parse('труба 50 диаметр 3 штуки 3 метра', cat);
  assert.deepStrictEqual(r.map((x) => [items[x.productIdx].name, x.qty, x.status]), [['Труба 50 армированная стекловолокном', 3, 'ok']]);
});

test('«штук» остаётся в своей позиции', () => {
  const r = P.parse('труба 20 10 штук труба 32 5 штук', cat);
  assert.deepStrictEqual(r.map((x) => x.text), ['труба 20 10 штук', 'труба 32 5 штук']);
});

test('неизвестный товар в конце фразы', () => {
  assert.deepStrictEqual(parse('насос вило 1 штука унитаз 1 штука'), [['Циркуляционный насос Wilo 100 E', 1], [null, 1]]);
});

check('переходник для насоса вило 1 штука', [['Переходник для насоса Wilo', 1]]);
check('котел era 45 1 штука', [['Котел отопительный ERA-45 НМ', 1]]);
