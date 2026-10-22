# Browser sandbox profile

Derived from Microsoft Playwright's Apache-2.0 seccomp profile at commit
`ae935a43d9e376e4759548f6b3c6905c7b282333`, path
`utils/docker/seccomp_profile.json`. See LICENSE.playwright for its license.

Modification in this fork: allow the `chroot` syscall so Chromium can create its
sandbox inside an unprivileged user namespace when container capabilities are all
dropped. The container still uses no-new-privileges, a non-root user, no network,
a read-only root/source mount, and bounded memory/processes. Chromium's sandbox
stays enabled; the runtime provides no no-sandbox escape hatch.

The test image contains Node and Chromium only. It installs no Codex/Claude
plugin. Build it explicitly with `docker build -f tests/Dockerfile -t taste-test .`,
then run `python3 tests/run-isolated.py --image taste-test`.
