---
name: architecture-review
description: Decide whether a growing capability can expand safely or first needs clearer ownership, state authority, seams, or dependency direction.
---

# Architecture Review

Treat structural metrics as evidence, not architecture.

## Establish the contract

Read `AGENTS.md`, `ARCHITECTURE.md`, the relevant feature spec, ADRs, and source. Name the capability, source owner or owners, composition root, persistent-state authority, public contracts, dependents, and permitted dependency direction. A deliberately distributed workflow may have several owners joined by one integration contract.

If durable repository context cannot identify those responsibilities, make that the primary finding.

## Collect evidence

1. Read `.architecture-check.json` and run `npm run quality:structure` for configured source-shape limits.
2. Run `npm run diagnostics:health` for coupling, churn, and hotspot evidence.
3. Run `npm run diagnostics:map` only when topology remains unclear and the ignored map will materially help.
4. Inspect for mixed authorities or lifecycles that metrics cannot prove.

## Decide

Return one disposition:

- **Proceed:** ownership and dependency direction remain clear.
- **Consolidate first:** mixed authority, coupling, or hotspot growth makes the next change harder to place.
- **Decision required:** credible boundary alternatives would change a lasting constraint; propose an ADR before implementation.

For each finding, cite the capability and source locations, explain future change cost, and propose the smallest coherent correction. Never recommend layers, directories, or file splits solely to satisfy a metric. Record implemented lasting outcomes in `ARCHITECTURE.md`, an ADR, or the relevant feature spec.
