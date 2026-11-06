# ADR-045: Adopt Type-Aware Fallow Diagnostics

**Status:** Implemented

**Date:** 2026-07-30

**Amends:** [ADR-033](./ADR-033-add-advisory-fallow-diagnostics.md)

## Context

ADR-033 adopted Fallow 2.x as a pinned, advisory readability tool. Fallow 3.10 makes its bounded TypeScript semantic pass a stable optional contract and packages an exact-version companion with npm installs. The semantic pass can refine existing dead-code candidates with exact symbol identity and report public-signature type coupling without taking ownership of compiler diagnostics or general typed linting.

Fallow 3.x also provides a self-contained interactive codebase map. The template already ignores `.fallow/`, making that directory a suitable explicit target for the disposable report.

## Decision

Pin Fallow 3.10.0 and run the existing readability and health diagnostics with `--type-aware --type-aware-require best-effort`. Add `--type-coupling` to the health report.

Expose `npm run diagnostics:map` as an opt-in command that writes `.fallow/codebase-map.html` without opening a browser. Keep the map and all Fallow caches ignored under `.fallow/`.

Ignore the `typescript-7` dependency alias in Fallow because the repository invokes that compiler through an explicit `node_modules` script path, which Fallow intentionally excludes from project entry-point analysis.

Type-aware Fallow remains advisory. `npm run typecheck` owns TypeScript compiler correctness, and Oxlint owns local lint findings. An incomplete semantic pass conservatively retains findings instead of failing the diagnostic workflow.

## Trigger

The user asked to upgrade Fallow to its latest release and adopt its new features.

## Consequences

**Positive:**

- Dead-code findings gain exact-symbol and TypeScript contract evidence.
- Health diagnostics expose advisory public-signature coupling.
- Contributors can inspect dead code, duplication, boundaries, and complexity in one local interactive map.

**Negative:**

- npm installs an optional exact-version semantic companion and its pinned TypeScript runtime.
- Type-aware diagnostics take longer than Fallow's syntactic-only defaults.

**Neutral:**

- Fallow remains outside the hard quality gate and local CI.
- The generated map is disposable ignored state, not a committed artifact.

## Alternatives Considered

### Upgrade Without Enabling Type-Aware Analysis

This would reduce diagnostic runtime but leave the release's main stable capability unused and preserve avoidable name-based uncertainty in dead-code evidence.

### Require Complete Semantic Analysis

This was rejected because the diagnostics are advisory and Fallow intentionally abstains for dynamic or incomplete code patterns. Best-effort mode keeps those findings visible without turning semantic coverage gaps into workflow failures.

### Add The Interactive Map To `diagnostics:codebase`

This was rejected because routine text diagnostics should not write a report artifact. Map generation remains an explicit contributor action.
