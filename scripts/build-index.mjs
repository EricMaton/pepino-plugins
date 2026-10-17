// Builds index.json from plugins/<folder>/{plugin.json,main.js}: what Pepino
// lists and installs (pepino-ide #55, #56). Each entry carries the SHA-256 of
// its files, which the app checks after downloading them.
//
//   node scripts/build-index.mjs           writes index.json
//   node scripts/build-index.mjs --check   fails if index.json is not up to date (CI)

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PLUGINS = join(ROOT, 'plugins');
const INDEX = join(ROOT, 'index.json');

const ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const API_VERSIONS = ['1'];
const FILES = ['plugin.json', 'main.js'];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const errors = [];
const plugins = [];
for (const folder of readdirSync(PLUGINS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const where = `plugins/${folder.name}`;
  const fail = (message) => errors.push(`${where}: ${message}`);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(PLUGINS, folder.name, 'plugin.json'), 'utf8'));
  } catch (error) {
    fail(`plugin.json: ${error.message}`);
    continue;
  }
  if (typeof manifest.id !== 'string' || !ID.test(manifest.id)) fail('id: a reverse-domain name such as "com.example.tool"');
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) fail('name: required');
  if (typeof manifest.version !== 'string' || !VERSION.test(manifest.version)) fail('version: x.y.z');
  if (!API_VERSIONS.includes(manifest.apiVersion)) fail(`apiVersion: one of ${API_VERSIONS.join(', ')}`);
  const commands = manifest.contributes?.commands ?? [];
  const files = FILES.filter((file) => existsSync(join(PLUGINS, folder.name, file)));
  if (commands.length > 0 && !files.includes('main.js')) fail('main.js: needed, the plugin has commands');
  if (plugins.some((plugin) => plugin.id === manifest.id)) fail(`id "${manifest.id}" is already in another folder`);
  plugins.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    ...(manifest.description && { description: manifest.description }),
    permissions: manifest.permissions ?? [],
    path: where,
    files: Object.fromEntries(files.map((file) => [file, sha256(join(PLUGINS, folder.name, file))])),
  });
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

plugins.sort((a, b) => a.id.localeCompare(b.id));
const index = `${JSON.stringify({ schema: 1, plugins }, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(INDEX) ? readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== index) {
    console.error('index.json is not up to date: run node scripts/build-index.mjs');
    process.exit(1);
  }
  console.log(`index.json is up to date: ${plugins.length} plugins`);
} else {
  writeFileSync(INDEX, index);
  console.log(`index.json: ${plugins.length} plugins`);
}
