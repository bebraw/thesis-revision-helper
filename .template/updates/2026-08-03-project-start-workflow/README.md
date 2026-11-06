# Add Approval-Gated Project Start

Use this update when a downstream project still carries inherited template material and needs a deliberate way to define its first product horizon and prune without breaking working seams or losing future update provenance.

## Apply

1. Inspect the target repository's agent skill root, project documentation, specs, ADR conventions, package metadata, and local update workflow.
2. Apply `patch.diff` when those surfaces still resemble the template. Otherwise copy `.codex/skills/start-project/` and port the routing and durable contracts manually.
3. Keep Start Project explicitly invoked. Its first phase must be read-only and must list exact targets and coupled edits before asking for approval.
4. Adapt the pruning catalog to any target-specific distribution, starter, governance, skill-copy, and tooling surfaces.
5. If historical update packs may be pruned, make the sync workflow discover the actual template `source`, baseline Git revision, and applied update IDs from existing package metadata or durable docs.
6. Add the skill to the user-facing catalog and agent routing. Record the workflow in the target's spec and architecture-decision structure when those surfaces exist.

## Fallback

If the target already has an initialization workflow, preserve its project-definition format and add only the missing approval, coupled-reference audit, replace-later category, or update-provenance safeguards.

Do not apply the example template source blindly. Discover it from the clone or confirm it with the user. Do not create a new project manifest when existing package metadata or durable docs already own this information.

## Verify

- Run the skill-creator validator against the installed `start-project` skill.
- Confirm the planning phase makes no worktree changes.
- Confirm approval is scoped to exact removal targets and coupled edits.
- Confirm README and agent routing describe the skill as explicit-only.
- Confirm the update sync entrypoint can discover template source, baseline, and applied update IDs after local historical packs are pruned.
- Run the target project's baseline quality check.
