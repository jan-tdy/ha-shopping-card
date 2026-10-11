// Proves the defect and the fix in a real DOM: a re-render must not wipe typed input.
// Run from the repo root after `npm install --no-save jsdom`.
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.customElements = dom.window.customElements;
global.navigator = dom.window.navigator;

dom.window.eval(fs.readFileSync('shopping-card.js', 'utf8'));
const Card = dom.window.customElements.get('shopping-card');
if (!Card) { console.error('card class not registered'); process.exit(1); }

// A genuine element with a real shadow root, carrying the card's methods.
const card = dom.window.document.createElement('div');
dom.window.document.body.appendChild(card);
card.attachShadow({ mode: 'open' });
for (const name of Object.getOwnPropertyNames(Card.prototype)) {
  if (name === 'constructor') continue;
  card[name] = Card.prototype[name];
}

card._config = {
  entity: 'todo.shopping_list', title: 'Shopping', currency: 'EUR',
  show_add: true, show_prices: true, show_search: true,
};
card._loaded = true;
card._searchOpen = true;
card._items = [
  { uid: '1', summary: 'Milk', status: 'needs_action' },
  { uid: '2', summary: 'Bread', status: 'completed' },
];
card._hass = {
  states: { 'todo.shopping_list': { state: '1', attributes: { items: [] } } },
  callService: () => {},
};

card._render();
const nameEl = card.shadowRoot.querySelector('.add-name');
const searchEl = card.shadowRoot.querySelector('.search-input');
if (!nameEl || !searchEl) { console.error('form fields not rendered'); process.exit(1); }

nameEl.value = 'Half typed';
searchEl.value = 'mil';
nameEl.focus();

// A re-render lands: what a partner's change or a voice add triggers.
card._render();

const afterName = card.shadowRoot.querySelector('.add-name');
const afterSearch = card.shadowRoot.querySelector('.search-input');
console.log('add-name preserved :', JSON.stringify(afterName.value));
console.log('search   preserved :', JSON.stringify(afterSearch.value));
console.log('focus restored     :', card.shadowRoot.activeElement === afterName);

const ok =
  afterName.value === 'Half typed' &&
  afterSearch.value === 'mil' &&
  card.shadowRoot.activeElement === afterName;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
