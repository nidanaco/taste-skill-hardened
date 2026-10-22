# Verification record

## October 22, 2026: visual and socket fixes, hardened.2

All **36/36 regressions passed locally**, with no skips, using Node 24.21.0 and
Google Chrome 156.0.8078.48 on macOS. Sixteen browser configurations cover the two
workshop fixtures and packaged chart sample: desktop, tablet, phone, 320px reflow,
reduced motion, and 200% root text size as applicable. Real keyboard and pointer
input, visible focus, native form validity, contrast, and chart tooltips passed.
Screenshots were also opened for visual review; metrics alone were not accepted
as evidence of appearance.

- Corrected the Claude workshop fixture's flex input and both CSS foundations so
  enlarged controls can shrink within their containers. Its previously 419px-wide
  page now fits the 390px viewport. Added scoped form guidance to composition.
- Allocation charts give the bar its own full-width row, so compact cards retain
  visible tracks and figures. Data, targets, labels, and safe text-node handling
  remain intact.
- Reproduced the original proxy's unhandled `ECONNRESET` using synthetic CONNECT
  clients. The fixed deny proxy handles transport errors and owns all sockets
  through cleanup. A 200-reset regression passes; HTTP, CONNECT, and upgrade
  denial still produce zero destination hits. Six repeated fresh-profile
  inspector runs complete without a crash or findings.
- Codex 0.163.0-alpha.11 and Claude Code 2.1.304 native package/loader checks pass
  for package version `2.1.4-hardened.2`. Neither host installs or enables it.

The local run used fresh Chrome profiles with Chrome's built-in sandbox enabled,
a scrubbed environment, mock keychain mode, and the reviewed origin gate/deny
proxy. Docker was unresponsive, and nesting an outer macOS sandbox prevented
Chrome renderer startup; the successful local run was **not** an OS-isolated or
network-isolated execution. Hosted CI runs the same 36 regressions with the
credential-free, network-none container policy below; the final commit and its
actual CI outcome are recorded separately rather than predicted here.

Historical live Codex and Claude trials used the earlier hardened.1 revision.
These fixes did not rerun live model calls; the corrected outputs, runtime helpers,
native loaders, and browser regressions were checked directly. The original
model-produced snapshots are preserved outside this repository; corrected
reproducible workshop fixtures live under `tests/fixtures/`.

These are targeted Chrome checks, not Safari/Firefox coverage or full WCAG
certification. Enlarged text means root font size 200%, not browser-UI zoom. No
plugin was installed, enabled, or registered. Explicit-only invocation and all
authorization boundaries remain in place.

## October 21, 2026: original hardening verification (historical)

Checked October 21, 2026 (America/Los_Angeles), against the hardened working tree
derived from upstream `6010f91a9935f1c167dfc500fb1a475681892e6b` (v2.1.4).
The final Git commit and hosted CI result are reported separately so this record
does not claim to contain its own commit hash.

### Verified

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

### Isolation and provenance

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

### Limits at that time

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
