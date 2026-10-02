# Shortcut Hints — Approved Minimal Direction C

**Status:** Approved for development

**Approved:** 2026-09-02

**Direction:** C — minimal on-demand shortcut drawer

## Experience contract

Shortcut help stays available without turning the one-line Pet Dock into a toolbar. The resting capture surface remains visually almost unchanged. One quiet `⌘` glyph reveals the highest-value commands inside the same rounded surface only when requested.

## Resting state

- Place one small borderless `⌘` glyph between the thought field and save affordance.
- Keep it visually quiet at rest and strengthen its contrast on hover or keyboard focus.
- Give it an accessible name such as “Keyboard shortcuts” and a visible focus treatment.
- Do not add hint text, a teaching strip, or extra vertical height to the resting Pet Dock.

## Open state

- Activating the glyph expands the existing rounded Pet Dock downward. Never create a detached secondary popover or black rectangle.
- Show a compact two-column drawer for the highest-value commands:

| Action | Shortcut |
| --- | --- |
| Numbered list | `⌘⇧7` |
| Bulleted list | `⌘⇧8` |
| Checklist | `⌘⇧9` |
| Add tags | `⌘T` |
| Attach image | `⌘⇧A` |
| Open shortcut drawer | `⌘?` |

- Treat `⌘⇧A` as the approved attachment mapping, but do not show or activate it until the attachment capability reaches Shipped status.
- Keep `⌘ Return` visible on the save affordance rather than repeating it in the drawer.
- Close returns the dock to the smallest height allowed by its current text and any other open optional control.

## Hiding and recovery

- Offer a quiet “Hide the `⌘` button” action inside the drawer.
- Persist that preference locally. Hiding the button never disables any shortcut.
- `⌘?` always opens the drawer, even when the glyph is hidden.
- **View → Show Shortcut Button** restores the glyph without resetting other preferences.

## List behavior

- `⌘⇧7` toggles numbered-list formatting for the current or selected lines.
- `⌘⇧8` toggles bulleted-list formatting for the current or selected lines.
- `⌘⇧9` enters or toggles the structured checklist mode owned by `BC-003`.
- `Return` continues the current list. `Return` on an empty item exits it.
- Initial list support does not include nesting, subtasks, or a persistent formatting toolbar.

## Implementation slice

`BC-013` owns the list shortcuts, minimal drawer, hidden-button preference, recovery commands, native menu exposure, accessibility, and focused tests. It depends on the Pet Dock and checklist contracts rather than redefining either one.

`BC-014` owns attachment storage and behavior. BC-013 reserves its shortcut but must not expose an unavailable attachment action.
