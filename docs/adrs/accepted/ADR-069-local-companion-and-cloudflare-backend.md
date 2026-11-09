# ADR-069: Use a Local Companion and Cloudflare Backend

**Status:** Superseded by [ADR-073](../implemented/ADR-073-use-a-browser-working-copy.md)

**Date:** 2026-11-06

## Context

Thesis Revision Helper helps a student revise an existing LaTeX project while preserving the student's authority over its research and wording. The application needs ordinary local source-file access, reliable editing and recovery, and model-assisted interpretations and proposals. Model requests must not block editing or directly modify the manuscript. The current repository is a Worker starter and does not yet provide these product capabilities.

The user selected a single-user browser interface with a local companion and a Cloudflare model/backend component. The product contract in the [thesis revision spec](../../../specs/thesis-revision/spec.md) specifies source fidelity, guarded commits, data handling, and the staged release.

## Decision

Use a local companion service for project access, source editing and persistence coordination, and a separate application-managed store for annotations and drafts. UTF-8 LaTeX files remain the source of truth. Only student editing transactions may change manuscript content; generated analysis and proposals remain separate and cannot authorize source mutations.

Use Cloudflare for the model/backend alongside the local companion. Keep model credentials in the local service and out of browser state, project exports, and logs. Send only the selected source and necessary surrounding context for model work. The local service binds to loopback, validates allowed origins, and confines project paths subject to the accepted limitation in [ADR-071](../implemented/ADR-071-accept-local-path-replacement-race.md); source and model output are untrusted. Editing, saving, and draft recovery remain usable when model analysis is unavailable.

Editor, parser, storage, model provider, and transport interfaces remain replaceable. The framework, provider, storage technology, exact Cloudflare responsibilities, backend authentication, and deployment details are not selected by this decision. Their implementation must preserve these boundaries and the feature contract.

## Trigger

Project initialization established the thesis-revision workflow and selected an early vertical slice across local editing, automatic outline analysis, proposal generation, and student-controlled revision.

## Consequences

**Positive:**

- Local source access and ordinary editor transactions preserve the student's ownership of the manuscript.
- A separate backend and replaceable model adapter permit model assistance without tying editing availability to a provider.
- Separate generated state supports analysis history and draft recovery without altering source files.

**Negative:**

- The local companion and remote backend add installation, versioning, authentication, and operational boundaries to design and maintain.
- Source fidelity, external-edit conflicts, secure local access, and recovery require explicit implementation and verification.
- Sending manuscript context to a configured provider creates a data-handling boundary that must be visible to the student and minimized.

**Neutral:**

- The existing Worker stub stays in place until a verified replacement is available; it is not evidence that the product architecture is already implemented.
- No particular framework, parser, provider, persistent-store technology, or Cloudflare product is selected here.

## Alternatives Considered

### Cloud-Only Application

A hosted-only application would avoid a companion service, but direct local project access and ordinary file ownership would require an alternative import, synchronization, or permission model. It does not match the selected local-source workflow.

### Local-Only Application and Model Backend

Keeping every component local could reduce remote infrastructure, but the user selected Cloudflare for the model/backend. This decision does not require model analysis to be available for local editing.

### Model-Driven Manuscript Updates

Allowing the backend to apply proposals directly would reduce steps, but would blur student authorship and risk overwriting current source or applying unreviewed changes. Student-controlled editing transactions remain the only source mutation path.
