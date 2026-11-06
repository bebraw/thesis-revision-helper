# Use Cloudflare MCP With A Focused Skill Baseline

Use this update when a Cloudflare Worker project has a connected Cloudflare MCP and still vendors the broad Cloudflare skill suite.

## Apply

1. Confirm the Cloudflare MCP provides current documentation search, API discovery, and the account operations the project needs.
2. Keep `workers-best-practices` for Worker implementation and review guidance.
3. Keep `wrangler` for local development, configuration, testing, types, and deployment CLI guidance.
4. Remove the general `cloudflare`, `agents-sdk`, `cloudflare-email-service`, and `durable-objects` skill directories from each repository-local skill root.
5. Preserve any specialized skill whose product is already used by the target project.
6. Document that specialized Cloudflare skills should be added on demand rather than restored as a bundle.

## Fallback

The patch records the policy change but intentionally does not embed the removed skill contents. Skill roots and mirrored-agent conventions vary between repositories, so remove the unused directories manually after confirming their exact paths.

If the target does not have a reliable Cloudflare MCP connection, keep the general skill until a current documentation source is available. If it already uses Agents SDK, Durable Objects, or Email Service, retain that specific skill.

## Verify

- Confirm `workers-best-practices` and `wrangler` remain in every supported repository-local skill root.
- Confirm unused broad and product-specific Cloudflare skill directories are absent.
- Confirm no agent instruction points to a removed skill.
- Run `npm run format:check` or the target repository's documentation check.
