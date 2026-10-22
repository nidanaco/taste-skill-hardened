#!/usr/bin/env node
// Pure offline suggestions: reads packaged JSON and prints JSON to stdout.
// No project files, network, browser, randomness, or home-directory state.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const load = (name) => JSON.parse(readFileSync(join(root, name + '.json'), 'utf8'));
const args = process.argv.slice(2), opts = { seed: 1, options: 3, sector: 'other', have: [] };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, ''), value = args[i + 1];
  if (!args[i].startsWith('--') || !['seed', 'options', 'sector', 'have'].includes(key) || !value || value.startsWith('--')) throw new Error('usage: draw.mjs [--sector name] [--seed integer] [--options 1..5] [--have product-photo,photography]');
  opts[key] = key === 'have' ? value.split(',') : ['seed', 'options'].includes(key) ? Number(value) : value;
}
if (!Number.isSafeInteger(opts.seed) || opts.seed < 0 || !Number.isInteger(opts.options) || opts.options < 1 || opts.options > 5) throw new Error('seed must be a nonnegative safe integer; options must be 1..5');
let state = opts.seed >>> 0;
const next = (n) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
const all = load('directions').filter((d) => (d.needs || []).every((a) => opts.have.includes(a)));
if (!all.some((d) => d.sectors.includes(opts.sector))) throw new Error('unknown sector: ' + opts.sector);
const pool = all.filter((d) => d.sectors.includes(opts.sector));
const choices = [];
while (choices.length < opts.options && pool.length) choices.push(pool.splice(next(pool.length), 1)[0]);
const palettes = load('palettes'), type = load('type');
console.log(JSON.stringify({ seed: opts.seed, directions: choices, palette: palettes[next(palettes.length)], type: type[next(type.length)], fontPolicy: 'Use project or system fonts by default. A suggested family is optional and must already be available locally; no remote font loading is required.' }, null, 2));
