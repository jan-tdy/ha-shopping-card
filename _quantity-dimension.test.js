// Proves the fix for #5: "A x B" dimension notation (bolt/lumber sizes, e.g.
// "M8 x30", "2 x 6") must not be mistaken for "qty x item" quantity shorthand.
// Run from the repo root after `npm install --no-save jsdom`.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('shopping-card.js', 'utf8'));
const parseItemText = dom.window.parseItemText;
if (typeof parseItemText !== 'function') { console.error('parseItemText not found'); process.exit(1); }

const cases = [
  // [input, expected name, expected qty]
  // Dimension notation: a digit on both sides of "x" must be left alone.
  ['M8 x30 bolt', 'M8 x30 bolt', 1],
  ['Bolt M6 x16', 'Bolt M6 x16', 1],
  ['Beam 2 x 6', 'Beam 2 x 6', 1],
  ['Post 4 x 4', 'Post 4 x 4', 1],
  ['Wood screws #8 x 1in', 'Wood screws #8 x 1in', 1],
  ['2x4 lumber', '2x4 lumber', 1],
  // Real quantity shorthand: a digit on only one side of "x" still works.
  ['2x Milk', 'Milk', 2],
  ['Milk x2', 'Milk', 2],
  ['6 x Eggs', 'Eggs', 6],
  ['2x2 tile', '2x2 tile', 1],
];

let ok = true;
for (const [input, expectedName, expectedQty] of cases) {
  const { name, qty } = parseItemText(input);
  const pass = name === expectedName && qty === expectedQty;
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(input)} -> name=${JSON.stringify(name)} qty=${qty}` +
      (pass ? '' : ` (expected name=${JSON.stringify(expectedName)} qty=${expectedQty})`)
  );
  if (!pass) ok = false;
}

process.exit(ok ? 0 : 1);
