# Scope Local Agent CI to Workflow-Sensitive Changes

Use this update when a project has both a direct quality gate and a containerized Agent CI workflow replay, but currently requires both for every non-documentation change.

## Apply

1. Keep the project's direct quality gate as the readiness baseline for non-documentation changes.
2. Require local Agent CI when a change touches:
   - GitHub Actions workflows
   - package metadata or dependency installation behavior
   - build or container setup
   - browser CI setup
   - an explicit full PR or release readiness check
3. Allow ordinary source, test, tooling, and documentation changes to skip Agent CI when they do not cross those boundaries.
4. Keep Agent CI as the preferred local workflow replay before relying on remote GitHub Actions when it is required.
5. Update agent instructions, architecture rules, contributor documentation, and quality-gate contracts together.
6. Record the policy change in the target project's ADR system when it changes an existing readiness decision.

## Fallback

If the target project does not have a direct quality gate that already covers deterministic checks and browser behavior, do not narrow Agent CI yet. First identify which checks would be lost and establish an equivalent baseline.

Adapt the boundary list when the target workflow has other environment-sensitive jobs, such as database services, deployment packaging, or platform-specific builds. Prefer explicit categories over a vague "high-risk change" rule.

## Verify

- `npm run format:check`

Confirm that no current instruction still claims Agent CI is mandatory for every non-documentation change and that the target project's normal quality gate remains required.
