# Changelog

## v0.1.0 - Initial release

- Editable Lovelace card backed by a Home Assistant `todo` entity (e.g. the built-in shopping list).
- Check off / add / rename / delete items directly from the card.
- Categories and prices, encoded inline in the item text (`Milk #Dairy 1.50€`) so items stay
  readable and editable from any other todo UI.
- Group items by category, with per-category subtotal and collapse/expand.
- Sort items manually, alphabetically, or by price.
- Progress bar (completed vs. total) and running total of open items' prices.
- Quick-add form with optional category/price fields, and inline item search.
- "Clear completed" action.
- Visual GUI card editor (entity picker + all display options), no YAML required.

### Known limitations

- Drag-and-drop manual reordering is not implemented yet; "Manual" sort reflects the entity's
  current backend order.
- Category/price are stored as plain-text tags inside the item name, not as separate fields on
  the `todo` entity (Home Assistant's `todo` integration has no such fields).
