# ADR-073: Use a Browser Working Copy

**Status:** Implemented

**Date:** 2026-11-09

**Supersedes:** [ADR-069](../accepted/ADR-069-local-companion-and-cloudflare-backend.md), [ADR-070](ADR-070-assume-single-user-source-editing.md), and [ADR-071](ADR-071-accept-local-path-replacement-race.md)

## Context

The student revises one LaTeX file at a time. Opening a project directory and running a local companion add setup for a workflow that can instead use ordinary copy and paste. The bundled example should be available in the application itself.

## Decision

Run the writing workspace, parsing, revision coordination, and recovery in the browser. The student pastes source into a single working document and copies the result back to their own file. Browser `localStorage` holds the working copy and revision drafts for recovery; it is not a backup or a synchronized view of the external file. Surface storage failures, preserve the in-memory text, and protect the existing working copy when replacing it with pasted or sample content. The application cannot detect changes made to the external file.

Provide the sample in the application without creating a temporary project. Preserve the distinction between an AI proposal and the student's revision, guarded commits, undo, and editing when model analysis is unavailable.

Connect directly from the browser to a user-configured, credential-free, loopback OpenAI-compatible model service. Validate the endpoint and model responses, send only the text and context needed, and do not persist credentials. The model service must permit requests from the application's origin; a local model is optional for writing. Parser, persistence, and model boundaries remain replaceable.

The app is served directly at `/` with the existing Worker and static assets; the retained starter lives at `/starter`. Manuscript state and model requests do not pass through the Worker. ADR-070 and ADR-071 describe limitations of the previous filesystem-backed companion, not browser-copy behavior.

## Consequences

- No directory access, file write, local project service, or separate demo launcher is needed for the browser workflow.
- The student is responsible for copying the result back to the external file and keeping an independent backup. Browser storage can be unavailable or cleared, and copy/paste does not guarantee byte-for-byte file preservation.
- The app cannot resolve included files or detect external file edits from a pasted document; unsupported constructs remain visible and diagnosed.
- A browser-accessible local model requires compatible CORS and browser networking settings. There is no guarantee that every local model or provider supports the requested response format.

## Alternatives considered

The local companion and Cloudflare backend in ADR-069 supported direct file access but added setup, persistence, and security boundaries that are unnecessary for the chosen one-file copy/paste workflow. A hosted model service would also work with browser storage, but requires a separate credential and hosting decision; it is not required for the initial local-model path.
