---
name: minimal-visual-style
description: Extend the starter Worker UI and screenshots without departing from its minimal, editorial, token-driven visual language.
---

# Minimal Visual Style

Inspect `src/tailwind-input.css`, `src/views/home.ts`, `specs/stub-worker/spec.md`, and `specs/readme-docs/spec.md`. Code is authoritative over `docs/screenshots/home.png`.

## Contract

- Keep a narrow, centered, single-purpose composition with generous outer space and one clear anchor.
- Continue the serif-first typography and `app-*` tokens unless the user requests a new identity.
- Use tight large headings, calm supporting text, and restrained uppercase labels.
- Limit the palette to quiet canvas, surface, text, soft text, line, and one accent.
- Keep inputs and links soft and precise: rounded corners, subtle tint, thin rings, and a clear focus state.
- Render routes and capabilities as editorial rows rather than dense cards or dashboards.
- Keep status text quiet and inline.

Avoid gradient-heavy heroes, glossy marketing sections, busy app shells, multiple accents, and decorative illustration without an explicit new direction. Update screenshots after source behavior and styling are verified; never use a stale screenshot to justify a regression.
