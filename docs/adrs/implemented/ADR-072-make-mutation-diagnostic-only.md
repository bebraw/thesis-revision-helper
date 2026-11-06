# ADR-072: Make Mutation Testing Diagnostic Only

**Status:** Implemented

**Date:** 2026-11-06

**Supersedes:** [ADR-030](./ADR-030-reserve-full-mutation-ci-for-github.md), [ADR-040](./ADR-040-use-full-stryker-concurrency-in-ci.md), [ADR-043](./ADR-043-make-local-mutation-opt-in.md)

**Amends:** [ADR-022](./ADR-022-add-mutation-testing-gate.md), [ADR-039](./ADR-039-skip-expensive-ci-for-non-runtime-changes.md)

## Context

The project's GitHub workflow ran full mutation testing for runtime-related changes. As the application grew, that job ran substantially longer than the other checks and used resources after the fast and browser jobs had completed. The user asked to disable mutation testing as a quality gate for this project for now.

## Decision

Remove the GitHub mutation job and the local deep quality gate. Retain `npm run mutation` and `npm run mutation:incremental` as explicitly invoked diagnostics, with their existing Stryker configuration, thresholds, and report locations. No standard or optional quality-gate command runs mutation testing automatically.

Keep the fast and browser CI jobs, the browser job's non-runtime change classification, and the existing local readiness and Local CI requirements.

## Consequences

**Positive:**

- Routine CI and quality-gate runs no longer spend resources on mutation testing.
- Contributors can still request full or incremental mutation feedback when useful.

**Negative:**

- CI no longer provides a clean full mutation signal, so weak assertions may go undetected unless mutation testing is run deliberately.

**Neutral:**

- Existing unit coverage, browser tests, and other baseline checks remain in place.
- Historical template update packs remain available and do not represent this project's current policy.

## Alternatives Considered

### Keep the GitHub Mutation Job

This retains automatic assertion-strength feedback, but continues spending resources on a long-running job the user asked to disable.

### Remove Stryker Entirely

Removing its dependencies and configuration would discard a useful opt-in diagnostic and expand the change beyond disabling the gate.
