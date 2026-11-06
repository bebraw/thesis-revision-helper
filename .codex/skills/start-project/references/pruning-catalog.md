# Pruning Catalog

Use this catalog as an audit prompt, not as deletion authorization. Confirm every path and dependency in the current repository.

## Distribution-only candidates

- `.capabilities/`: partial-upgrade kits for exporting template practices. A normal downstream product can usually remove the directory together with capability-kit docs and specs once it no longer distributes those kits.
- `.template/updates/<update-id>/`: historical migration packs. Prune only after recording the upstream template source, starting revision, and applied updates in existing package metadata or durable docs. Retain or replace a clear sync entrypoint.
- Template-maintenance prose in `README.md`, `ARCHITECTURE.md`, specs, and ADRs: adapt it when the project stops acting as a distributable starter; do not leave stale links.

## Replaceable starter candidates

- `src/` Worker stub, starter routes, health endpoint, styles, and colocated tests.
- `specs/stub-worker/spec.md` and starter-specific parts of other specs.
- `docs/screenshots/home.png` and its README section.
- Starter-specific Wrangler, Tailwind, browser, and Lighthouse setup.

Keep these until the approved product loop supplies an equivalent working seam or explicitly abandons it. Removing a starter feature may also require changes to package scripts, dependencies, workflows, configs, tests, docs, and architecture rules.

## Selectable governance and agent candidates

- `.codex/skills/`: keep skills that match the retained stack and working style. Update `AGENTS.md`, the README catalog, specs, licenses, and any distribution copies with every removal.
- `.github/skills/`: compatibility copies, not independent ownership. Compare them with canonical `.codex/skills/` sources and change both intentionally.
- `.agents/skills/` and `skills-lock.json`: third-party skills and provenance metadata. Remove lock entries with removed vendored skills.
- `.asdlc/`: local methodology reference. Keep by default while `AGENTS.md` uses it as the context anchor; removing it requires replacing that guidance deliberately.
- `docs/adrs/implemented/`: active decision history, not disposable changelog. Retain by default. Consolidate only when every still-active constraint remains represented in current architecture and spec documents.
- `specs/`: living contracts. Replace template-domain specs with project-domain specs as ownership changes; do not delete a contract while its behavior remains.

## Coupled tooling candidates

- `.github/workflows/`, `.githooks/`, scripts, configs, `package.json`, and the lockfile form a dependency graph. Remove a tool only after tracing its scripts, packages, workflow steps, docs, generated paths, and checks.
- `.architecture-check.json` and source-shape tooling remain useful independent of the starter UI. Calibrate or remove them only through an explicit architecture decision.
- Generated and machine-local paths such as `reports/`, `.generated/`, `.fallow/`, `.wrangler/`, `.cache/`, and `.npm/` are ignored workspace artifacts, not project-shape decisions. Do not include them in a tracked-file pruning plan.

## Update record

When `package.json` is an appropriate durable surface, extend its existing metadata rather than creating another state file:

```json
{
  "vibeTemplate": {
    "source": "https://github.com/bebraw/vibe-template",
    "baseline": "<full-git-revision>",
    "updates": []
  }
}
```

Use the actual source discovered from the clone or confirmed by the user. Do not guess a repository URL. If package metadata is unsuitable, put the same three fields in durable project documentation.

## Removal safety checks

For each target:

1. Confirm it is tracked and inside the repository.
2. Search for path, command, package, symbol, and skill-name references.
3. Identify canonical and copied variants.
4. Name the behavior or workflow that disappears.
5. Name the replacement or explain why none is needed.
6. List exact coupled edits and verification.
7. Obtain approval before deletion.
