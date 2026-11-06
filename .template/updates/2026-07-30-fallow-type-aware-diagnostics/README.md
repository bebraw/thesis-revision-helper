# Adopt Type-Aware Fallow Diagnostics

Use this update when a project already has the advisory Fallow diagnostics from `2026-06-17-advisory-fallow-diagnostics` and can run Fallow 3.10's packaged semantic companion.

## Apply

1. Pin `fallow` to `3.10.0` and regenerate the package-manager lockfile with optional dependencies enabled.
2. Add `--type-aware --type-aware-require best-effort` to the changed-code audit and whole-repo health commands.
3. Add `--type-coupling` to the health command.
4. Add an opt-in map command that writes a self-contained report to `.fallow/codebase-map.html` with `--no-open` and `--no-cache`.
5. Keep `.fallow/` ignored and document the generated map as disposable local state.
6. Ignore dependency aliases that the target project intentionally executes through direct `node_modules` script paths instead of importing.
7. Keep compiler diagnostics and general linting in the target project's existing TypeScript and lint commands.

## Fallback

If optional dependencies are disabled, install `fallow-type-aware` at exactly the same version as `fallow`. If the project cannot run the packaged companion, keep Fallow's default syntactic mode rather than pointing `FALLOW_TYPE_AWARE_BIN` at an unreviewed executable.

If the target project intentionally treats Fallow as a hard gate, review whether `best-effort` or `complete` matches that policy before porting the scripts. Do not silently strengthen an advisory diagnostic into a merge blocker.

## Verify

- `npm run diagnostics:readability`
- `npm run diagnostics:health`
- `npm run diagnostics:map`
- `npm run quality:gate`
- `npm run ci:local`

Confirm that the installed Fallow and semantic companion versions match, the health report includes type coupling, and the map is written only under ignored `.fallow/` state.
