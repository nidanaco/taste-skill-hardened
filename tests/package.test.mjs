import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
test('both host catalogs use the same in-snapshot package, with no remote payload source', () => {
  const codex = json('.agents/plugins/marketplace.json'), claude = json('.claude-plugin/marketplace.json');
  const c = codex.plugins[0], a = claude.plugins[0];
  assert.equal(codex.name, claude.name); assert.equal(c.name, a.name);
  assert.deepEqual(c.source, { source: 'local', path: a.source });
  const pkg = resolve(root, a.source); assert.ok(pkg.startsWith(root));
  const cm = json(a.source + '/.codex-plugin/plugin.json'), am = json(a.source + '/.claude-plugin/plugin.json');
  assert.equal(cm.name, c.name); assert.equal(am.name, c.name); assert.equal(cm.version, am.version); assert.equal(am.version, a.version);
  assert.ok(existsSync(join(pkg, cm.skills, 'taste-frontend-hardened/SKILL.md')));
  for (const manifest of [cm, am]) for (const key of ['hooks', 'mcpServers', 'apps', 'dependencies']) assert.equal(manifest[key], undefined);
});
test('packaged skill is explicit-only and its local resource links exist', () => {
  const skill = join(root, 'plugins/taste-skill-hardened/skills/taste-frontend-hardened');
  const md = readFileSync(join(skill, 'SKILL.md'), 'utf8'), yaml = readFileSync(join(skill, 'agents/openai.yaml'), 'utf8');
  assert.match(md, /^---\nname: taste-frontend-hardened\n/); assert.match(md, /disable-model-invocation: true/); assert.match(yaml, /allow_implicit_invocation: false/);
  assert.doesNotMatch(md.split('---')[1], /allowed-tools|hooks|!`/);
  for (const path of [...md.matchAll(/\b((?:references|assets)\/[\w./-]+\.(?:md|css|js))\b/g)].map((m) => m[1])) assert.ok(existsSync(join(skill, path)), path);
  const walk = (dir) => { for (const name of readdirSync(dir)) { const path = join(dir, name); assert.equal(lstatSync(path).isSymbolicLink(), false); if (lstatSync(path).isDirectory()) walk(path); else if (/\.(?:js|mjs|css|json)$/.test(name)) { const text = readFileSync(path, 'utf8'); assert.doesNotMatch(text, /cdn\.jsdelivr\.net|fonts\.googleapis\.com|api\.fontshare\.com|api\.openverse\.org|fetch\s*\(/, path); } } };
  walk(skill);
});
