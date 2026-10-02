# Card Detail — Approved Focus Lens and Canvas Drill-In

**Status:** Approved for development

**Approved:** 2026-09-02

**Grid action approved:** 2026-09-03

**Direction:** Focus Lens by default, with Canvas Drill-In on demand

## Experience contract

The thought cards remain the main content of the library. Selecting one does not permanently divide the application into three columns. It opens a card-shaped focus surface above the dimmed grid, preserving enough context to make closing feel like returning rather than navigating away.

## Card-grid archive action

- Allow archive directly from the grid where multiple cards are visible; opening Focus Lens is not required.
- Keep the control quiet until the card is hovered or receives keyboard focus, then reveal it in a consistent corner without covering the thought or its tags.
- Treat Open and Archive as distinct accessible actions. The entire card must not contain an invalid nested button structure.
- Remove the card from the active grid only after the local archive write succeeds, then provide a brief Undo action.
- If the write fails, leave the card in place, preserve focus, and show an actionable error.
- In the Archive grid, the same control and position becomes Restore.
- After a card leaves, focus the card that moves into its index, otherwise the previous card, otherwise the grid's empty-state heading. Undo restores focus to the returned card.
- Bulk selection and bulk archive are outside this slice.

## Focus Lens

- Open the selected card in a centered card-shaped overlay above the dimmed thought grid.
- Show the full thought or checklist, tags, essential metadata, archive action, close action, and an obvious Expand control.
- Keep the left navigation and the prior grid position visible as context without allowing background interactions through the overlay.
- Support keyboard entry, traversal, editing, and dismissal. `Escape` closes the topmost layer unless a nested control owns it first.
- Keep long content inside the active display bounds and scroll within the focus surface only after those bounds are reached.

## Canvas Drill-In

- Expand the same selected card into the available content canvas. Do not open a second card or replace the left navigation.
- Carry the current editing state, focus target, tags, checklist state, and any future attachment selection into the expanded view.
- Use the extra space for long thoughts, checklist editing, metadata, and future attachment previews without adding a permanent inspector.

## Return contract

- Close from Focus Lens, or Back from Canvas Drill-In, returns to the exact prior filter, search query, scroll position, selected card, and keyboard focus.
- Archiving the selected card returns to the correct remaining grid state rather than an empty or reset library.
- Browser history or native window navigation must not create duplicate detail layers.

## Surface constraints

- The library has two persistent regions: left navigation and the card canvas.
- Do not reintroduce a permanent right-side inspector for card details.
- Follow the existing warm-black palette, Fragment Mono typography, fine borders, 10 pt card radius, and restrained 120–180 ms functional motion.
- Preserve local-first writes. The detail presentation never changes the persistence contract.

## Implementation slice

`BC-012` owns removal of the permanent inspector, Focus Lens, Canvas Drill-In, return-state restoration, accessibility, and focused regression coverage. The approved direct grid action is a follow-on slice owned by `BC-016` so the shipped BC-012 completion record remains accurate.
