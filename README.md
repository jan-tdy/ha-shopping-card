# ha-shopping-card

An editable Home Assistant Lovelace shopping list card, backed by a `todo` entity
(e.g. the built-in `todo.shopping_list`). Check items off, add/edit/delete them, organize
by category, track prices, and see your progress — all from the card.

## Features

- **Check off / add / rename / delete** items inline, no dialogs.
- **Categories** — group items by category, collapse/expand each group, per-category subtotal.
  Define your own ordered category list in the config, or just let it pick up whatever
  categories you use on items.
- **Prices** — per-item price, running total of everything still to buy.
- **Notes** — an optional note/description per item (e.g. "get the ripe ones").
- **Drag to reorder** — manual sort supports dragging items into the order you actually
  shop in (e.g. by store aisle).
- **Sorting** — manual (drag-orderable), alphabetical, or by price.
- **Quantity** — type `2x Milk` or `Milk x2`, or use the Qty field; totals and sorting use
  quantity × unit price.
- **Category & price suggestions** — a built-in dictionary suggests a category as you type
  (e.g. "Milk" → Dairy); once you've set a category or price for an item, the card remembers
  it and suggests it again next time.
- **Dual totals** — an estimated total (everything on the list) and a cart total (only items
  checked off), so you can track spending in real time.
- **Shopping mode** — a fullscreen-style toggle for one-handed use while pushing a cart: hides
  search/sort controls and completed items, and removes edit/delete/drag controls to prevent
  accidental taps.
- **Progress bar** — completed vs. total items.
- **Search** — filter the list as you type.
- **Clear completed** — one click to remove everything checked off.
- **Visual editor** — configure entirely through the GUI card editor, no YAML needed.
- **Superscan mode (v2.0.0-beta0, beta)** — scan barcodes with the camera instead of checking
  items off by hand. See [Superscan mode](#superscan-mode-beta) below.

Notes and drag-reordering only appear when the underlying `todo` entity supports them
(most integrations, including the built-in shopping list, do).

## Installation

### HACS (recommended)

1. In HACS, add this repository as a custom repository (category: *Dashboard*).
2. Install **Shopping List Card**.
3. Add the Lovelace resource (HACS does this automatically for HACS-managed installs).

### Manual

1. Copy `shopping-card.js` to `<config>/www/shopping-card.js`.
2. Add it as a Lovelace resource:
   ```yaml
   resources:
     - url: /local/shopping-card.js
       type: module
   ```

## Usage

Add the card via the dashboard UI ("Shopping List Card" in the picker) or with YAML:

```yaml
type: custom:shopping-card
entity: todo.shopping_list
title: Shopping List
currency: "€"
sort: manual # manual | alpha | price
group_by_category: true
categories:
  - Dairy
  - Produce
  - Bakery
show_categories: true
show_prices: true
show_completed: true
show_progress: true
show_search: true
show_add: true
show_shopping_mode_button: true
nav_button_label: "Fridge"
nav_button_icon: mdi:fridge-outline
nav_button_path: /lovelace/fridge
```

| Option               | Default            | Description                                      |
| -------------------- | ------------------ | ------------------------------------------------- |
| `entity`              | *(required)*        | A `todo.*` entity, e.g. your shopping list.        |
| `title`               | `Shopping List`      | Card title.                                        |
| `currency`            | `€`                 | Symbol appended to prices.                         |
| `sort`                | `manual`             | `manual`, `alpha`, or `price`. Only `manual` supports drag-to-reorder. |
| `group_by_category`   | `true`               | Group items under category headers.                |
| `categories`          | `[]`                 | Predefined, ordered list of categories. Fixes group order and seeds suggestions; other categories used on items still show up, sorted alphabetically after these. |
| `show_categories`     | `true`               | Show the category chip on each item.               |
| `show_prices`         | `true`               | Show prices and totals.                            |
| `show_completed`      | `true`               | Show items already checked off.                    |
| `show_progress`       | `true`               | Show the completed/total progress bar.             |
| `show_search`         | `true`               | Show the search toggle.                            |
| `show_add`            | `true`               | Show the quick-add form.                           |
| `show_shopping_mode_button` | `true`         | Show the fullscreen-style "Shopping mode" toggle.  |
| `nav_button_label`    | `""`                 | Tooltip for an optional extra toolbar button.      |
| `nav_button_icon`     | `mdi:fridge-outline` | Icon for the extra button.                         |
| `nav_button_path`     | `""`                 | Dashboard path the extra button navigates to. Button is hidden unless this is set. |
| `mode`                | `normal`             | `normal` or `superscan` (barcode scanning, beta). See below. |
| `mercadona_postal_code` | `""`               | Superscan: your postal code, used to guess the Mercadona price zone. Best-effort only. |
| `mercadona_warehouse` | `""`                 | Superscan: manual Mercadona warehouse code override. See below. |

Sort mode and grouping can also be toggled live from the card's header — that choice is
remembered per entity in your browser.

### Categories and prices

Home Assistant's `todo` entities don't have separate category/price fields, so this card
encodes them directly in the item's name using simple tags:

```
Milk #Dairy 1.50€
```

- `#CategoryName` sets the category (use `_` for spaces, e.g. `#Personal_care`).
- A number next to the currency symbol (either order, e.g. `1.50€` or `€1.50`) sets the price.

Both tags are optional and can be added either by typing them directly, or through the
category/price fields in the quick-add and edit forms — the card builds and parses the tags
for you, and the item still reads fine as plain text anywhere else (mobile app, voice
assistant, etc.).

### Notes and reordering

Unlike category/price, an item's note uses the `todo` entity's own `description` field, and
reordering uses its own move support — both are only shown if the entity reports it supports
them (`supported_features`). The built-in Home Assistant shopping list supports both.

To reorder, switch sort to **Manual** and drag an item by its handle. When grouped by
category, you can only reorder within the same category group; turn grouping off for free
reordering across the whole list.

### Quantity

Add `x2` (or `2x`) anywhere in an item's name — "Milk x2" or "2x Milk" both work — or use the
Qty field in the add/edit forms. The line price shown, the running totals, and "sort by price"
all use quantity × unit price.

### Category and price suggestions

As you type an item's name in the quick-add field, the card suggests a category from:

1. What you've manually set for that exact name before (remembered per browser), then
2. A small built-in dictionary of common groceries (English and Slovak names).

The suggestion fills in the category field automatically — edit it yourself at any point to
override it for that item. The last price you entered for a name is similarly remembered and
shown as a placeholder (e.g. "~1.50€") in the price field, as a reminder rather than a
committed value.

### Shopping mode

Toggle the fullscreen icon in the header to switch into a focused, one-handed layout: search,
sort/group controls and completed items are hidden, and item rows drop their edit/delete
buttons and drag handles so you don't accidentally change the list while pushing a cart.
Checking items off still works as normal. The toggle state is remembered per entity.

### Superscan mode (beta)

Set `mode: superscan` to switch from checking items off by hand to scanning their barcode
with the camera. Tap the barcode icon in the header to open the scanner; point the camera at
a product's barcode and hold it steady.

- **On the list** — if the scanned product's name matches an item still on the list, that item
  is checked off automatically (and its price filled in, if it didn't have one yet).
- **Not on the list** — otherwise it's logged once as an "off-list" purchase for the current
  session (shown under the list, removable if scanned by mistake) and counted into the
  "already bought" total, without being added to the list itself.
- **Unknown barcode** — if the card has never seen the code before and can't look it up, you
  get a small manual form (name/price/category) instead — fill it in once and the card
  remembers that barcode for next time, the same way it already remembers categories and
  prices.

Prices and barcode lookups come **only from Mercadona (Spain)** for now, through their
unofficial, reverse-engineered search API — not a public/supported API. This is inherently
best-effort:

- Mercadona's `robots.txt` disallows `/api` for crawlers, and prices/catalog are zoned per
  delivery warehouse. This card calls it in low volume, for personal/home use, and always
  falls back to manual entry — but it can stop working at any time if Mercadona changes or
  blocks it, with no warning.
- Set `mercadona_postal_code` so the card can *guess* your warehouse; only a handful of
  postal-code prefixes are known, so this will often fail to resolve anything on its own.
- If it does, or if you want to be sure, set `mercadona_warehouse` directly: open
  `tienda.mercadona.es`, search for any product with your browser's DevTools Network tab open,
  find the request to `*.algolia.net/1/indexes/products_prod_<code>_es/query`, and use that
  `<code>` (e.g. `mad1`, `bcn1`, `vlc1`).
- Once a barcode is matched once (live or typed in manually), it's remembered locally forever
  and never needs a network lookup again.

Barcode decoding uses the browser's built-in `BarcodeDetector` API (Chrome/Edge, including on
Android) where available, and lazy-loads [ZXing](https://github.com/zxing-js/library) from a
CDN as a fallback otherwise (e.g. iOS Safari) — only when the scanner is actually opened.
Camera access requires a secure context (HTTPS, or `localhost`).

## Requirements

- Home Assistant 2023.11 or newer (for the `todo` entity platform).
- For notes and drag-to-reorder: a `todo` entity that supports description/move (the built-in
  shopping list does).

## License

MIT
