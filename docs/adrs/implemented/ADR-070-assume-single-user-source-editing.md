# ADR-070: Assume Single-User Source Editing

**Status:** Implemented

**Date:** 2026-11-06

## Context

The first product slice edits a student's local LaTeX files and preserves separately saved revision drafts. The original product baseline sought protection against concurrent external edits. An external editor can retain an open descriptor across an atomic file replacement and subsequently write to the displaced file; version checks immediately before replacement cannot prevent that lost write.

The project is a single-user application. The user has explicitly removed concurrent editing from its requirements. This decision narrows the concurrent-writer requirement, not the requirement to preserve student ownership or detect source changes made between application operations.

## Decision

Assume that no other editor or process modifies the selected manuscript files concurrently with this application. The project service checks the observed source version before replacing a file, reports changes detected between operations as conflicts, and preserves the student's revision draft when a commit cannot proceed. It serializes its own writes and keeps model output separate from student-authored transactions.

The application does not claim an atomic compare-and-replace against an uncooperative external writer or support simultaneous multi-editor changes. Other sources of untrusted input and path confinement remain subject to the product's security contract and the specific limitation in [ADR-071](./ADR-071-accept-local-path-replacement-race.md); single-user use is not permission to execute manuscript content or follow unsafe paths.

## Consequences

**Positive:**

- The student can edit source files and commit revisions through a lightweight local companion without requiring a special editor integration.
- Sequential external file changes remain detectable, while source and draft state remain separate.

**Negative:**

- Simultaneous source modifications by another process can overwrite or lose changes and are outside the supported workflow.
- The version check and subsequent file replacement are not a cross-process transaction.

**Neutral:**

- The user may continue to compile with normal LaTeX tooling; tools must not concurrently modify the source being edited.
- Concurrent editing and stronger cross-process coordination require a new decision and implementation before they can be offered.

## Alternatives Considered

### Guarantee Concurrent Uncooperative Writes

Keeping the original guarantee would require an enforceable coordination or mediation design that is not established by advisory locks, a pre-write hash check, or ordinary atomic replacement. It is unnecessary for the selected single-user scope.

### Keep Manuscript Files Read-Only

A read-only preview avoids source mutation but cannot complete the requested editing and student-commit workflow. It was a temporary safeguard while the concurrency decision was unresolved.
