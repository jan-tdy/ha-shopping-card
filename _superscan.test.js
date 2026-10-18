// Proves the pure helpers behind superscan mode (v2.0.0-beta0): resolving a
// Mercadona warehouse from a postal code/override, normalizing a scanned
// barcode, and matching a resolved product name against the current list.
// Run from the repo root after `npm install --no-save jsdom`.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('shopping-card.js', 'utf8'));
const { resolveWarehouse, normalizeBarcode, findMatchingItem } = dom.window;
if (typeof resolveWarehouse !== 'function' || typeof normalizeBarcode !== 'function' || typeof findMatchingItem !== 'function') {
  console.error('one or more superscan helpers not found on window');
  process.exit(1);
}

let ok = true;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}` + (pass ? '' : ` (expected ${JSON.stringify(expected)})`));
  if (!pass) ok = false;
}

const table = { 28: 'mad1', 8: 'bcn1' };

// resolveWarehouse
check('override wins over postal code', resolveWarehouse('14640', 'cor9', table), 'cor9');
check('known province prefix (Madrid)', resolveWarehouse('28022', '', table), 'mad1');
check('known province prefix with leading zero (Barcelona)', resolveWarehouse('08013', '', table), 'bcn1');
check('unknown province prefix', resolveWarehouse('14640', '', table), null);
check('malformed postal code', resolveWarehouse('abc', '', table), null);
check('empty everything', resolveWarehouse('', '', table), null);

// normalizeBarcode
check('strips noise around digits', normalizeBarcode(' 8480000123456 \n'), '8480000123456');
check('rejects too-short input', normalizeBarcode('123'), null);
check('rejects empty/garbage', normalizeBarcode('abc'), null);

// findMatchingItem
const items = [
  { name: 'Milk', completed: false },
  { name: 'Bread', completed: true },
  { name: 'milk', completed: false }, // duplicate-ish, case-insensitivity still resolves to the first non-completed match
];
check('matches case-insensitively', findMatchingItem(items, 'MILK')?.name, 'Milk');
check('ignores completed items', findMatchingItem(items, 'Bread'), null);
check('no match for unrelated name', findMatchingItem(items, 'Eggs'), null);
check('empty name never matches', findMatchingItem(items, ''), null);

process.exit(ok ? 0 : 1);
