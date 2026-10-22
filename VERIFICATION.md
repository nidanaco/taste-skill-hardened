# Verification record

Checked October 21, 2026 (America/Los_Angeles), against the hardened working tree
derived from upstream `6010f91a9935f1c167dfc500fb1a475681892e6b` (v2.1.4).
The final Git commit and hosted CI result are reported separately so this record
does not claim to contain its own commit hash.

## Verified

- **14/14 isolated regressions passed**, with no skips. Real Chromium verified
  hostile chart labels and formatter output remain text, ordinary charts still
  render, page requests/navigation/socket APIs cannot reach a second origin,
  and an independent browser proxy denies a second port without page interception.
- The inspector produced four responsive/reduced-motion screenshots from a
  synthetic page, preserved previous outputs, and left other browser profiles
  untouched. Its own temporary profiles were removed.
- Public-serving tests reject hidden files, linked files/directories, private
  paths, unsupported file types, traversal, invalid encodings, hostile Host
  headers, cross-site requests, and writes. Snapshot immutability and size limits
  passed. Only synthetic marker files were used.
- Offline direction generation passed with filesystem writes denied by Node's
  permission model. Invalid and removed downloader/output options fail closed.
- Both catalogs resolve to the same package in the checkout; no nested Git
  branch, remote runtime dependency, hook, MCP server, or application integration
  is declared. Explicit invocation policies and referenced resources were checked.
- **Codex 0.163.0-alpha.11 native app-server** successfully parsed the catalog,
  package, and skill using `plugin/read`. It reported `installed: false` and
  `enabled: false`, and no hooks, apps, or MCP servers.
- **Claude Code 2.1.304** passed strict validation of the marketplace, plugin, and
  skills directory. Its session-only `--plugin-dir` loader inventoried exactly
  one skill, zero agents, zero hooks, zero MCP servers, and zero LSP servers.
- Native host checks used temporary configuration roots, inherited no service
  credentials, and left the checked global configuration files unchanged. No
  marketplace add, plugin install, enable, or skill-directory copy was performed.
- Seven retained JavaScript files passed syntax checks; package JSON parsed.

## Isolation and provenance

The suite ran as a non-root user in a disposable container with network `none`,
read-only source and root filesystem, no host credential/socket mounts, all
capabilities dropped, no-new-privileges, bounded CPU/memory/processes, and tmpfs
scratch storage. Chromium's sandbox remained enabled. A documented, licensed
seccomp profile permits its unprivileged namespace/chroot setup.

- Node: 24.22.1; Chromium: 155.0.8059.79 (Debian build), Linux arm64.
- Test image ID: `sha256:afd41e98071f3401d20b08e80e49c735a1935a6ed5a296d7b2e28551ab2c72dd`.
- Node base: `node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`.
- Test image creation uses distribution packages; future builds may receive a
  newer patched Chromium. Record the resulting image ID when rerunning.

## Limits

These are native loader/packaging checks and executable security regressions,
not a live model workflow evaluation. No model calls were made. Claude Code has
no authenticated CLI session on this workstation, so its live model trial remains
unverified. No password or credential was requested or copied.

The generic bundled skill validator predates Claude's supported
`disable-model-invocation` field. Its common-field check passed on a temporary
projection; the shipping YAML retained that security control, parsed with PyYAML,
and was checked by the native loaders. This compatibility limitation was not
worked around by weakening the shipped policy.

No claim is made that arbitrary hostile pages are safe outside OS isolation, or
that prompt injection can be prevented by prose alone. Browser vulnerabilities,
future updates, Windows execution, and broader agent behavior require their own
verification. No plugin was installed or enabled.

## Reproduce without installation

Build the disposable runtime with `tests/Dockerfile`, then run
`python3 tests/run-isolated.py --image <existing-image>`.

Run `python3 tests/validate-hosts.py --codex <executable> --claude <executable>`
to repeat native parser and session-only loader checks. Results go to the ignored
`test-results/` directory. Neither runner installs or enables the plugin.
