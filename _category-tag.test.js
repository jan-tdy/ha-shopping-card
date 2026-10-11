// Proves the fix for #4: a "#"-prefixed number in an item name (room/part/grit
// number) must not be mistaken for a "#tag"-style category.
// Run from the repo root after `npm install --no-save jsdom`.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('shopping-card.js', 'utf8'));
const parseItemText = dom.window.parseItemText;
if (typeof parseItemText !== 'function') { console.error('parseItemText not found'); process.exit(1); }

const cases = [
  // [input, expected name, expected category]
  ['Room #205 access card', 'Room #205 access card', null],
  ['Wood screws #8 x 1in', 'Wood screws #8 x 1in', null],
  ['Sandpaper grit #220', 'Sandpaper grit #220', null],
  // Real category tags must still be parsed.
  ['Milk #Dairy 1.50€', 'Milk', 'Dairy'],
  ['Shampoo #Personal_care', 'Shampoo', 'Personal care'],
];

let ok = true;
for (const [input, expectedName, expectedCategory] of cases) {
  const { name, category } = parseItemText(input);
  const pass = name === expectedName && category === expectedCategory;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(input)} -> name=${JSON.stringify(name)} category=${JSON.stringify(category)}` +
      (pass ? '' : ` (expected name=${JSON.stringify(expectedName)} category=${JSON.stringify(expectedCategory)})`)
  );
  if (!pass) ok = false;
}

process.exit(ok ? 0 : 1);
