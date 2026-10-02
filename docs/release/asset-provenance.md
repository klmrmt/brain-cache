# Project asset provenance

Reviewed October 1, 2026 for the source-only Mac preview. This records observed creation evidence and its limits; it does not establish exclusive copyright or clear undisclosed third-party inputs.

## Blob app icon

The original Codex implementation record contains the file-add operation for `apps/mac/src-tauri/icons/icon.svg`, a 21-line vector drawing of shapes and gradients. The recorded source agrees with the checked-in SVG. It has no external image links, embedded font data, attribution, or separate license notice. The rendered PNG/ICNS assets entered the project alongside the SVG. No downloaded third-party icon was identified in the reviewed creation record.

SVG SHA-256: `ffa362176b4d0490a2c4527b3121b45a0926c936360491f8f3411b89dbc475ba`.

## Fictional capture concept board

At the maintainer's request, the old screenshot-derived board was replaced on October 1, 2026. The replacement at `docs/design/compact-capture-directions.png` was created with the built-in image-generation tool from a new text-only prompt. No reference images or earlier screenshots were supplied. Its notes are entirely fictional: “Read a chapter”, “Plan a weekend walk”, and “Water the plants”. The image labels itself as concept illustrations rather than app screenshots. The written design contract remains authoritative.

PNG SHA-256: `5081556d4f97436a23566460ebf7ac0200e5a8c602b019dee04e0907e678468e`.

Replacing this file does not remove its predecessor from the private repository's historical commits. Public publication must use the reviewed source snapshot in a fresh repository; do not expose the private history. See the [publication procedure](public-source.md).

## Example plant attachment

`docs/examples/plant-study.png` was generated on October 1, 2026 using the built-in image tool and a text-only prompt for five invented potted plants. No input image, person, location, screenshot, or real note was supplied. It is an example attachment, not an app screenshot.

PNG SHA-256: `4585ec2e206af6d0eb3f0f26012ab95dadcf1ea8acde7aa04efe4df563142e5e`.

Both PNGs retain generated C2PA provenance. A metadata review found no user identity, reference path, sensitive prompt field, or credential. The plant image includes certificate-authority contact metadata, not a user email. Signature and trust-chain validation were not performed.

Both final prompts are preserved in [synthetic image prompts](synthetic-image-prompts.md). The generated outputs were visually reviewed before being copied into the project.

## Product trailer GIF

`docs/screenshots/quick-capture-demo.gif` combines real browser-preview recordings made on October 1, 2026 in two isolated recording sessions that began with empty preview stores. All thoughts, tags, and checklist items were created as fictional demonstration data. The trailer shows typing “Read a chapter after dinner.”, an actual `⌘ Return` save, a sample library, search, and a checklist item being checked. Preview persistence was verified by reloading; no real user database, attachments, clipboard content, desktop, or browser chrome was recorded.

The 15.02-second loop has 31 encoded frames, with project-created title cards, edited pacing, a neutral dark backdrop, magnified capture, and 160 ms transitions. The interface itself was recorded from the project. All source shots and final frames were visually reviewed; GIF metadata contains only format, background, duration, and looping information, with no comment field. These browser-preview scenes use local storage and do not verify the Mac-wide shortcut, native SQLite persistence, or offline native acceptance. The README retains written steps and a still-image alternative.

GIF SHA-256: `506bb2451a551339429163f7f874bc6866a2665407e7d68b615c1caeb3653017`.

## Feature-tour screenshots and GIFs

On October 1, 2026, a fresh browser-preview store was used to record search, pins, rich-text editing, checklist completion, Activity, and light appearance. The preview ran from preparation revision `847150f`; no application code changed for these examples. Four fictional notes were created through the interface, including “Read a chapter after dinner.” and a checklist for a weekend walk. Text/tag search, clearing search, pinning, editing, and completion were exercised through the actual controls. Reload checks confirmed the recorded preview data persisted. The editor still demonstrates heading/list formatting; the plant visible on a card is a retained example attachment. A second full-size image import exceeded browser-preview storage quota and was removed through the interface during recovery. This recording does not claim a successful inline-image import.

The library hero and note-editor screenshot were refreshed from this session. Three short GIFs combine the recorded states with project-created labels and edited pacing; the underlying interface screenshots are unchanged. Every decoded GIF frame was compared with its intended indexed image. All final media were visually reviewed, and PNG/GIF metadata was checked for personal information and credentials. No real thoughts, user database, desktop, browser chrome, or clipboard content were used. These scenes verify preview interactions only; they do not add native acceptance evidence. Each GIF has a still-image alternative in the README.

| Asset in `docs/screenshots` | Dimensions | SHA-256 |
| --- | --- | --- |
| `search-and-tags.gif` | 1100 × 784 | `d834624d51780db3e71a8eda24f3db149f9e7e496b06da07fab89d1f080bf453` |
| `pinning.gif` | 1100 × 784 | `8c509a4d86af2766ee70f01838027e5ed2ead75793867461b1fceb95c349e1b1` |
| `checklist-activity.gif` | 1100 × 784 | `32a5ea6f565e8e5966e9074e8d18b5176270266805fe79ebe92fb66f63f5c190` |
| `library.png` | 1100 × 700 | `4e1d3df11c89a909228f2de0d2ab6f615249b5d2d1f2768b84df14bdb05882a0` |
| `note-editor.png` | 1100 × 700 | `a9b21a16a2b353b75e3e236b27daf24f13d1aed8902508a3011969eda40f7198` |
| `feature-search.png` | 1100 × 700 | `6e90bb45070fce9d65950d0b8390cbd965dc98f140cc4a761befff98557fc540` |
| `feature-pins.png` | 1100 × 700 | `2eccb0bbe7a2ce554a7cfdac1c4fa010ae0133345102d51f53e3b44476864552` |
| `activity-garden.png` | 1100 × 700 | `312f8fa266d38dad664bb85c1db250e2c30a80116bee6a031b734be69c443bac` |
| `appearance-light.png` | 1100 × 700 | `18700b68464d31060997975b281497e6212585254f93ed5f2cd58cf4f5121633` |

## Reuse terms and review limits

The project's [MIT license](../../LICENSE) covers its own contributed material. OpenAI's [Terms of Use, Content](https://openai.com/policies/terms-of-use/#content) assign OpenAI's interest in generated output to the service user to the extent permitted by law; input rights and third-party rights still apply. Generated output may not be unique. This provenance record is evidence of project creation, not a promise of exclusive ownership or a complete legal clearance.

The README screenshots were captured from the browser preview with synthetic notes and visually rechecked on October 1. No font binaries are included in the assessed source. Dependency license and later packaged-app notice requirements remain in [THIRD_PARTY.md](../../THIRD_PARTY.md).
