# Changelog

## v0.2.0

- Drag-and-drop manual reordering of items (uses the entity's native move support).
- Item notes/description, stored on the todo item's native `description` field.
- Configurable, ordered `categories` list — fixes the group display order and seeds
  category suggestions, on top of categories already used on items.
- Both new features gracefully hide themselves if the underlying `todo` entity doesn't
  support them (checked via its `supported_features`).

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

- Category/price are stored as plain-text tags inside the item name, not as separate fields on
  the `todo` entity (Home Assistant's `todo` integration has no such fields).
