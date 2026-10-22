import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { test } from 'node:test';
const script = fileURLToPath(new URL('../plugins/taste-skill-hardened/skills/taste-frontend-hardened/scripts/draw.mjs', import.meta.url));
const skill = dirname(dirname(script));
const run = (args) => spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + skill, script, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 5000 });
test('offline direction suggestions are deterministic and work with filesystem writes denied', () => {
  const a = run(['--seed', '42']), b = run(['--seed', '42']); assert.equal(a.status, 0, a.stderr); assert.equal(b.stdout, a.stdout);
  const data = JSON.parse(a.stdout); assert.equal(data.directions.length, 3); assert.ok(data.palette.bg); assert.ok(data.type.display.family);
  assert.ok(data.directions.every((d) => !d.needs.length));
});
test('invalid and removed options fail without side effects', () => {
  for (const args of [['--seed', '-1'], ['--options', '1000'], ['--sector', 'missing'], ['--source', 'all'], ['--out', '/tmp/unwanted']]) assert.notEqual(run(args).status, 0);
});
