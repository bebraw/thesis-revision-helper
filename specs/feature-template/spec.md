# Feature: Template Feature

## Blueprint

### Context

{Why does this feature exist? What problem does it solve?}

### Architecture

- **Capability source root:** {Directory that owns this independently evolvable behavior}
- **Composition root:** {File or module that wires the capability into the application}
- **Entry points:** {Routes, commands, jobs, or other entry surfaces}
- **State authority:** {Canonical state, persistence owner, and derived/rebuildable state}
- **Public contracts:** {APIs, schemas, events, or module seams used by dependents}
- **Dependency direction:** {What this capability may depend on and what may depend on it}

### Out of Scope

- {Adjacent capability intentionally deferred from this contract}

### Anti-Patterns

- {What contributors and agents must avoid, with rationale}

## Contract

### Definition of Done

- [ ] {Observable success criterion}
- [ ] {Spec updated in the same change set}
- [ ] {Automated tests cover the critical behavior}

### Regression Guardrails

- {Invariant that must continue to hold}

### Verification

- **Automated tests:** {Unit, integration, or e2e checks that prove the contract}
- **Coverage target:** {Expected coverage or critical paths that must stay exercised}

### Scenarios

**Scenario: {Name}**

- Given: {Precondition}
- When: {Action}
- Then: {Expected outcome}
