# Feature: Architecture Feedback

## Blueprint

### Context

Rapid feature delivery can preserve behavior while source ownership and navigability deteriorate. The template needs early, lightweight feedback for extreme source growth and a review workflow that evaluates capability boundaries without prescribing unused scaffolding.

### Architecture

- **Capability source root:** distributed integration; Quality Gate owns `scripts/check-source-shape.mjs` and `.architecture-check.json`, while Agent Skill Baseline owns `.codex/skills/architecture-review/`
- **Composition root:** `package.json#scripts.quality:gate:fast` and `scripts/run-affected-guardrails.mjs` for deterministic enforcement, plus `AGENTS.md#architecture-review` for interpretive routing
- **State authority:** `.architecture-check.json` for source-shape policy, `specs/quality-gate/spec.md` for deterministic behavior, and `specs/agent-skills/spec.md` for review-skill behavior
- **Public contracts:** `npm run quality:structure`, the Architecture Review dispositions, and the ownership fields in `specs/feature-template/spec.md`
- **Dependency direction:** Architecture Feedback composes Quality Gate evidence with Agent Skill interpretation; the component specs remain authoritative for their own surfaces
- **Advisory evidence:** `npm run diagnostics:health` and optional `npm run diagnostics:map`

### Out of Scope

- General complexity, coupling, churn, and topology analysis beyond routing existing Fallow evidence into Architecture Review
- A mandatory capability directory scaffold or persisted review-report format

### Anti-Patterns

- Do not treat a passing source-shape check as proof of sound architecture.
- Do not split files or create layers solely to move below a numeric threshold.
- Do not exempt a file or directory without an exact path and non-empty rationale.
- Do not pre-create product capability directories before their responsibilities exist.
- Do not require GitHub issues, pull requests, or persisted review reports.

## Contract

### Definition of Done

- [ ] Production JavaScript and TypeScript files over 1,000 lines trigger the source-shape gate unless exactly exempted.
- [ ] Directories with more than 40 production source files trigger the gate unless exactly exempted.
- [ ] Tests, end-to-end tests, and declarations do not contribute to source-shape limits.
- [ ] The fast gate runs the structural check, and affected guardrails run it after production source changes.
- [ ] Architecture Review interprets deterministic and advisory evidence against documented capability ownership.
- [ ] Feature specs can name source ownership, composition, state authority, public seams, dependency direction, and out-of-scope capabilities.

### Regression Guardrails

- Source-shape checking must remain dependency-free and deterministic.
- Missing configured source roots must not fail a project before it has runtime source.
- Exact exceptions must continue to require a rationale.
- Fallow coupling, churn, complexity, and topology analysis must remain advisory.
- Structural thresholds must remain configurable rather than embedded only in executable code.

### Verification

- **Focused tests:** `node --test scripts/check-source-shape.test.mjs`
- **Structural check:** `npm run quality:structure`
- **Baseline gate:** `npm run quality:gate`
- **Workflow check:** `npm run ci:local`

### Scenarios

**Scenario: A coordinator grows past the smoke-alarm limit**

- Given: a non-generated production source file exceeds the configured line limit
- When: the fast or affected gate runs
- Then: the gate fails with the file, measured size, limit, and Architecture Review guidance

**Scenario: A flat capability directory becomes crowded**

- Given: one directory contains more direct production source files than the configured limit
- When: the source-shape checker scans it
- Then: the gate reports that directory without counting nested capability directories against its direct-file total

**Scenario: A large source artifact is intentional**

- Given: the project must retain a large checked-in source file
- When: the exact file has a non-empty rationale in `.architecture-check.json`
- Then: the checker accepts the exception while keeping other source files governed

**Scenario: Capability expansion needs judgment**

- Given: structural or Fallow evidence shows concentrated responsibility
- When: Architecture Review evaluates the capability
- Then: it recommends Proceed, Consolidate first, or Decision required from ownership and dependency evidence
