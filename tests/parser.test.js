// Запуск: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const P = require('../js/parser.js');

function loadSample() {
  const lines = fs.readFileSync(path.join(__dirname, '../sample/catalog-example.csv'), 'utf8').trim().split('\n').slice(1);
  return lines.map((l) => {
    const [name, price, syn] = l.split(';');
    return { name, price: +price, synonyms: syn.split(',').map((s) => s.trim()) };
  });
}
const items = loadSample();
const cat = P.prepareCatalog(items);
const names = (res) => res.map((r) => [r.productIdx === null ? null : items[r.productIdx].name, r.qty]);

test('числа словами', () => {
  const t = P.tokenize('сто десять пятьдесят две двадцать пять десять').filter((x) => x.t === 'num').map((x) => x.v);
  assert.deepStrictEqual(t, [110, 52, 25, 10]);
});

test('полуотвод цифрами', () => {
  assert.deepStrictEqual(names(P.parse('полуотвод диаметр 50 2 штуки', cat)), [['Полуотвод Ø50', 2]]);
});

test('«52 штуки» = 50 и 2 шт', () => {
  const r = P.parse('полуотвод диаметр 52 штуки', cat);
  assert.deepStrictEqual(names(r), [['Полуотвод Ø50', 2]]);
  assert.strictEqual(r[0].status, 'warn');
});

test('труба 3 штуки по 3 метра', () => {
  assert.deepStrictEqual(names(P.parse('труба 50 диаметр 3 штуки 3 метра', cat)), [['Труба Ø50 3 м', 3]]);
});

test('несколько позиций в одной фразе', () => {
  const r = P.parse('полуотвод 50 две штуки отвод 25 десять штук хомут 50 8 штук тройник 50 на 25 1 штука', cat);
  assert.deepStrictEqual(names(r), [
    ['Полуотвод Ø50', 2], ['Отвод Ø25', 10], ['Хомут Ø50', 8], ['Тройник 50/25', 1],
  ]);
});

test('пол отвод раздельно и словами', () => {
  assert.deepStrictEqual(names(P.parse('пол отвод пятьдесят четыре штуки', cat)), [['Полуотвод Ø50', 4]]);
});

test('дюймы: муфта 32 на три четверти', () => {
  assert.deepStrictEqual(names(P.parse('муфта 32 на три четверти 2 штуки', cat)), [['Муфта 32х3/4', 2]]);
});

test('переход 50 32 без «на»', () => {
  assert.deepStrictEqual(names(P.parse('переходник 50 32 2 шт', cat)), [['Переход 50/32', 2]]);
});

test('отводы во множественном числе', () => {
  assert.deepStrictEqual(names(P.parse('отводы 50 10 штук', cat)), [['Отвод Ø50', 10]]);
});

test('неизвестный товар', () => {
  const r = P.parse('унитаз белый 1 штука', cat);
  assert.strictEqual(r[0].status, 'error');
});

test('синоним с числом: отвод 45 = полуотвод', () => {
  assert.deepStrictEqual(names(P.parse('отвод 45 диаметр 50 3 штуки', cat)), [['Полуотвод Ø50', 3]]);
});
