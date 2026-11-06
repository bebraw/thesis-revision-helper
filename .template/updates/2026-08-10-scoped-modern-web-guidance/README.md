# Add Scoped Modern Web Guidance

Use this update when a browser-facing project derived from `vibe-template` should gain current web-platform and compatibility guidance without adding the upstream guide corpus, a runtime dependency, automatic updates, or another CI gate.

## Apply

1. Inspect the target project's current browser-support policy, local skill root, frontend guidance, typed-client boundary, and browser verification before applying the patch.
2. Add `.codex/skills/modern-web-guidance/` with its `SKILL.md`, `agents/openai.yaml`, and Apache-2.0 `LICENSE`. If the target uses another canonical skill root, preserve that root instead of adding a parallel one.
3. Preserve both provenance coordinates: the instruction snapshot is `GoogleChrome/modern-web-guidance` revision `684ab9d7c6b78fc2cd5677912d874397cb2e5dfa` and labels itself `0.0.179`; the CLI is the separate `modern-web-guidance@0.0.180` npm artifact from `GoogleChrome/modern-web-guidance-src` tag `v0.0.180` and commit `29ecd9546013e32e0a597ad5ab3a2fc26add1f1d`, with integrity `sha512-55diU2dH4nMF2DKWmvOdeLKWUvTTz32UIcSlYFSa+AN699MVC7pvqJ4mlFMmPd7qfnRJiP/FxKcSkIOP0MSDDw==`.
4. Preserve `DISABLE_TELEMETRY=1` on every search and retrieval command.
5. Route the skill only when browser-facing work requires selecting a web-platform feature or API, interpreting compatibility, or designing a fallback. Skip backend-only work, routine styling or behavior changes that apply established project patterns, copy, CI, and general tooling.
6. Keep target-project architecture, specs, source conventions, user instructions, and tests authoritative over retrieved examples.
7. Use the target project's existing browser-support contract. If none exists, adopt Baseline Widely available for core behavior and require a usable core path for newer progressive enhancements.
8. State what the target's browser tests actually cover. Chromium-only checks must not be presented as cross-browser proof.
9. Register the skill briefly in the target's agent guidance and user-facing skill catalog, then update its owning spec or architecture record.

The first tool invocation downloads and caches the pinned npm package. This is development guidance rather than an application dependency.

## Fallback

If the patch does not apply because the target's skill routing or documentation has diverged, port the behavior manually. Merge the smallest routing pointers into existing docs and keep the skill workflow in its `SKILL.md`.

If the target already has a stricter or narrower browser policy, preserve it and update the skill's interpretation rules instead of introducing a competing Baseline target.

If development environments cannot fetch the pinned npm package, omit the skill or adapt it to retrieve current primary web-platform documentation through an already approved tool. Do not silently switch to `@latest`, enable telemetry, or vendor the full upstream package.

## Verify

- Validate the skill metadata with the current skill-creator validator when available.
- Confirm every CLI command contains both `modern-web-guidance@0.0.180` and `DISABLE_TELEMETRY=1`.
- Confirm npm metadata still maps `modern-web-guidance@0.0.180` to source commit `29ecd9546013e32e0a597ad5ab3a2fc26add1f1d` and integrity `sha512-55diU2dH4nMF2DKWmvOdeLKWUvTTz32UIcSlYFSa+AN699MVC7pvqJ4mlFMmPd7qfnRJiP/FxKcSkIOP0MSDDw==`.
- Confirm the skill contains no `@latest`, install, update, or automatic-update command.
- Confirm the README catalog and agent routing point at the canonical skill path.
- Confirm the browser target and actual automated browser coverage are both explicit.
- Optionally smoke-test one representative `search` and `retrieve` with telemetry disabled.
- Run the target project's formatting and quality gates.
