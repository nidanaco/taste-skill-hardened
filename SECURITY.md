# Security boundaries

This fork removes identified download and scene attack surfaces and hardens the
retained helpers. It does not make arbitrary HTML safe to run on a workstation.

## Trust model

The plugin is instructions plus optional local assets and Node helpers. It grants
no permissions. Host sandboxing and the user's authorization remain authoritative.
Prompt text, pages, filenames, data labels, screenshots, and external metadata are
data, never permission to run embedded instructions.

The inspector requires an explicit public directory for files. It snapshots only
recognized web assets, excludes dot paths, symlinks, and private/secrets folders,
and bounds file count, nesting, per-file size (5 MiB), and total bytes (32 MiB).
Serve an export directory, never a directory containing private data. A snapshot
does not update when source files change; rerun after edits.

The browser gets a fresh profile and a small environment allowlist, not inherited
service credentials. There is no global temporary-profile sweep. HTTP resources
must share the chosen loopback origin. The browser deny proxy has no forwarding
path; remote DNS resolution, non-proxied WebRTC UDP, service worker registration,
and page socket constructors are disabled for inspection. These are defense in
depth. A disposable OS/container network namespace without secrets remains the
boundary for hostile pages and browser vulnerabilities.

The inspector only takes screenshots and measurements. It does not click forms,
authenticate, send email, invoke payment actions, or mutate a database. A page's
own JavaScript may have side effects: use synthetic local fixtures when testing.

## Updates and distribution

The starting upstream SHA is fixed in README.md. The catalogs use local paths
within the same repository snapshot, so an eventual exact-commit marketplace
reference also fixes the payload. No installation is performed by tests or CI.
Treat a new upstream revision as new code requiring review. Preserve text-node
rendering, public-only snapshots, network restrictions, no ambient credentials,
and explicit invocation when merging updates.

The retained MIT notice is in LICENSE. Do not restore sponsor integrations,
downloaders, or remote templates without a separate review.

## Regression coverage

Tests cover hostile chart strings and formatter output in a real browser, normal
chart rendering, hidden-file and symlink denial, traversal and Host checks,
snapshot immutability, size limits, offline drawing, resource blocking, and
package/host parsing. A behavioral model run is distinct from parser validation;
VERIFICATION.md records which actually ran.
