/**
 * Shopping List Card
 * An editable Lovelace card for a Home Assistant `todo` shopping list entity,
 * with categories, prices, sorting, grouping and quick add/edit.
 *
 * https://github.com/jan-tdy/ha-shopping-card
 */

const CARD_VERSION = "0.1.0";
const CARD_TAG = "shopping-card";
const EDITOR_TAG = "shopping-card-editor";

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
 * Category and price are not native `todo` item fields, so they are encoded
 * inline in the item's summary text using simple tags:
 *   "Milk #Dairy 1.50€"
 * This keeps items fully readable/editable from any other todo UI too.
 */
function parseItemText(rawSummary) {
  let name = rawSummary || "";
  let category = null;
  let price = null;

  const catMatch = name.match(/#([^\s#]+)/);
  if (catMatch) {
    category = catMatch[1].replace(/_/g, " ");
    name = name.slice(0, catMatch.index) + name.slice(catMatch.index + catMatch[0].length);
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
  return { name, category, price };
}

function buildItemText(name, category, price, currency) {
  let text = (name || "").trim();
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
    this._listenersBound = false;
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
      ...config,
    };
    this._loadPrefs();
    this._render();
    if (this._hass) this._fetchItems();
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
        })
      );
    } catch (e) {
      // ignore malformed/unavailable storage
    }
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

  async _addItem(name, category, price) {
    const text = buildItemText(name, category, price, this._config.currency);
    if (!text) return;
    try {
      await this._callService("add_item", { item: text });
    } catch (e) {
      console.error("shopping-card: add_item failed", e);
    }
  }

  async _renameItem(uid, name, category, price) {
    const text = buildItemText(name, category, price, this._config.currency);
    if (!text) return;
    try {
      await this._callService("update_item", { item: uid, rename: text });
    } catch (e) {
      console.error("shopping-card: update_item failed", e);
    }
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

  // ---------- derived data ----------

  _processedItems() {
    let items = this._items.map((it) => {
      const parsed = parseItemText(it.summary);
      return { ...it, ...parsed, completed: it.status === "completed" };
    });

    if (this._filterText) {
      const f = this._filterText.toLowerCase();
      items = items.filter(
        (it) =>
          it.name.toLowerCase().includes(f) ||
          (it.category || "").toLowerCase().includes(f)
      );
    }

    if (!this._config.show_completed) {
      items = items.filter((it) => !it.completed);
    }

    return items;
  }

  _categories() {
    const set = new Set();
    this._items.forEach((it) => {
      const { category } = parseItemText(it.summary);
      if (category) set.add(category);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  _sortItems(items) {
    const collator = new Intl.Collator(this._hass?.language || "en");
    const cmp = (a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      switch (this._config.sort) {
        case "alpha":
          return collator.compare(a.name, b.name);
        case "price":
          return (b.price ?? -Infinity) - (a.price ?? -Infinity);
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
    const groups = [...map.entries()].map(([category, its]) => ({
      category,
      items: this._sortItems(its),
    }));
    groups.sort((a, b) => {
      if (a.category === null) return 1;
      if (b.category === null) return -1;
      return collator.compare(a.category, b.category);
    });
    return groups;
  }

  // ---------- rendering ----------

  _render() {
    if (!this._config) return;

    if (!this._hass || !this._hass.states[this._config.entity]) {
      this.shadowRoot.innerHTML = this._styles() + `
        <ha-card>
          <div class="empty-state">
            Entity <code>${escapeHtml(this._config.entity)}</code> not found.
            It must be a <code>todo</code> entity (e.g. your Home Assistant shopping list).
          </div>
        </ha-card>`;
      return;
    }

    const allItems = this._items.map((it) => ({ ...it, ...parseItemText(it.summary) }));
    const total = allItems.length;
    const completedCount = allItems.filter((it) => it.status === "completed").length;
    const progressPct = total ? Math.round((completedCount / total) * 100) : 0;
    const openTotal = allItems
      .filter((it) => it.status !== "completed" && it.price !== null)
      .reduce((sum, it) => sum + it.price, 0);

    const processed = this._processedItems();
    const groups = this._groupItems(processed);
    const categories = this._categories();

    const groupsHtml = !this._loaded
      ? `<div class="empty-state">Loading…</div>`
      : total === 0
      ? `<div class="empty-state">No items yet. Add one below.</div>`
      : processed.length === 0
      ? `<div class="empty-state">No items match your search.</div>`
      : groups.map((g) => this._renderGroup(g)).join("");

    this.shadowRoot.innerHTML = this._styles() + `
      <ha-card>
        <div class="header">
          <div class="title-row">
            <span class="title">${escapeHtml(this._config.title)}</span>
            ${
              this._config.show_prices && openTotal > 0
                ? `<span class="total-price">${escapeHtml(formatPrice(openTotal, this._config.currency))}</span>`
                : ""
            }
          </div>
          <div class="toolbar">
            ${
              this._config.show_search
                ? `<button class="icon-btn" data-action="toggle-search" title="Search">
                    <ha-icon icon="mdi:magnify"></ha-icon>
                   </button>`
                : ""
            }
            <select class="sort-select" data-action="change-sort" title="Sort">
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
            </button>
          </div>
          ${
            this._config.show_search && this._searchOpen
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

        <div class="items">${groupsHtml}</div>

        ${
          completedCount > 0
            ? `<div class="footer">
                <button class="text-btn" data-action="clear-completed">
                  <ha-icon icon="mdi:broom"></ha-icon> Clear completed
                </button>
               </div>`
            : ""
        }

        ${this._config.show_add ? this._renderAddForm(categories) : ""}
      </ha-card>`;
  }

  _renderGroup(group) {
    const isCollapsed = group.category !== null && this._collapsed.has(group.category);
    const label = group.category || "Uncategorized";
    const color = categoryColor(group.category);
    const subtotal = group.items
      .filter((it) => it.status !== "completed" && it.price !== null)
      .reduce((sum, it) => sum + it.price, 0);

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
    return `<div class="item ${item.completed ? "completed" : ""}" data-uid="${escapeHtml(item.uid)}">
      <input type="checkbox" class="checkbox" data-action="toggle-item" data-uid="${escapeHtml(item.uid)}" ${item.completed ? "checked" : ""} />
      <span class="item-name">${escapeHtml(item.name) || "(no name)"}</span>
      ${
        this._config.show_categories && item.category
          ? `<span class="chip" style="background:${color.bg};color:${color.fg}">${escapeHtml(item.category)}</span>`
          : ""
      }
      ${
        this._config.show_prices && item.price !== null
          ? `<span class="price">${escapeHtml(formatPrice(item.price, this._config.currency))}</span>`
          : ""
      }
      <button class="icon-btn small" data-action="edit-item" data-uid="${escapeHtml(item.uid)}" title="Edit">
        <ha-icon icon="mdi:pencil"></ha-icon>
      </button>
      <button class="icon-btn small" data-action="delete-item" data-uid="${escapeHtml(item.uid)}" title="Delete">
        <ha-icon icon="mdi:delete-outline"></ha-icon>
      </button>
    </div>`;
  }

  _renderEditRow(item) {
    return `<div class="item editing" data-uid="${escapeHtml(item.uid)}">
      <form class="edit-form" data-form="edit" data-uid="${escapeHtml(item.uid)}">
        <input type="text" name="name" class="edit-name" value="${escapeHtml(item.name)}" placeholder="Name" autofocus />
        <input type="text" name="category" class="edit-category" value="${escapeHtml(item.category || "")}" placeholder="Category" />
        <input type="number" name="price" class="edit-price" step="0.01" min="0" value="${item.price !== null ? item.price : ""}" placeholder="Price" />
        <button type="submit" class="icon-btn small primary" title="Save"><ha-icon icon="mdi:check"></ha-icon></button>
        <button type="button" class="icon-btn small" data-action="cancel-edit" title="Cancel"><ha-icon icon="mdi:close"></ha-icon></button>
      </form>
    </div>`;
  }

  _renderAddForm(categories) {
    return `<form class="add-form" data-form="add">
      <input type="text" name="name" class="add-name" placeholder="Add item…" autocomplete="off" required />
      <button type="button" class="icon-btn ${this._addExtraOpen ? "active" : ""}" data-action="toggle-add-extra" title="More options">
        <ha-icon icon="mdi:tune-variant"></ha-icon>
      </button>
      <button type="submit" class="icon-btn primary" title="Add">
        <ha-icon icon="mdi:plus"></ha-icon>
      </button>
      <div class="add-extra" ${this._addExtraOpen ? "" : "hidden"}>
        <input type="text" name="category" class="add-category" placeholder="Category" list="sc-categories" />
        <input type="number" name="price" class="add-price" step="0.01" min="0" placeholder="Price" />
      </div>
      <datalist id="sc-categories">
        ${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("")}
      </datalist>
    </form>`;
  }

  _styles() {
    return `<style>
      :host { display: block; }
      ha-card { padding: 0; overflow: hidden; }
      .header { padding: 16px 16px 8px; }
      .title-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .title { font-size: 1.2em; font-weight: 500; color: var(--primary-text-color); }
      .total-price { font-size: 1em; font-weight: 600; color: var(--primary-color); }
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
      .search-input, .edit-name, .edit-category, .edit-price, .add-name, .add-category, .add-price {
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
        display: flex; align-items: center; gap: 8px;
        padding: 6px 8px; border-radius: 8px;
      }
      .item:hover { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.04); }
      .item.completed .item-name { text-decoration: line-through; color: var(--secondary-text-color); }
      .checkbox { width: 20px; height: 20px; flex-shrink: 0; accent-color: var(--primary-color); cursor: pointer; }
      .item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary-text-color); }
      .chip { font-size: 0.75em; font-weight: 600; padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
      .price { font-size: 0.85em; font-weight: 600; color: var(--primary-text-color); flex-shrink: 0; }
      .edit-form { display: flex; align-items: center; gap: 6px; width: 100%; flex-wrap: wrap; }
      .edit-name { flex: 2; min-width: 100px; }
      .edit-category { flex: 1; min-width: 80px; }
      .edit-price { width: 80px; }
      .footer { padding: 4px 8px 8px; display: flex; justify-content: flex-end; }
      .text-btn {
        display: inline-flex; align-items: center; gap: 4px;
        background: none; border: none; cursor: pointer;
        color: var(--secondary-text-color); font-size: 0.85em; padding: 6px 8px; border-radius: 8px;
      }
      .text-btn:hover { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06); }
      .add-form { display: flex; align-items: center; gap: 4px; padding: 8px 16px 16px; flex-wrap: wrap; border-top: 1px solid var(--divider-color); margin-top: 4px; padding-top: 12px; }
      .add-name { flex: 1; min-width: 100px; }
      .add-extra { display: flex; gap: 6px; width: 100%; }
      .add-extra[hidden] { display: none; }
      .add-category { flex: 1; }
      .add-price { width: 90px; }
      code { background: rgba(var(--rgb-primary-text-color, 0,0,0), 0.06); padding: 1px 4px; border-radius: 4px; }
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
        this._addItem(name, category, price === "" ? null : price);
        form.reset();
        const extra = form.querySelector(".add-extra");
        if (extra) extra.hidden = true;
        this._addExtraOpen = false;
      } else if (form.dataset.form === "edit") {
        const uid = form.dataset.uid;
        const data = new FormData(form);
        const name = (data.get("name") || "").toString().trim();
        const category = (data.get("category") || "").toString().trim();
        const price = (data.get("price") || "").toString().trim();
        this._editingUid = null;
        this._renameItem(uid, name, category, price === "" ? null : price);
      }
    });

    root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this._editingUid) {
        this._editingUid = null;
        this._render();
      }
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
      row.style.display = !f || name.includes(f) || chip.includes(f) ? "" : "none";
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
      { name: "show_categories", selector: { boolean: {} } },
      { name: "show_prices", selector: { boolean: {} } },
      { name: "show_completed", selector: { boolean: {} } },
      { name: "show_progress", selector: { boolean: {} } },
      { name: "show_search", selector: { boolean: {} } },
      { name: "show_add", selector: { boolean: {} } },
    ];
  }

  _labels() {
    return {
      entity: "Shopping list entity",
      title: "Title",
      currency: "Currency symbol",
      sort: "Sort items by",
      group_by_category: "Group by category",
      show_categories: "Show category chips",
      show_prices: "Show prices",
      show_completed: "Show completed items",
      show_progress: "Show progress bar",
      show_search: "Show search",
      show_add: "Show quick-add form",
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
    "Editable shopping list card backed by a Home Assistant todo entity, with categories, prices, sorting and quick add/edit.",
  preview: true,
  documentationURL: "https://github.com/jan-tdy/ha-shopping-card",
});
