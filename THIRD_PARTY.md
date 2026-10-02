# Dependencies and assets

Brain Cache's own code is covered by the [MIT License](LICENSE). Dependencies and any separately licensed materials retain their upstream terms; the project license does not replace them.

## Dependency inventory

The [dependency license inventory](docs/release/dependency-licenses.csv) records package names, exact installed versions, declared licenses, and top-level license/notice filenames observed on 2026-09-29 and updated on 2026-09-30 for the release-preparation branch based on `41459ec`. The JavaScript graph is unchanged; the only external Rust version change is Tauri `2.11.5` to `2.11.6`, whose declared license and top-level license files were rechecked:

- 61 JavaScript production packages, including their transitive and required peer dependencies. Their declarations are MIT or a choice of MIT and Apache-2.0.
- 280 external Rust packages in the resolved `aarch64-apple-darwin` graph, including build dependencies. Their declarations include MIT, Apache-2.0, BSD, Unicode, Zlib, and MPL-2.0, with some alternative or combined terms.

All inventoried packages declare a license. These declarations are metadata, not a complete audit of bundled third-party source. The inventory includes build tools that may not be redistributed and is not a determination that every listed package is present in the executable. JavaScript development tools, other target architectures, and dependencies on other branches require a separate inventory if they are distributed.

## Before distributing a Mac app

Prepare a notice bundle from the actual release dependency graph. Include required upstream copyright notices, license texts, and applicable NOTICE files in the distributed artifact. Review combined expressions such as `AND` rather than treating them as a choice of licenses.

Five Rust packages in the assessed graph declare MPL-2.0: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`, and `selectors`. Determine which are included in the shipped artifact and provide the required source-availability information for the covered code. Mozilla describes these obligations in its [MPL FAQ, questions 8–10](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

The CSV is an inventory, **not the finished notice bundle**. Some crates do not package a top-level license file, so the release process must collect their applicable notices from source headers or the matching upstream release. Recheck vendored native components, including SQLite, and include the root project license in the final app distribution.

## Assets

| Material | Evidence and status |
| --- | --- |
| Blob icon: `apps/mac/src-tauri/icons/icon.svg`, PNG sizes, and `.icns` | Created as SVG code by Codex for this project; the SVG and rendered icon assets were verified against the original implementation record. Creation-record evidence and limits are in the [asset review](docs/release/asset-provenance.md). |
| `docs/design/compact-capture-directions.png` | New text-only generation on October 1, 2026, with entirely fictional notes and no screenshot references. Replaces the private screenshot-derived board; see the [asset review](docs/release/asset-provenance.md). |
| `docs/examples/plant-study.png` | New text-only generated illustration of invented plants for synthetic attachment demonstrations. See [examples](docs/examples/README.md) and the [asset review](docs/release/asset-provenance.md). |
| `docs/screenshots/*.png` | Captured from the project's browser preview using synthetic notes for the README. They do not demonstrate native persistence or installer acceptance. |
| `docs/screenshots/quick-capture-demo.gif` | A short product trailer using recorded browser-preview interactions, fictional notes and checklists, project-created title cards, and edited pacing. Includes a still-image alternative in the README; see the [asset review](docs/release/asset-provenance.md). |
| `docs/screenshots/search-and-tags.gif`, `pinning.gif`, and `checklist-activity.gif` | Recorded browser-preview feature examples with fictional notes, project-created labels, and still-image alternatives. Current screenshots and media hashes are documented in the [asset review](docs/release/asset-provenance.md). |
| Fonts | No font binaries were found in the assessed tracked files or reachable history. Mac CSS requests Fragment Mono only through `local(...)`, then falls back to installed system fonts. Bundling a font later requires its redistribution license and notices. |

Record the source and reuse terms when adding artwork, fonts, copied code, or other externally sourced material. Keep real thoughts, personal attachments, and credentials out of screenshots and examples.
