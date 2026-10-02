# Top Tag Rail and Unified Tag Search

**Status:** Approved for development

**Approved:** 2026-09-03

**Direction:** Minimal single-line tag rail below search

## Experience contract

The card canvas keeps search as its primary retrieval control, then exposes the tags a person is most likely to need in one quiet row. The rail makes common filters one action away without turning the top of the library into a tag-management surface.

```text
[ Search your cache…                              ⌘K ]
 All   #work   #ideas   #todo   #personal   More…
```

## Rail behavior

- Place the rail directly below search and above the results announcement and card grid.
- Show **All**, up to eight recently used canonical tags, and **More…**.
- Order recent tags by the newest non-archived thought carrying each tag, then by canonical name for ties. Do not reorder the rail as search results change, and keep the active tag visible even when it falls outside that set.
- Use one active tag at a time. Activating another tag replaces the current tag; activating **All** or the selected tag clears it.
- Keep the current text query when the tag changes so a person can search within one tag.
- Reuse the canonical tag's dot, border, and low-opacity tint while always displaying the text label.

## Search and overflow

- Typing a `#fragment` at the start of the query or immediately after whitespace opens case-insensitive suggestions for existing canonical tags. Do not trigger inside text such as `C#`.
- Only selecting a suggestion creates the structured tag filter. Remove that active fragment from the body query while preserving all other query text. Unknown or unselected hashtags remain ordinary searchable text, so normal thought search is never reinterpreted unexpectedly.
- After selection, show the chosen tag as the one active filter and focus its selected rail control. Selecting another suggestion replaces the active tag; other hashtag fragments remain searchable text until selected.
- **More…** opens the existing searchable tag picker and places keyboard focus in its search field. Applying a tag focuses its selected rail control; dismissing without a selection returns focus to **More…**.
- On narrow windows, keep one row and scroll it horizontally. Do not wrap tags or grow the top region vertically.
- If the cache has no tags, omit the empty rail and retain the compact existing tag entry point.

## Return and accessibility contract

- Preserve the query, active tag, selected card, grid scroll position, and keyboard focus through Focus Lens and Canvas Drill-In.
- Treat the rail as a single-selection control with a programmatically exposed selected state.
- Support `Tab` entry, arrow-key movement within the rail, and `Enter` or `Space` activation. Keep a visible focus treatment on every tag and **More…**.
- Announce result-count changes without moving focus or requiring the rail to be rediscovered.

## Surface constraints

- Keep the rail visually subordinate to search and the cards. It is one compact retrieval row, not a toolbar or taxonomy dashboard.
- Do not introduce multi-tag Boolean controls, pinning, manual ordering, or required tagging in this slice.
- Preserve local-first behavior. Filtering must not require a network request or delay capture.

## Implementation slice

`BC-015` owns the rail, deterministic recent ordering, single-tag selection, `#` suggestions, picker handoff, overflow, return-state preservation, accessibility, and focused regression coverage.
