# ha-shopping-card

An editable Home Assistant Lovelace shopping list card, backed by a `todo` entity
(e.g. the built-in `todo.shopping_list`). Check items off, add/edit/delete them, organize
by category, track prices, and see your progress — all from the card.

## Features

- **Check off / add / rename / delete** items inline, no dialogs.
- **Categories** — group items by category, collapse/expand each group, per-category subtotal.
- **Prices** — per-item price, running total of everything still to buy.
- **Sorting** — manual (backend order), alphabetical, or by price.
- **Progress bar** — completed vs. total items.
- **Search** — filter the list as you type.
- **Clear completed** — one click to remove everything checked off.
- **Visual editor** — configure entirely through the GUI card editor, no YAML needed.

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
show_categories: true
show_prices: true
show_completed: true
show_progress: true
show_search: true
show_add: true
```

| Option               | Default            | Description                                      |
| -------------------- | ------------------ | ------------------------------------------------- |
| `entity`              | *(required)*        | A `todo.*` entity, e.g. your shopping list.        |
| `title`               | `Shopping List`      | Card title.                                        |
| `currency`            | `€`                 | Symbol appended to prices.                         |
| `sort`                | `manual`             | `manual`, `alpha`, or `price`.                     |
| `group_by_category`   | `true`               | Group items under category headers.                |
| `show_categories`     | `true`               | Show the category chip on each item.               |
| `show_prices`         | `true`               | Show prices and totals.                            |
| `show_completed`      | `true`               | Show items already checked off.                    |
| `show_progress`       | `true`               | Show the completed/total progress bar.             |
| `show_search`         | `true`               | Show the search toggle.                            |
| `show_add`            | `true`               | Show the quick-add form.                           |

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

## Requirements

- Home Assistant 2023.11 or newer (for the `todo` entity platform).

## License

MIT
