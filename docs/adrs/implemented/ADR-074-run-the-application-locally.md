# ADR-074: Run the Application Locally

**Status:** Implemented

**Date:** 2026-11-09

## Context

The thesis workspace uses a browser working copy and an optional loopback model service. A hosted application is unnecessary for this workflow. The current local development server already serves the workspace and preserves the browser origin used for existing working copies.

## Decision

Support the application as a local-only product. `npm start` serves it on the loopback interface at `http://127.0.0.1:8787` by default, and the application has no supported deployment command. Retain the existing Wrangler local server, Worker routes, and static-asset build. The inherited template's preflight and capability kits remain available for downstream template work; they are not part of the application's local workflow.

This decision complements [ADR-073](ADR-073-use-a-browser-working-copy.md), which defines the working copy and local-model boundaries.

## Consequences

- Students can use the app without a hosted service or Cloudflare account, while their existing browser working copies remain available at the same origin.
- A student must run the local server, and browser storage remains specific to the origin and browser profile.
- Wrangler remains a development dependency and its underlying tools can still package Workers; retaining template tooling is not a technical prohibition on manually deploying the code.

## Alternatives considered

A hosted deployment would add an operational service without being required by the single-file, local-model workflow. Replacing Wrangler with a new local HTTP server would also satisfy the local-only goal but would require replacing established routing, asset headers, builds, and test setup while preserving the browser origin.
