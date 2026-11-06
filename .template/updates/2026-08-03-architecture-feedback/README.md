# Add Early Architecture Feedback

Use this update when a downstream project has strong functional checks but needs earlier feedback about capability ownership, oversized source files, and crowded source directories.

## Apply

1. Inspect the target project's source roots, test naming, feature-spec format, agent skill root, and normal quality commands.
2. Apply `patch.diff` when those surfaces still match the template closely. The patch installs the core checker, skill, fast-gate wiring, and global guidance; complete the target-specific affected-file, feature-spec, and README integration in the following steps.
3. Otherwise copy `.architecture-check.json`, `scripts/check-source-shape.mjs`, its test, and `.codex/skills/architecture-review/` manually.
4. Adapt source roots, extensions, test suffixes, and limits to the target project. Keep limits generous enough to act as smoke alarms rather than style rules.
5. Add `quality:structure` to the target's fast gate and affected-file path.
6. Extend the target's feature-spec format with capability source, composition, state authority, public contracts, dependency direction, and out-of-scope work.
7. Register Architecture Review in the target's agent routing and user-facing skill catalog.
8. Record the lasting constraint in the target's architecture documentation and run its normal readiness checks.

## Fallback

If the target already has architecture diagnostics, retain them and add only the missing timing or interpretation. The key behavior is that extreme structural growth triggers review before another capability expands.

If the target has legitimate large generated or declarative source, exclude generated roots or add exact exceptions with non-empty rationales. Do not weaken the global limit merely to admit one known artifact.

If the target does not use Fallow, replace the skill's advisory commands with its existing coupling, churn, and topology tools. The deterministic source-shape checker has no package dependency.

The template defaults of 1,000 lines per production file and 40 direct production files per directory were calibrated against Kirjolab's 1,461-commit development history. Lower limits interrupted the initial discovery slice; higher limits delayed feedback until mixed ownership or refactoring pressure was already pronounced. Treat these values as evidence-based starting points, then adapt them to the target's language and source conventions.

## Verify

- Run `node --test scripts/check-source-shape.test.mjs`.
- Run `npm run quality:structure` against the actual project source.
- Confirm the fast and affected quality paths invoke the checker.
- Confirm Architecture Review treats thresholds as checkpoints rather than decomposition instructions.
- Confirm every exception names an exact path and includes a rationale.
- Run the target project's baseline quality gate and workflow-sensitive CI check.
