/**
 * Shopping List Card
 * An editable Lovelace card for a Home Assistant `todo` shopping list entity,
 * with categories, prices, sorting, grouping and quick add/edit.
 *
 * https://github.com/jan-tdy/ha-shopping-card
 */

const CARD_VERSION = "2.0.0-beta0";
const CARD_TAG = "shopping-card";
const EDITOR_TAG = "shopping-card-editor";

// Bit flags from Home Assistant's TodoListEntityFeature enum, used to only
// show/allow actions the specific todo entity actually supports.
const TODO_FEATURES = {
  MOVE: 8,
  SET_DESCRIPTION: 64,
};

const MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "superscan", label: "Superscan (barcode, beta)" },
];

// v2 "superscan" mode: scan barcodes instead of checking items off by hand.
// Mercadona (Spain) is the only price/catalog source for now, and only via
// its unofficial, reverse-engineered search API - there is no public contract
// for any of this, so every lookup below is best-effort and must always fall
// back to manual entry without breaking the scan flow.
const MERCADONA_ALGOLIA_APP_ID = "7UZJKL1DJ0";
const MERCADONA_ALGOLIA_SEARCH_KEY = "9d8f2e39e90df472b4f2e559a116fe17";

// Postal-code-prefix -> warehouse code, used to pick the right Algolia index
// (`products_prod_<warehouse>_es`); prices and catalog are zoned per warehouse.
// Only a handful of codes could be confirmed from public sources - everywhere
// else, `mercadona_warehouse` must be set by hand (see README) for live
// lookups to do anything; without it, scanning still works off the local
// barcode memory and manual entry, just without an automatic price fill.
const MERCADONA_WAREHOUSE_BY_PROVINCE = {
  28: "mad1", // Madrid
  8: "bcn1", // Barcelona
  46: "vlc1", // Valencia
  3: "alc1", // Alicante
};

const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

// eslint-disable-next-line no-console
console.info(
  `%c SHOPPING-CARD %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700; border-radius: 3px 0 0 3px;",
  "color: #03a9f4; background: white; font-weight: 700; border-radius: 0 3px 3px 0;"
);

const SORT_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "alpha", label: "Alphabetical" },
  { value: "price", label: "Price" },
];

const CURRENCY_TOKEN = "[€$£¥]|Kč|CZK|EUR|USD";

// Small starter dictionary mapping common grocery item names to a category,
// used as a fallback suggestion before anything has been learned yet.
// Keys are lowercased; English and Slovak names are both included.
const CATEGORY_DICTIONARY = {
  milk: "Dairy", mlieko: "Dairy",
  cheese: "Dairy", syr: "Dairy",
  yogurt: "Dairy", jogurt: "Dairy",
  butter: "Dairy", maslo: "Dairy",
  cream: "Dairy", smotana: "Dairy",
  eggs: "Dairy", vajcia: "Dairy",
  apple: "Produce", apples: "Produce", jablko: "Produce", jablka: "Produce",
  banana: "Produce", bananas: "Produce", banan: "Produce", banány: "Produce",
  tomato: "Produce", tomatoes: "Produce", paradajka: "Produce", paradajky: "Produce",
  potato: "Produce", potatoes: "Produce", zemiak: "Produce", zemiaky: "Produce",
  onion: "Produce", onions: "Produce", cibula: "Produce",
  carrot: "Produce", carrots: "Produce", mrkva: "Produce",
  lettuce: "Produce", šalát: "Produce",
  cucumber: "Produce", uhorka: "Produce",
  bread: "Bakery", chlieb: "Bakery",
  baguette: "Bakery", bageta: "Bakery",
  croissant: "Bakery", rolls: "Bakery", rožky: "Bakery",
  chicken: "Meat", kurča: "Meat", kuracie: "Meat",
  beef: "Meat", hovädzie: "Meat",
  pork: "Meat", bravčové: "Meat",
  sausage: "Meat", klobása: "Meat",
  bacon: "Meat", slanina: "Meat",
  ham: "Meat", šunka: "Meat",
  fish: "Seafood", ryba: "Seafood",
  salmon: "Seafood", losos: "Seafood",
  shrimp: "Seafood",
  tuna: "Seafood", tuniak: "Seafood",
  rice: "Pantry", ryža: "Pantry",
  pasta: "Pantry", cestoviny: "Pantry",
  flour: "Pantry", múka: "Pantry",
  sugar: "Pantry", cukor: "Pantry",
  salt: "Pantry", soľ: "Pantry",
  oil: "Pantry", olej: "Pantry",
  coffee: "Beverages", káva: "Beverages",
  tea: "Beverages", čaj: "Beverages",
  juice: "Beverages", džús: "Beverages",
  water: "Beverages", voda: "Beverages",
  wine: "Beverages", víno: "Beverages",
  beer: "Beverages", pivo: "Beverages",
  soap: "Household", mydlo: "Household",
  detergent: "Household",
  "toilet paper": "Household", "toaletný papier": "Household",
  "paper towels": "Household",
  shampoo: "Personal Care", šampón: "Personal Care",
  toothpaste: "Personal Care", "zubná pasta": "Personal Care",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function categoryColor(name) {
  if (!name) return { bg: "hsl(0, 0%, 88%)", fg: "hsl(0, 0%, 35%)" };
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return { bg: `hsl(${hue}, 65%, 90%)`, fg: `hsl(${hue}, 65%, 28%)` };
}

/**
 * Category, price and quantity are not native `todo` item fields, so they
 * are encoded inline in the item's summary text using simple tags:
 *   "Milk x2 #Dairy 1.50€"
 * This keeps items fully readable/editable from any other todo UI too.
 */
function parseItemText(rawSummary) {
  let name = rawSummary || "";
  let category = null;
  let price = null;
  let qty = 1;

  // Require at least one non-digit character, so a part/model/room number like
  // "#205" or "#220" isn't mistaken for a "#Dairy"-style category tag (categories
  // are always words, see CATEGORY_DICTIONARY).
  const catMatch = name.match(/#([^\s#]*[^\s#0-9][^\s#]*)/);
  if (catMatch) {
    category = catMatch[1].replace(/_/g, " ");
    name = name.slice(0, catMatch.index) + name.slice(catMatch.index + catMatch[0].length);
  }

  // Quantity: "2x Milk" or "Milk x2" (word-bounded, so "2x2 tile" is left alone).
  // The digit can't be directly preceded by "#" either, so a part/model number
  // left untouched above (e.g. "#8" in "Wood screws #8 x 1in") isn't then misread
  // as a quantity by the "digit x" side of this pattern.
  // Real quantity shorthand only ever has a digit on ONE side of the "x"; an
  // "A x B" dimension (bolt/lumber sizes like "M8 x30" or "2 x 6") has a digit
  // on BOTH sides, so each side is rejected when a digit (ignoring whitespace)
  // also sits on the other side of the "x".
  const qtyMatch = name.match(/(?<!#)\b(\d+)\s*[x×]\b(?!\s*\d)|(?<!\d\s*)\b[x×]\s*(\d+)\b/i);
  if (qtyMatch) {
    const n = parseInt(qtyMatch[1] ?? qtyMatch[2], 10);
    if (!Number.isNaN(n) && n > 0) qty = n;
    name = name.slice(0, qtyMatch.index) + name.slice(qtyMatch.index + qtyMatch[0].length);
  }

  const priceRegex = new RegExp(
    `(?:(${CURRENCY_TOKEN})\\s*(\\d+(?:[.,]\\d{1,2})?))|(?:(\\d+(?:[.,]\\d{1,2})?)\\s*(${CURRENCY_TOKEN}))`,
    "i"
  );
  const priceMatch = name.match(priceRegex);
  if (priceMatch) {
    const numStr = priceMatch[2] ?? priceMatch[3];
    const parsed = parseFloat(numStr.replace(",", "."));
    if (!Number.isNaN(parsed)) price = parsed;
    name = name.slice(0, priceMatch.index) + name.slice(priceMatch.index + priceMatch[0].length);
  }

  name = name.replace(/\s{2,}/g, " ").trim();
  return { name, category, price, qty };
}

function buildItemText(name, category, price, currency, qty) {
  let text = (name || "").trim();
  const q = Math.max(1, Math.floor(Number(qty)) || 1);
  if (q > 1) text += ` x${q}`;
  if (price !== null && price !== undefined && price !== "") {
    const num = Number(price);
    if (!Number.isNaN(num)) text += ` ${num.toFixed(2)}${currency || "€"}`;
  }
  if (category && category.trim()) {
    text += ` #${category.trim().replace(/\s+/g, "_")}`;
  }
  return text.trim();
}

function formatPrice(value, currency) {
  return `${Number(value).toFixed(2)}${currency || "€"}`;
}

// A manual override always wins; otherwise resolve the postal code's
// 1-2 digit province prefix against the (necessarily incomplete) warehouse
// table. Returns null when neither is set/known, meaning: skip the live
// lookup, don't guess.
function resolveWarehouse(postalCode, overrideWarehouse, table = MERCADONA_WAREHOUSE_BY_PROVINCE) {
  if (overrideWarehouse && String(overrideWarehouse).trim()) {
    return String(overrideWarehouse).trim();
  }
  const digits = String(postalCode || "").trim();
  if (!/^\d{5}$/.test(digits)) return null;
  const prefix2 = parseInt(digits.slice(0, 2), 10);
  return table[prefix2] || null;
}

// Barcodes only ever come from a scanner/manual digit entry, so any
// non-digit noise is stripped; a very short result isn't a real barcode.
function normalizeBarcode(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 6 ? digits : null;
}

// Matches a scanned/typed product name against the card's own list - the
// `todo` item has no barcode field, so this is the only link between the two.
// Deliberately an exact (trimmed, case-insensitive) match on the parsed name:
// a fuzzy match risks checking off the wrong item.
function findMatchingItem(items, name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  return items.find((it) => !it.completed && it.name.trim().toLowerCase() === key) || null;
}

class ShoppingCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._items = [];
    this._loaded = false;
    this._editingUid = null;
    this._filterText = "";
    this._searchOpen = false;
    this._addExtraOpen = false;
    this._addCategoryTouched = false;
    this._shoppingMode = false;
    this._listenersBound = false;
    this._scannerOpen = false;
    this._scanStatus = null;
    this._scanPendingCode = null;
    this._scanBusy = false;
    this._scanStream = null;
    this._scanGenRef = 0;
    this._zxingReader = null;
    this._offListPurchases = [];
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Please define a todo entity (shopping list).");
    }
    this._config = {
      title: "Shopping List",
      currency: "€",
      show_prices: true,
      show_categories: true,
      group_by_category: true,
      show_completed: true,
      show_progress: true,
      show_search: true,
      show_add: true,
      sort: "manual",
      categories: [],
      show_shopping_mode_button: true,
      nav_button_label: "",
      nav_button_icon: "mdi:fridge-outline",
      nav_button_path: "",
      mode: "normal",
      mercadona_postal_code: "",
      mercadona_warehouse: "",
      ...config,
    };
    this._loadPrefs();
    this._loadLearned();
    this._loadPriceHistory();
    this._loadBarcodeMap();
    this._render();
    if (this._hass) this._fetchItems();
  }

  disconnectedCallback() {
    this._stopScanStream();
  }

  set hass(hass) {
    const prevStateObj = this._hass ? this._hass.states[this._config?.entity] : undefined;
    const firstRun = !this._hass;
    this._hass = hass;
    if (!this._config) return;

    const stateObj = hass.states[this._config.entity];
    if (!stateObj) {
      this._loaded = true;
      this._items = [];
      this._render();
      return;
    }

    if (
      firstRun ||
      !prevStateObj ||
      prevStateObj.last_changed !== stateObj.last_changed ||
      prevStateObj.last_updated !== stateObj.last_updated
    ) {
      this._fetchItems();
    }
  }

  getCardSize() {
    return Math.max(3, Math.ceil((this._items?.length || 0) / 2) + 2);
  }

  static getStubConfig(hass) {
    const entities = hass ? Object.keys(hass.states).filter((e) => e.startsWith("todo.")) : [];
    return {
      type: `custom:${CARD_TAG}`,
      entity: entities[0] || "todo.shopping_list",
      title: "Shopping List",
    };
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  connectedCallback() {
    if (!this._listenersBound) {
      this._bindListeners();
      this._listenersBound = true;
    }
  }

  // ---------- preferences (per-entity, local to the browser) ----------

  _prefsKey() {
    return `shopping-card-prefs-${this._config?.entity}`;
  }

  _loadPrefs() {
    this._collapsed = new Set();
    try {
      const raw = localStorage.getItem(this._prefsKey());
      if (raw) {
        const prefs = JSON.parse(raw);
        if (prefs.sort) this._config.sort = prefs.sort;
        if (typeof prefs.group_by_category === "boolean") {
          this._config.group_by_category = prefs.group_by_category;
        }
        if (Array.isArray(prefs.collapsed)) this._collapsed = new Set(prefs.collapsed);
        if (typeof prefs.shopping_mode === "boolean") this._shoppingMode = prefs.shopping_mode;
      }
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _savePrefs() {
    try {
      localStorage.setItem(
        this._prefsKey(),
        JSON.stringify({
          sort: this._config.sort,
          group_by_category: this._config.group_by_category,
          collapsed: [...this._collapsed],
          shopping_mode: this._shoppingMode,
        })
      );
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  // ---------- category learning & price history (per-entity, local) ----------

  _loadLearned() {
    this._learned = {};
    try {
      const raw = localStorage.getItem(`shopping-card-learned-${this._config.entity}`);
      if (raw) this._learned = JSON.parse(raw);
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _saveLearned() {
    try {
      localStorage.setItem(`shopping-card-learned-${this._config.entity}`, JSON.stringify(this._learned));
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _learnCategory(name, category) {
    if (!name || !category) return;
    const key = name.trim().toLowerCase();
    if (!key || this._learned[key] === category) return;
    this._learned[key] = category;
    this._saveLearned();
  }

  _suggestCategory(name) {
    const key = (name || "").trim().toLowerCase();
    if (!key) return "";
    return this._learned[key] || CATEGORY_DICTIONARY[key] || "";
  }

  _loadPriceHistory() {
    this._priceHistory = {};
    try {
      const raw = localStorage.getItem(`shopping-card-price-history-${this._config.entity}`);
      if (raw) this._priceHistory = JSON.parse(raw);
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _savePriceHistory() {
    try {
      localStorage.setItem(
        `shopping-card-price-history-${this._config.entity}`,
        JSON.stringify(this._priceHistory)
      );
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _learnPrice(name, price) {
    if (!name || price === null || price === undefined || price === "") return;
    const num = Number(price);
    if (Number.isNaN(num)) return;
    const key = name.trim().toLowerCase();
    if (!key) return;
    this._priceHistory[key] = num;
    this._savePriceHistory();
  }

  _suggestPrice(name) {
    const key = (name || "").trim().toLowerCase();
    if (!key) return null;
    return this._priceHistory[key] ?? null;
  }

  // ---------- barcode memory (per-entity, local - superscan mode) ----------
  // Every resolved barcode (from Mercadona or typed in manually) is remembered
  // forever, the same way category/price suggestions are: the live lookup is
  // unofficial and best-effort, the local memory is what makes repeat scans
  // of the same product reliable and instant.

  _loadBarcodeMap() {
    this._barcodeMap = {};
    try {
      const raw = localStorage.getItem(`shopping-card-barcodes-${this._config.entity}`);
      if (raw) this._barcodeMap = JSON.parse(raw);
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _saveBarcodeMap() {
    try {
      localStorage.setItem(
        `shopping-card-barcodes-${this._config.entity}`,
        JSON.stringify(this._barcodeMap)
      );
    } catch (e) {
      // ignore malformed/unavailable storage
    }
  }

  _learnBarcode(code, name, price, category) {
    if (!code || !name) return;
    this._barcodeMap[code] = { name, price: price ?? null, category: category ?? null };
    this._saveBarcodeMap();
  }

  // ---------- capabilities ----------

  _supportsFeature(bit) {
    const stateObj = this._hass?.states[this._config?.entity];
    const supported = stateObj?.attributes?.supported_features || 0;
    return (supported & bit) === bit;
  }

  _dragEnabled() {
    return (
      this._config.sort === "manual" &&
      !this._searchOpen &&
      !this._shoppingMode &&
      this._supportsFeature(TODO_FEATURES.MOVE)
    );
  }

  // ---------- data ----------

  async _fetchItems() {
    if (!this._hass || !this._config) return;
    try {
      const result = await this._hass.callWS({
        type: "todo/item/list",
        entity_id: this._config.entity,
      });
      this._items = result?.items ?? [];
    } catch (e) {
      console.error("shopping-card: failed to load items", e);
      this._items = [];
    }
    this._loaded = true;
    this._render();
  }

  _callService(service, data) {
    return this._hass.callService("todo", service, {
      entity_id: this._config.entity,
      ...data,
    });
  }

  async _addItem(name, category, price, description, qty) {
    const text = buildItemText(name, category, price, this._config.currency, qty);
    if (!text) return;
    const data = { item: text };
    if (description && this._supportsFeature(TODO_FEATURES.SET_DESCRIPTION)) {
      data.description = description;
    }
    this._learnCategory(name, category);
    this._learnPrice(name, price);
    try {
      await this._callService("add_item", data);
    } catch (e) {
      console.error("shopping-card: add_item failed", e);
    }
  }

  async _renameItem(uid, name, category, price, description, qty) {
    const text = buildItemText(name, category, price, this._config.currency, qty);
    if (!text) return;
    const data = { item: uid, rename: text };
    if (this._supportsFeature(TODO_FEATURES.SET_DESCRIPTION)) {
      data.description = description || "";
    }
    this._learnCategory(name, category);
    this._learnPrice(name, price);
    try {
      await this._callService("update_item", data);
    } catch (e) {
      console.error("shopping-card: update_item failed", e);
    }
  }

  _rawPreviousUid(targetUid) {
    const idx = this._items.findIndex((it) => it.uid === targetUid);
    if (idx <= 0) return null;
    return this._items[idx - 1].uid;
  }

  async _moveItem(uid, previousUid) {
    if (uid === previousUid) return;
    try {
      await this._hass.callWS({
        type: "todo/item/move",
        entity_id: this._config.entity,
        uid,
        previous_uid: previousUid ?? undefined,
      });
    } catch (e) {
      console.error("shopping-card: move failed", e);
    }
    this._fetchItems();
  }

  async _setStatus(uid, completed) {
    try {
      await this._callService("update_item", {
        item: uid,
        status: completed ? "completed" : "needs_action",
      });
    } catch (e) {
      console.error("shopping-card: update_item (status) failed", e);
    }
  }

  async _removeItem(uid) {
    try {
      await this._callService("remove_item", { item: uid });
    } catch (e) {
      console.error("shopping-card: remove_item failed", e);
    }
  }

  async _clearCompleted() {
    try {
      await this._callService("remove_completed_items", {});
    } catch (e) {
      const uids = this._items.filter((i) => i.status === "completed").map((i) => i.uid);
      if (uids.length) {
        try {
          await this._callService("remove_item", { item: uids });
        } catch (e2) {
          console.error("shopping-card: fallback clear completed failed", e2);
        }
      }
    }
  }

  // ---------- superscan (barcode scanning) ----------

  async _lookupMercadona(code) {
    const warehouse = resolveWarehouse(
      this._config.mercadona_postal_code,
      this._config.mercadona_warehouse
    );
    if (!warehouse) return null;
    try {
      const url = `https://${MERCADONA_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/products_prod_${warehouse}_es/query`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-algolia-application-id": MERCADONA_ALGOLIA_APP_ID,
          "x-algolia-api-key": MERCADONA_ALGOLIA_SEARCH_KEY,
        },
        body: JSON.stringify({ query: code, hitsPerPage: 5 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const hits = data.hits || [];
      // Only an exact EAN match counts - falling back to "closest" search hit
      // would silently learn the wrong name/price for this barcode forever.
      const hit = hits.find((h) => String(h.ean || "") === code);
      if (!hit) return null;
      const name = hit.display_name || hit.name || null;
      if (!name) return null;
      // Unverified field shape (unofficial API, never confirmed against a
      // live response) - try the plausible spots, give up to manual entry
      // rather than show a wrong price.
      const rawPrice =
        hit.price_instructions?.unit_price ?? hit.price_instructions?.bulk_price ?? hit.price ?? null;
      const price = rawPrice !== null && rawPrice !== undefined ? Number(rawPrice) : null;
      return { name, price: Number.isNaN(price) ? null : price };
    } catch (e) {
      // Reverse-engineered, unofficial API: network errors, CORS, a changed
      // response shape, or Mercadona blocking the request all land here, and
      // all of them just mean "fall back to manual entry".
      return null;
    }
  }

  async _handleScannedCode(rawCode) {
    const code = normalizeBarcode(rawCode);
    if (!code) return;
    // One scan is handled at a time: while a lookup is in flight or a manual
    // form is open waiting for input, the camera keeps decoding frames (the
    // product is usually still under it), but further detections of any
    // code are ignored until the current one is fully resolved. Without
    // this, a slow lookup or a user who keeps typing into the manual form
    // for more than the debounce window re-triggers the same scan and
    // double-counts an off-list purchase.
    if (this._scanBusy || this._scanPendingCode) return;
    this._scanBusy = true;

    const known = this._barcodeMap[code];
    if (known) {
      await this._applyScanResolution(code, known.name, known.price, known.category);
      return;
    }

    this._scanStatus = { kind: "looking", text: "Hľadám…" };
    this._render();

    const found = await this._lookupMercadona(code);
    if (found) {
      await this._applyScanResolution(code, found.name, found.price, null);
    } else {
      this._scanPendingCode = code;
      this._scanStatus = { kind: "manual", text: `Kód ${code} sa nenašiel - doplň ručne.` };
      this._scanBusy = false; // resolving now waits on the manual form's own submit
      this._render();
    }
  }

  async _applyScanResolution(code, name, price, category) {
    const items = this._items.map((it) => this._annotateItem(it));
    const match = findMatchingItem(items, name);
    if (match) {
      if (match.price === null && price !== null && price !== undefined) {
        await this._renameItem(match.uid, match.name, match.category, price, match.description, match.qty);
      }
      await this._setStatus(match.uid, true);
      this._learnBarcode(code, match.name, price ?? match.price, match.category);
      this._scanStatus = { kind: "matched", text: `✓ ${name}` };
    } else {
      this._offListPurchases.push({ code, name, price: price ?? null, qty: 1, ts: Date.now() });
      this._learnBarcode(code, name, price, category);
      this._scanStatus = {
        kind: "offlist",
        text:
          price !== null && price !== undefined
            ? `+ ${name} (mimo zoznamu, ${formatPrice(price, this._config.currency)})`
            : `+ ${name} (mimo zoznamu)`,
      };
    }
    this._scanPendingCode = null;
    this._scanBusy = false;
    this._render();
  }

  _removeOffListPurchase(idx) {
    this._offListPurchases.splice(idx, 1);
    this._render();
  }

  async _openScanner() {
    this._scannerOpen = true;
    this._scanStatus = null;
    this._scanPendingCode = null;
    this._scanBusy = false;
    this._render();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
    } catch (e) {
      if (this._scannerOpen) {
        this._scanStatus = { kind: "error", text: "Kamera nie je dostupná." };
        this._render();
      }
      return;
    }
    // The overlay may have been closed while getUserMedia() was still
    // pending - don't resurrect a stream for a scanner that isn't open
    // anymore, or its camera track would stay on with nothing left to stop it.
    if (!this._scannerOpen) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this._scanStream = stream;
    this._restoreScannerState();
  }

  _stopScanStream() {
    this._scanGenRef++; // invalidate any running detection loop
    if (this._zxingReader) {
      try {
        this._zxingReader.reset();
      } catch (e) {
        // already stopped
      }
      this._zxingReader = null;
    }
    if (this._scanStream) {
      this._scanStream.getTracks().forEach((t) => t.stop());
      this._scanStream = null;
    }
  }

  _closeScanner() {
    this._scannerOpen = false;
    this._scanStatus = null;
    this._scanPendingCode = null;
    this._scanBusy = false;
    this._stopScanStream();
    this._render();
  }

  // Re-binds the live camera stream (never re-requested) to the <video>
  // element the last `_render()` just created, since a full innerHTML
  // rebuild tears down the previous one. Called once from `_openScanner()`
  // and again at the end of every `_render()` while the scanner is open.
  _restoreScannerState() {
    if (!this._scannerOpen || !this._scanStream) return;
    const video = this.shadowRoot.querySelector(".scan-video");
    if (!video) return;
    video.srcObject = this._scanStream;
    video.play().catch(() => {});
    this._startDetectionLoop(video);
  }

  async _startDetectionLoop(video) {
    // Bumping the generation is enough to retire any loop/callback bound to a
    // previous (now-detached) <video> element - see the gen checks below.
    const gen = ++this._scanGenRef;

    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      const tick = async () => {
        if (gen !== this._scanGenRef || !this._scannerOpen) return;
        try {
          const codes = await detector.detect(video);
          if (codes[0]) this._handleScannedCode(codes[0].rawValue);
        } catch (e) {
          // transient decode errors between frames are normal
        }
        if (gen === this._scanGenRef && this._scannerOpen) requestAnimationFrame(tick);
      };
      tick();
      return;
    }

    // Fallback for browsers without the Shape Detection API (e.g. iOS Safari):
    // lazy-load ZXing from a CDN once, then just reset() + rebind the same
    // reader to each new <video> element a re-render creates, instead of
    // re-importing/recreating it on every single status update.
    if (!this._zxingReader) {
      try {
        const zxing = await import(
          "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/esm/index.min.js"
        );
        if (gen !== this._scanGenRef || !this._scannerOpen) return;
        this._zxingReader = new zxing.BrowserMultiFormatReader();
      } catch (e) {
        this._scanStatus = { kind: "error", text: "Skener sa nepodarilo načítať (skús iný prehliadač)." };
        this._render();
        return;
      }
    } else {
      try {
        this._zxingReader.reset();
      } catch (e) {
        // already idle
      }
    }
    this._zxingReader.decodeFromVideoElement(video, (result) => {
      if (gen !== this._scanGenRef) return;
      if (result) this._handleScannedCode(result.getText());
    });
  }

  // ---------- derived data ----------

  _annotateItem(it) {
    const parsed = parseItemText(it.summary);
    const completed = it.status === "completed";
    const lineTotal = parsed.price !== null ? parsed.price * parsed.qty : null;
    return { ...it, ...parsed, description: it.description || "", completed, lineTotal };
  }

  _processedItems() {
    let items = this._items.map((it) => this._annotateItem(it));

    if (this._filterText) {
      const f = this._filterText.toLowerCase();
      items = items.filter(
        (it) =>
          it.name.toLowerCase().includes(f) ||
          (it.category || "").toLowerCase().includes(f) ||
          it.description.toLowerCase().includes(f)
      );
    }

    if (!this._config.show_completed || this._shoppingMode) {
      items = items.filter((it) => !it.completed);
    }

    return items;
  }

  // Predefined categories (from config) come first, in the given order,
  // followed by any other categories already used on items, alphabetically.
  _categories() {
    const predefined = (this._config.categories || []).filter(Boolean);
    const used = new Set();
    this._items.forEach((it) => {
      const { category } = parseItemText(it.summary);
      if (category) used.add(category);
    });
    predefined.forEach((c) => used.delete(c));
    return [...predefined, ...[...used].sort((a, b) => a.localeCompare(b))];
  }

  _sortItems(items) {
    const collator = new Intl.Collator(this._hass?.language || "en");
    const cmp = (a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      switch (this._config.sort) {
        case "alpha":
          return collator.compare(a.name, b.name);
        case "price":
          return (b.lineTotal ?? -Infinity) - (a.lineTotal ?? -Infinity);
        default:
          return 0;
      }
    };
    return [...items].sort(cmp);
  }

  _groupItems(items) {
    if (!this._config.group_by_category) {
      return [{ category: null, items: this._sortItems(items) }];
    }
    const map = new Map();
    for (const it of items) {
      const key = it.category || null;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    const collator = new Intl.Collator(this._hass?.language || "en");
    const predefined = this._config.categories || [];
    const groups = [...map.entries()].map(([category, its]) => ({
      category,
      items: this._sortItems(its),
    }));
    groups.sort((a, b) => {
      if (a.category === null) return 1;
      if (b.category === null) return -1;
      const aIdx = predefined.indexOf(a.category);
      const bIdx = predefined.indexOf(b.category);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return collator.compare(a.category, b.category);
    });
    return groups;
  }

  // ---------- rendering ----------

  // Fields the reader may be typing into when a re-render lands on them. Closing over the
  // form is what keeps a re-render from wiping a half-typed item: the card is rebuilt with
  // `innerHTML` on every entity change, so without this a partner checking an item, or a voice
  // add, discarded whatever was in the add form and the search box.
  _liveFields() {
    return [
      ".add-name",
      ".add-qty",
      ".add-category",
      ".add-price",
      ".add-description",
      ".edit-name",
      ".edit-qty",
      ".edit-category",
      ".edit-price",
      ".edit-description",
      ".search-input",
      ".scan-manual-name",
      ".scan-manual-price",
      ".scan-manual-category",
    ];
  }

  _captureFieldState() {
    const state = {};
    const active = this.shadowRoot && this.shadowRoot.activeElement;
    const entity = this._config?.entity;
    for (const selector of this._liveFields()) {
      const el = this.shadowRoot.querySelector(selector);
      if (!el) continue;
      const editRow = el.closest(".item.editing");
      state[selector] = {
        value: el.value,
        focused: el === active,
        entity,
        editUid: editRow ? editRow.dataset.uid : null,
      };
    }
    return state;
  }

  _restoreFieldState(state) {
    if (!state) return;
    const entity = this._config?.entity;
    let refocus = null;
    for (const selector of this._liveFields()) {
      const saved = state[selector];
      // A capture from a different entity (setConfig() switched the list)
      // must never seed this entity's form.
      if (!saved || saved.entity !== entity) continue;
      const el = this.shadowRoot.querySelector(selector);
      if (!el) continue;
      if (saved.editUid !== null) {
        // Edit fields are always populated by the rebuild (the item's current value),
        // so "only fill empty" never restores a typed edit. Carry the draft over only
        // when the rebuild is still the same item's edit row.
        const editRow = el.closest(".item.editing");
        if (!editRow || editRow.dataset.uid !== saved.editUid) continue;
        el.value = saved.value;
      } else if (el.value === "") {
        // Only fill a field the rebuild left empty, so values written by the card itself
        // are not overwritten by a stale capture.
        el.value = saved.value;
      }
      if (saved.focused) refocus = el;
    }
    if (refocus) {
      refocus.focus();
      // Put the caret back at the end so typing continues where it left off.
      try {
        const end = refocus.value.length;
        refocus.setSelectionRange(end, end);
      } catch (_e) {
        /* not every input type supports a selection range */
      }
    }
  }

  _render() {
    if (!this._config) return;
    // Defensive default: a test harness (or any caller) that skips the real
    // constructor would otherwise crash here instead of just rendering empty.
    if (!this._offListPurchases) this._offListPurchases = [];

    // Capture before the shadow root is replaced below: the elements are gone afterwards.
    const fieldState = this._captureFieldState();

    if (!this._hass || !this._hass.states[this._config.entity]) {
      this.shadowRoot.innerHTML = this._styles() + `
        <ha-card>
          <div class="empty-state">
            Entity <code>${escapeHtml(this._config.entity)}</code> not found.
            It must be a <code>todo</code> entity (e.g. your Home Assistant shopping list).
          </div>
        </ha-card>`;
      this._restoreFieldState(fieldState);
      return;
    }

    const allItems = this._items.map((it) => this._annotateItem(it));
    const total = allItems.length;
    const completedCount = allItems.filter((it) => it.status === "completed").length;
    const progressPct = total ? Math.round((completedCount / total) * 100) : 0;
    const estimatedTotal = allItems
      .filter((it) => it.lineTotal !== null)
      .reduce((sum, it) => sum + it.lineTotal, 0);
    const offListTotal = this._offListPurchases.reduce(
      (sum, p) => sum + (p.price || 0) * (p.qty || 1),
      0
    );
    const cartTotal =
      allItems
        .filter((it) => it.status === "completed" && it.lineTotal !== null)
        .reduce((sum, it) => sum + it.lineTotal, 0) + offListTotal;

    const processed = this._processedItems();
    const groups = this._groupItems(processed);
    const categories = this._categories();
    const shoppingMode = this._shoppingMode;

    const groupsHtml = !this._loaded
      ? `<div class="empty-state">Loading…</div>`
      : total === 0
      ? `<div class="empty-state">No items yet. Add one below.</div>`
      : processed.length === 0
      ? `<div class="empty-state">No items match your search.</div>`
      : groups.map((g) => this._renderGroup(g)).join("");

    this.shadowRoot.innerHTML = this._styles() + `
      <ha-card class="${shoppingMode ? "shopping-mode" : ""}">
        <div class="header">
          <div class="title-row">
            <span class="title">${escapeHtml(this._config.title)}</span>
          </div>
          <div class="toolbar">
            ${
              !shoppingMode && this._config.show_search
                ? `<button class="icon-btn" data-action="toggle-search" title="Search">
                    <ha-icon icon="mdi:magnify"></ha-icon>
                   </button>`
                : ""
            }
            ${
              !shoppingMode
                ? `<select class="sort-select" data-action="change-sort" title="Sort">
                    ${SORT_OPTIONS.map(
                      (o) =>
                        `<option value="${o.value}" ${o.value === this._config.sort ? "selected" : ""}>${o.label}</option>`
                    ).join("")}
                   </select>
                   <button
                     class="icon-btn ${this._config.group_by_category ? "active" : ""}"
                     data-action="toggle-group"
                     title="Group by category"
                   >
                     <ha-icon icon="mdi:shape-outline"></ha-icon>
                   </button>`
                : ""
            }
            ${
              this._config.nav_button_path
                ? `<button class="icon-btn" data-action="nav-button" title="${escapeHtml(this._config.nav_button_label || "Open")}">
                    <ha-icon icon="${escapeHtml(this._config.nav_button_icon || "mdi:open-in-new")}"></ha-icon>
                   </button>`
                : ""
            }
            ${
              this._config.show_shopping_mode_button
                ? `<button
                    class="icon-btn ${shoppingMode ? "active" : ""}"
                    data-action="toggle-shopping-mode"
                    title="Shopping mode"
                  >
                    <ha-icon icon="${shoppingMode ? "mdi:fullscreen-exit" : "mdi:fullscreen"}"></ha-icon>
                   </button>`
                : ""
            }
            ${
              this._config.mode === "superscan"
                ? `<button class="icon-btn" data-action="open-scanner" title="Skenovať čiarový kód">
                    <ha-icon icon="mdi:barcode-scan"></ha-icon>
                   </button>`
                : ""
            }
          </div>
          ${
            !shoppingMode && this._config.show_search && this._searchOpen
              ? `<input
                  type="text"
                  class="search-input"
                  data-role="search"
                  placeholder="Search items…"
                  value="${escapeHtml(this._filterText)}"
                />`
              : ""
          }
          ${
            this._config.show_progress && total > 0
              ? `<div class="progress-row">
                  <div class="progress-track"><div class="progress-bar" style="width:${progressPct}%"></div></div>
                  <span class="progress-label">${completedCount}/${total}</span>
                 </div>`
              : ""
          }
        </div>

        ${this._renderPriceTrackBar(estimatedTotal, cartTotal)}

        <div class="items">${groupsHtml}</div>

        ${this._renderOffList()}

        ${
          !shoppingMode && completedCount > 0
            ? `<div class="footer">
                <button class="text-btn" data-action="clear-completed">
                  <ha-icon icon="mdi:broom"></ha-icon> Clear completed
                </button>
               </div>`
            : ""
        }

              ${this._config.show_add ? this._renderAddForm(categories) : ""}
              ${this._renderScannerOverlay()}
            </ha-card>`;

          // Put back what was being typed, and the caret, into the freshly built form.
          this._restoreFieldState(fieldState);
          // Re-bind the live camera stream to the fresh <video> element, if open.
          this._restoreScannerState();
        }
        _renderGroup(group) {
    const isCollapsed = group.category !== null && this._collapsed.has(group.category);
    const label = group.category || "Uncategorized";
    const color = categoryColor(group.category);
    const subtotal = group.items
      .filter((it) => it.status !== "completed" && it.lineTotal !== null)
      .reduce((sum, it) => sum + it.lineTotal, 0);

    const headerHtml =
      this._config.group_by_category
        ? `<div class="group-header" data-action="toggle-category" data-category="${escapeHtml(group.category || "")}">
            <ha-icon icon="${isCollapsed ? "mdi:chevron-right" : "mdi:chevron-down"}"></ha-icon>
            <span class="group-name" style="color:${color.fg}">${escapeHtml(label)}</span>
            <span class="group-count">${group.items.length}</span>
            ${
              this._config.show_prices && subtotal > 0
                ? `<span class="group-subtotal">${escapeHtml(formatPrice(subtotal, this._config.currency))}</span>`
                : ""
            }
           </div>`
        : "";

    const rowsHtml = isCollapsed
      ? ""
      : group.items.map((it) => this._renderItem(it)).join("");

    return `<div class="group">${headerHtml}${rowsHtml}</div>`;
  }

  _renderItem(item) {
    if (this._editingUid === item.uid) {
      return this._renderEditRow(item);
    }
    const color = categoryColor(item.category);
    const draggable = this._dragEnabled();
    const shoppingMode = this._shoppingMode;
    const priceTitle =
      item.price !== null && item.qty > 1
        ? `${formatPrice(item.price, this._config.currency)} × ${item.qty}`
        : "";
    return `<div
      class="item ${item.completed ? "completed" : ""}"
      data-uid="${escapeHtml(item.uid)}"
      data-category="${escapeHtml(item.category || "")}"
      ${draggable ? 'draggable="true"' : ""}
    >
      ${
        draggable
          ? `<span class="drag-handle" title="Drag to reorder"><ha-icon icon="mdi:drag-vertical"></ha-icon></span>`
          : ""
      }
      <input type="checkbox" class="checkbox" data-action="toggle-item" data-uid="${escapeHtml(item.uid)}" ${item.completed ? "checked" : ""} />
      <div class="item-body">
        <div class="item-main-row">
          ${item.qty > 1 ? `<span class="qty-chip">×${item.qty}</span>` : ""}
          <span class="item-name">${escapeHtml(item.name) || "(no name)"}</span>
          ${
            this._config.show_categories && item.category
              ? `<span class="chip" style="background:${color.bg};color:${color.fg}">${escapeHtml(item.category)}</span>`
              : ""
          }
          ${
            this._config.show_prices && item.lineTotal !== null
              ? `<span class="price" title="${escapeHtml(priceTitle)}">${escapeHtml(formatPrice(item.lineTotal, this._config.currency))}</span>`
              : ""
          }
        </div>
        ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ""}
      </div>
      ${
        shoppingMode
          ? ""
          : `<button class="icon-btn small" data-action="edit-item" data-uid="${escapeHtml(item.uid)}" title="Edit">
              <ha-icon icon="mdi:pencil"></ha-icon>
            </button>
            <button class="icon-btn small" data-action="delete-item" data-uid="${escapeHtml(item.uid)}" title="Delete">
              <ha-icon icon="mdi:delete-outline"></ha-icon>
            </button>`
      }
    </div>`;
  }

  _renderEditRow(item) {
    const descriptionSupported = this._supportsFeature(TODO_FEATURES.SET_DESCRIPTION);
    return `<div class="item editing" data-uid="${escapeHtml(item.uid)}">
      <form class="edit-form" data-form="edit" data-uid="${escapeHtml(item.uid)}">
        <div class="edit-row">
          <input type="text" name="name" class="edit-name" value="${escapeHtml(item.name)}" placeholder="Name" autofocus />
          <input type="number" name="qty" class="edit-qty" min="1" step="1" value="${item.qty || 1}" title="Quantity" />
          <input type="text" name="category" class="edit-category" value="${escapeHtml(item.category || "")}" placeholder="Category" list="sc-categories" />
          <input type="number" name="price" class="edit-price" step="0.01" min="0" value="${item.price !== null ? item.price : ""}" placeholder="Price" />
          <button type="submit" class="icon-btn small primary" title="Save"><ha-icon icon="mdi:check"></ha-icon></button>
          <button type="button" class="icon-btn small" data-action="cancel-edit" title="Cancel"><ha-icon icon="mdi:close"></ha-icon></button>
        </div>
        ${
          descriptionSupported
            ? `<textarea name="description" class="edit-description" placeholder="Note…" rows="2">${escapeHtml(item.description)}</textarea>`
            : ""
        }
      </form>
    </div>`;
  }

  _renderAddForm(categories) {
    const descriptionSupported = this._supportsFeature(TODO_FEATURES.SET_DESCRIPTION);
    const shoppingMode = this._shoppingMode;
    return `<form class="add-form" data-form="add">
      <div class="add-row">
        <input type="text" name="name" class="add-name" placeholder="Add item…" autocomplete="off" required />
        ${shoppingMode ? "" : `<span class="suggest-hint"></span>`}
        ${
          shoppingMode
            ? ""
            : `<button type="button" class="icon-btn ${this._addExtraOpen ? "active" : ""}" data-action="toggle-add-extra" title="More options">
                <ha-icon icon="mdi:tune-variant"></ha-icon>
              </button>`
        }
        <button type="submit" class="icon-btn primary" title="Add">
          <ha-icon icon="mdi:plus"></ha-icon>
        </button>
      </div>
      ${
        shoppingMode
          ? ""
          : `<div class="add-extra" ${this._addExtraOpen ? "" : "hidden"}>
              <input type="number" name="qty" class="add-qty" min="1" step="1" placeholder="Qty" title="Quantity" />
              <input type="text" name="category" class="add-category" placeholder="Category" list="sc-categories" />
              <input type="number" name="price" class="add-price" step="0.01" min="0" placeholder="Price" />
              ${
                descriptionSupported
                  ? `<input type="text" name="description" class="add-description" placeholder="Note" />`
                  : ""
              }
             </div>`
      }
      <datalist id="sc-categories">
        ${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("")}
      </datalist>
    </form>`;
  }

  // A large, always-visible price summary (to-buy vs. already-bought), shown
  // right under the header - deliberately big and hard to miss, the same way
  // a running cart total is front-and-center in grocery-shopping apps.
  _renderPriceTrackBar(estimatedTotal, cartTotal) {
    if (!this._config.show_prices) return "";
    return `<div class="price-track-bar">
      <div class="price-track-stat buy">
        <span class="price-track-label">To buy</span>
        <span class="price-track-value">${escapeHtml(formatPrice(estimatedTotal, this._config.currency))}</span>
      </div>
      <div class="price-track-stat bought">
        <ha-icon icon="mdi:cart-outline"></ha-icon>
        <span class="price-track-label">Bought</span>
        <span class="price-track-value">${escapeHtml(formatPrice(cartTotal, this._config.currency))}</span>
      </div>
    </div>`;
  }

  _renderOffList() {
    if (!this._offListPurchases.length) return "";
    const subtotal = this._offListPurchases.reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
    return `<div class="off-list">
      <div class="off-list-header">
        <ha-icon icon="mdi:barcode-off"></ha-icon>
        <span>Mimo zoznamu</span>
        ${subtotal > 0 ? `<span class="off-list-subtotal">${escapeHtml(formatPrice(subtotal, this._config.currency))}</span>` : ""}
      </div>
      ${this._offListPurchases
        .map(
          (p, idx) => `<div class="off-list-item">
            <span class="off-list-name">${escapeHtml(p.name)}</span>
            ${
              p.price !== null && p.price !== undefined
                ? `<span class="price">${escapeHtml(formatPrice(p.price, this._config.currency))}</span>`
                : ""
            }
            <button class="icon-btn small" data-action="remove-offlist" data-idx="${idx}" title="Odstrániť">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>`
        )
        .join("")}
    </div>`;
  }

  _renderScannerOverlay() {
    if (!this._scannerOpen) return "";
    const statusKind = this._scanStatus?.kind || "idle";
    const statusText = this._scanStatus?.text || "Namier kameru na čiarový kód…";
    return `<div class="scan-overlay">
      <div class="scan-topbar">
        <span>Skenovanie</span>
        <button class="icon-btn" data-action="close-scanner" title="Zavrieť">
          <ha-icon icon="mdi:close"></ha-icon>
        </button>
      </div>
      <video class="scan-video" autoplay muted playsinline></video>
      <div class="scan-status scan-status-${statusKind}">${escapeHtml(statusText)}</div>
      ${
        this._scanPendingCode
          ? `<form class="scan-manual-form" data-form="scan-manual">
              <input type="text" name="name" class="scan-manual-name" placeholder="Názov" required autofocus />
              <input type="number" name="price" class="scan-manual-price" step="0.01" min="0" placeholder="Cena" />
              <input type="text" name="category" class="scan-manual-category" placeholder="Kategória" list="sc-categories" />
              <button type="submit" class="icon-btn primary" title="Uložiť"><ha-icon icon="mdi:check"></ha-icon></button>
             </form>`
          : ""
      }
    </div>`;
  }

  _styles() {
    return `<style>
      :host { display: block; }
      ha-card { padding: 0; overflow: hidden; position: relative; }
      .header { padding: 16px 16px 8px; }
      .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .title { font-size: 1.2em; font-weight: 500; color: var(--primary-text-color); }
      .price-track-bar {
        display: flex; margin: 4px 16px 0; border-radius: 12px; overflow: hidden;
        background: var(--primary-color);
      }
      .price-track-stat {
        flex: 1; display: flex; flex-direction: column; align-items: center;
        gap: 2px; padding: 14px 8px;
        color: var(--text-primary-color, #fff);
      }
      .price-track-stat.bought { background: rgba(0, 0, 0, 0.14); }
      .price-track-stat ha-icon { --mdc-icon-size: 18px; opacity: 0.9; }
      .price-track-label {
        font-size: 0.72em; font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.06em; opacity: 0.85;
      }
      .price-track-value { font-size: 1.9em; font-weight: 800; line-height: 1.15; }
      .toolbar { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
      .sort-select {
        flex: 1;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 4px 6px;
        font-size: 0.85em;
      }
      .icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        background: none; border: none; cursor: pointer;
        color: var(--secondary-text-color);
        width: 36px; height: 36px; border-radius: 50%;
        flex-shrink: 0;
      }
      .icon-btn.small { width: 30px; height: 30px; }
      .icon-btn:hover { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06); }
      .icon-btn.active, .icon-btn.primary { color: var(--primary-color); }
      .search-input, .edit-name, .edit-category, .edit-price, .edit-description,
      .add-name, .add-category, .add-price, .add-description {
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 0.9em;
        font-family: inherit;
      }
      .search-input { width: 100%; margin-top: 8px; box-sizing: border-box; }
      .progress-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
      .progress-track { flex: 1; height: 6px; border-radius: 3px; background: var(--divider-color); overflow: hidden; }
      .progress-bar { height: 100%; background: var(--primary-color); transition: width 0.2s ease; }
      .progress-label { font-size: 0.8em; color: var(--secondary-text-color); min-width: 40px; text-align: right; }
      .items { padding: 4px 8px; }
      .empty-state { padding: 24px 16px; text-align: center; color: var(--secondary-text-color); }
      .group { margin-bottom: 4px; }
      .group-header {
        display: flex; align-items: center; gap: 6px;
        padding: 8px 8px; cursor: pointer; color: var(--secondary-text-color);
      }
      .group-name { font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.03em; }
      .group-count { font-size: 0.8em; opacity: 0.7; }
      .group-subtotal { margin-left: auto; font-size: 0.85em; font-weight: 600; color: var(--primary-text-color); }
      .item {
        display: flex; align-items: center; gap: 4px;
        padding: 6px 8px; border-radius: 8px;
        border-top: 2px solid transparent; border-bottom: 2px solid transparent;
      }
      .item:hover { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.04); }
      .item.completed .item-name { text-decoration: line-through; color: var(--secondary-text-color); }
      .item.dragging { opacity: 0.4; }
      .item.drag-over-top { border-top-color: var(--primary-color); }
      .item.drag-over-bottom { border-bottom-color: var(--primary-color); }
      .item.no-drop { cursor: no-drop; }
      .drag-handle {
        display: flex; align-items: center; color: var(--secondary-text-color);
        cursor: grab; flex-shrink: 0; opacity: 0.6;
      }
      .drag-handle ha-icon { --mdc-icon-size: 18px; }
      .checkbox { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--primary-color); cursor: pointer; }
      .item-body { flex: 1; min-width: 0; }
      .item-main-row { display: flex; align-items: center; gap: 8px; }
      .item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color); }
      .item-desc {
        font-size: 0.8em; color: var(--secondary-text-color);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .chip { font-size: 0.75em; font-weight: 600; padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
      .qty-chip {
        font-size: 0.75em; font-weight: 700; color: var(--primary-color); flex-shrink: 0;
      }
      .price { font-size: 0.85em; font-weight: 600; color: var(--primary-text-color); flex-shrink: 0; }
      .edit-form { display: flex; flex-direction: column; gap: 6px; width: 100%; }
      .edit-row { display: flex; align-items: center; gap: 6px; width: 100%; flex-wrap: wrap; }
      .edit-name { flex: 2; min-width: 100px; }
      .edit-qty { width: 56px; }
      .edit-category { flex: 1; min-width: 80px; }
      .edit-price { width: 80px; }
      .edit-description { width: 100%; box-sizing: border-box; resize: vertical; }
      .footer { padding: 4px 8px 8px; display: flex; justify-content: flex-end; }
      .text-btn {
        display: inline-flex; align-items: center; gap: 4px;
        background: none; border: none; cursor: pointer;
        color: var(--secondary-text-color); font-size: 0.85em; padding: 6px 8px; border-radius: 8px;
      }
      .text-btn:hover { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06); }
      .add-form { display: flex; flex-direction: column; gap: 6px; padding: 8px 16px 16px; border-top: 1px solid var(--divider-color); margin-top: 4px; padding-top: 12px; }
      .add-row { display: flex; align-items: center; gap: 4px; position: relative; }
      .add-name { flex: 1; min-width: 100px; }
      .suggest-hint {
        position: absolute; left: 12px; top: 100%; margin-top: 2px;
        font-size: 0.75em; color: var(--secondary-text-color); pointer-events: none;
      }
      .add-extra { display: flex; gap: 6px; width: 100%; flex-wrap: wrap; }
      .add-extra[hidden] { display: none; }
      .add-qty { width: 56px; }
      .add-category { flex: 1; min-width: 80px; }
      .add-price { width: 90px; }
      .add-description { flex: 2; min-width: 120px; }
      code { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06); padding: 1px 4px; border-radius: 4px; }

      /* Shopping mode: bigger touch targets, fewer distractions while walking the aisles. */
      .shopping-mode .item { padding: 12px 8px; font-size: 1.05em; }
      .shopping-mode .checkbox { width: 26px; height: 26px; }
      .shopping-mode .add-row .icon-btn.primary { width: 44px; height: 44px; }

      /* Superscan mode: off-list purchases and the scanner overlay. */
      .off-list { padding: 4px 16px 12px; border-top: 1px solid var(--divider-color); margin-top: 4px; }
      .off-list-header {
        display: flex; align-items: center; gap: 6px; padding: 8px 0;
        color: var(--secondary-text-color); font-weight: 600; font-size: 0.85em;
        text-transform: uppercase; letter-spacing: 0.03em;
      }
      .off-list-subtotal { margin-left: auto; color: var(--primary-text-color); text-transform: none; }
      .off-list-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
      .off-list-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .scan-overlay {
        position: absolute; inset: 0; z-index: 10;
        background: var(--card-background-color);
        display: flex; flex-direction: column;
      }
      .scan-topbar {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 8px 8px 16px; font-weight: 500; color: var(--primary-text-color);
      }
      .scan-video { flex: 1; width: 100%; min-height: 200px; background: #000; object-fit: cover; }
      .scan-status {
        padding: 10px 16px; text-align: center; font-size: 0.95em;
        color: var(--primary-text-color); min-height: 1.4em;
      }
      .scan-status-matched { color: var(--success-color, #43a047); }
      .scan-status-offlist { color: var(--primary-color); }
      .scan-status-error { color: var(--error-color, #db4437); }
      .scan-manual-form {
        display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px 16px;
      }
      .scan-manual-name { flex: 2; min-width: 100px; }
      .scan-manual-price { width: 90px; }
      .scan-manual-category { flex: 1; min-width: 80px; }
      .scan-manual-name, .scan-manual-price, .scan-manual-category {
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 0.9em;
        font-family: inherit;
      }
    </style>`;
  }

  // ---------- events ----------

  _bindListeners() {
    const root = this.shadowRoot;

    root.addEventListener("click", (ev) => {
      const target = ev.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      const uid = target.dataset.uid;

      switch (action) {
        case "toggle-search":
          this._searchOpen = !this._searchOpen;
          if (!this._searchOpen) this._filterText = "";
          this._render();
          break;
        case "toggle-group":
          this._config.group_by_category = !this._config.group_by_category;
          this._savePrefs();
          this._render();
          break;
        case "toggle-category":
          {
            const cat = target.dataset.category;
            if (this._collapsed.has(cat)) this._collapsed.delete(cat);
            else this._collapsed.add(cat);
            this._savePrefs();
            this._render();
          }
          break;
        case "edit-item":
          this._editingUid = uid;
          this._render();
          break;
        case "cancel-edit":
          this._editingUid = null;
          this._render();
          break;
        case "delete-item":
          if (confirm("Delete this item?")) this._removeItem(uid);
          break;
        case "clear-completed":
          if (confirm("Remove all completed items?")) this._clearCompleted();
          break;
        case "toggle-add-extra":
          this._addExtraOpen = !this._addExtraOpen;
          {
            const extra = root.querySelector(".add-extra");
            if (extra) extra.hidden = !this._addExtraOpen;
            target.classList.toggle("active", this._addExtraOpen);
          }
          break;
        case "toggle-shopping-mode":
          this._shoppingMode = !this._shoppingMode;
          this._savePrefs();
          this._render();
          break;
        case "nav-button":
          if (this._config.nav_button_path) {
            history.pushState(null, "", this._config.nav_button_path);
            window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
          }
          break;
        case "open-scanner":
          this._openScanner();
          break;
        case "close-scanner":
          this._closeScanner();
          break;
        case "remove-offlist":
          this._removeOffListPurchase(Number(target.dataset.idx));
          break;
        default:
          break;
      }
    });

    root.addEventListener("change", (ev) => {
      if (ev.target.matches('[data-action="toggle-item"]')) {
        this._setStatus(ev.target.dataset.uid, ev.target.checked);
      } else if (ev.target.matches('[data-action="change-sort"]')) {
        this._config.sort = ev.target.value;
        this._savePrefs();
        this._render();
      }
    });

    root.addEventListener("input", (ev) => {
      if (ev.target.matches('[data-role="search"]')) {
        this._filterText = ev.target.value;
        this._applySearchFilter();
        return;
      }
      if (ev.target.matches(".add-name")) {
        if (this._shoppingMode) return;
        const name = ev.target.value;
        const hint = root.querySelector(".suggest-hint");
        if (!this._addCategoryTouched) {
          const suggestion = this._suggestCategory(name);
          const catInput = root.querySelector(".add-category");
          if (catInput) catInput.value = suggestion;
          if (hint) hint.textContent = suggestion ? `→ ${suggestion}` : "";
        }
        const priceInput = root.querySelector(".add-price");
        if (priceInput) {
          const suggestedPrice = this._suggestPrice(name);
          priceInput.placeholder =
            suggestedPrice !== null ? `~${formatPrice(suggestedPrice, this._config.currency)}` : "Price";
        }
        return;
      }
      if (ev.target.matches(".add-category")) {
        this._addCategoryTouched = ev.target.value !== "";
      }
    });

    root.addEventListener("submit", (ev) => {
      const form = ev.target.closest("form");
      if (!form) return;
      ev.preventDefault();

      if (form.dataset.form === "add") {
        const data = new FormData(form);
        const name = (data.get("name") || "").toString().trim();
        if (!name) return;
        const category = (data.get("category") || "").toString().trim();
        const price = (data.get("price") || "").toString().trim();
        const description = (data.get("description") || "").toString().trim();
        const qty = (data.get("qty") || "").toString().trim();
        this._addItem(name, category, price === "" ? null : price, description, qty === "" ? 1 : qty);
        form.reset();
        const extra = form.querySelector(".add-extra");
        if (extra) extra.hidden = true;
        this._addExtraOpen = false;
        this._addCategoryTouched = false;
        const hint = form.querySelector(".suggest-hint");
        if (hint) hint.textContent = "";
        const priceInput = form.querySelector(".add-price");
        if (priceInput) priceInput.placeholder = "Price";
      } else if (form.dataset.form === "edit") {
        const uid = form.dataset.uid;
        const data = new FormData(form);
        const name = (data.get("name") || "").toString().trim();
        const category = (data.get("category") || "").toString().trim();
        const price = (data.get("price") || "").toString().trim();
        const description = (data.get("description") || "").toString().trim();
        const qty = (data.get("qty") || "").toString().trim();
        this._editingUid = null;
        this._renameItem(uid, name, category, price === "" ? null : price, description, qty === "" ? 1 : qty);
      } else if (form.dataset.form === "scan-manual") {
        const data = new FormData(form);
        const name = (data.get("name") || "").toString().trim();
        if (!name || !this._scanPendingCode) return;
        const price = (data.get("price") || "").toString().trim();
        const category = (data.get("category") || "").toString().trim();
        this._applyScanResolution(
          this._scanPendingCode,
          name,
          price === "" ? null : Number(price),
          category || null
        );
      }
    });

    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this._editingUid) {
        this._editingUid = null;
        this._render();
      } else if (ev.key === "Escape" && this._scannerOpen) {
        this._closeScanner();
      }
    });

    // Drag-and-drop manual reordering (only active in "manual" sort mode).
    root.addEventListener("dragstart", (ev) => {
      const row = ev.target.closest(".item[draggable='true']");
      if (!row) return;
      this._dragUid = row.dataset.uid;
      this._dragCategory = row.dataset.category || "";
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", row.dataset.uid);
      row.classList.add("dragging");
    });

    root.addEventListener("dragover", (ev) => {
      const row = ev.target.closest(".item[data-uid]");
      if (!row || !this._dragUid || row.dataset.uid === this._dragUid) return;
      if (this._config.group_by_category && row.dataset.category !== this._dragCategory) {
        row.classList.add("no-drop");
        return;
      }
      ev.preventDefault();
      row.classList.remove("no-drop");
      const rect = row.getBoundingClientRect();
      const before = ev.clientY - rect.top < rect.height / 2;
      row.classList.toggle("drag-over-top", before);
      row.classList.toggle("drag-over-bottom", !before);
    });

    root.addEventListener("dragleave", (ev) => {
      const row = ev.target.closest(".item[data-uid]");
      if (row) row.classList.remove("drag-over-top", "drag-over-bottom", "no-drop");
    });

    root.addEventListener("drop", (ev) => {
      const row = ev.target.closest(".item[data-uid]");
      if (!row || !this._dragUid) return;
      ev.preventDefault();
      const targetUid = row.dataset.uid;
      const draggedUid = this._dragUid;
      const before = row.classList.contains("drag-over-top");
      row.classList.remove("drag-over-top", "drag-over-bottom", "no-drop");
      if (targetUid === draggedUid) return;
      if (this._config.group_by_category && row.dataset.category !== this._dragCategory) return;
      const previousUid = before ? this._rawPreviousUid(targetUid) : targetUid;
      this._moveItem(draggedUid, previousUid);
    });

    root.addEventListener("dragend", () => {
      this._dragUid = null;
      this._dragCategory = null;
      root.querySelectorAll(".item").forEach((row) => {
        row.classList.remove("dragging", "drag-over-top", "drag-over-bottom", "no-drop");
      });
    });
  }

  // Filters rows in place without a full re-render, so the search input
  // never loses focus while the user types.
  _applySearchFilter() {
    const root = this.shadowRoot;
    const f = this._filterText.toLowerCase();
    root.querySelectorAll(".items .item[data-uid]").forEach((row) => {
      const name = row.querySelector(".item-name")?.textContent?.toLowerCase() || "";
      const chip = row.querySelector(".chip")?.textContent?.toLowerCase() || "";
      const desc = row.querySelector(".item-desc")?.textContent?.toLowerCase() || "";
      row.style.display = !f || name.includes(f) || chip.includes(f) || desc.includes(f) ? "" : "none";
    });
    root.querySelectorAll(".group").forEach((group) => {
      const visible = [...group.querySelectorAll(".item[data-uid]")].some(
        (row) => row.style.display !== "none"
      );
      group.style.display = visible ? "" : "none";
    });
  }
}

class ShoppingCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._renderForm();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  get _schema() {
    return [
      { name: "entity", required: true, selector: { entity: { domain: "todo" } } },
      { name: "title", selector: { text: {} } },
      { name: "currency", selector: { text: {} } },
      {
        name: "sort",
        selector: {
          select: { mode: "dropdown", options: SORT_OPTIONS },
        },
      },
      { name: "group_by_category", selector: { boolean: {} } },
      { name: "categories", selector: { text: { multiple: true } } },
      { name: "show_categories", selector: { boolean: {} } },
      { name: "show_prices", selector: { boolean: {} } },
      { name: "show_completed", selector: { boolean: {} } },
      { name: "show_progress", selector: { boolean: {} } },
      { name: "show_search", selector: { boolean: {} } },
      { name: "show_add", selector: { boolean: {} } },
      { name: "show_shopping_mode_button", selector: { boolean: {} } },
      { name: "nav_button_label", selector: { text: {} } },
      { name: "nav_button_icon", selector: { icon: {} } },
      { name: "nav_button_path", selector: { text: {} } },
      {
        name: "mode",
        selector: {
          select: { mode: "dropdown", options: MODE_OPTIONS },
        },
      },
      { name: "mercadona_postal_code", selector: { text: {} } },
      { name: "mercadona_warehouse", selector: { text: {} } },
    ];
  }

  _labels() {
    return {
      entity: "Shopping list entity",
      title: "Title",
      currency: "Currency symbol",
      sort: "Sort items by",
      group_by_category: "Group by category",
      categories: "Categories (defines order, and suggestions)",
      show_categories: "Show category chips",
      show_prices: "Show prices",
      show_completed: "Show completed items",
      show_progress: "Show progress bar",
      show_search: "Show search",
      show_add: "Show quick-add form",
      show_shopping_mode_button: "Show \"Shopping mode\" button",
      nav_button_label: "Extra button: label (optional)",
      nav_button_icon: "Extra button: icon",
      nav_button_path: "Extra button: navigates to (dashboard path, optional)",
      mode: "Mode: normal or superscan (barcode, beta)",
      mercadona_postal_code: "Superscan: postal code (for Mercadona price zone, best-effort)",
      mercadona_warehouse: "Superscan: Mercadona warehouse code override (advanced, see README)",
    };
  }

  _renderForm() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    if (!this._form) {
      this.shadowRoot.innerHTML = "";
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = ev.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config } }));
      });
      this.shadowRoot.appendChild(this._form);
    }
    const labels = this._labels();
    this._form.hass = this._hass;
    this._form.data = this._config;
    this._form.schema = this._schema;
    this._form.computeLabel = (schema) => labels[schema.name] || schema.name;
  }
}

customElements.define(CARD_TAG, ShoppingCard);
customElements.define(EDITOR_TAG, ShoppingCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Shopping List Card",
  description:
    "Editable shopping list card backed by a Home Assistant todo entity, with categories, prices, quantities, notes, drag-to-reorder, category/price suggestions, a shopping mode, and (v2, beta) a barcode-scanning superscan mode.",
  preview: true,
  documentationURL: "https://github.com/jan-tdy/ha-shopping-card",
});
