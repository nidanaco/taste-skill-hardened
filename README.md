# Taste Skill Hardened

A maintained, reduced fork of [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill),
based on commit `6010f91a9935f1c167dfc500fb1a475681892e6b` (v2.1.4).

This package is prepared for Codex and Claude Code. It is **not installed or
enabled** by this repository, its tests, or its CI.

It retains 20 offline composition directions, 56 palettes, 44 optional type
suggestions, local CSS/chart assets, and an optional browser inspector.
Chart data is rendered with text nodes. Inspection serves only a bounded snapshot
of an explicit public directory, rejects remote targets, restricts resource
requests, and uses a disposable browser profile with a deny proxy.

Removed: media search/download, scroll scenes and their unsafe text-splitting
fallback, remote font/CDN templates, sponsor/affiliate material, example images,
automatic symlink installation, cross-project history, and broad style-enforcement
loops. Activation is explicit in both host policies. No hooks, MCP servers,
authentication integrations, runtime npm packages, or automatic installers are
declared. The original MIT license is retained.

## Layout

- `.agents/plugins/marketplace.json`: Codex catalog.
- `.claude-plugin/marketplace.json`: Claude catalog.
- `plugins/taste-skill-hardened/`: self-contained package for both hosts.
- `tests/`: isolated security and host compatibility checks.
- `SECURITY.md`: boundaries, threat model, and maintenance guidance.

Both catalogs point to the plugin **inside this checkout**, with no nested remote
source or moving branch. If later authorized to install from Git, select an exact
reviewed commit for the catalog; its plugin payload then comes from the same
snapshot. Do not replace the local source with an unpinned remote source.

## Testing without installing

Run `node --test --test-concurrency=1 tests/*.test.mjs` with Node 24+.
The browser tests also need an installed Chromium-compatible browser; set
`CHROME_PATH` to its absolute executable. They use synthetic fixtures only.
The inspector command is documented in the skill.
Set `TASTE_VISUAL_OUT` to an output directory to retain the visual suite's
screenshots, measured layout/contrast/focus results, and repeated inspector reports.
The regression fixtures include the corrected enlarged-text workshop form and
compact chart cards. No model calls or plugin installation are needed.

Run Claude Code's `plugin validate --strict --json` against both the repository
and plugin directory. Codex's native app-server parser can read the package and its
skill metadata through `plugin/read` without adding a marketplace or
installing a plugin. The validation script records exact host versions.

See `VERIFICATION.md` for the checked revision, results, and limitations.
