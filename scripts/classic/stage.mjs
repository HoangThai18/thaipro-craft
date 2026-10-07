import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const app = path.join(root, 'build', 'opencut-classic');
const web = path.join(app, 'apps', 'web');
const standalone = path.join(web, '.next', 'standalone');
const dest = path.join(app, 'desktop', 'web');

if (!fs.existsSync(path.join(standalone, 'apps', 'web', 'server.js'))) {
  console.error(`error: no standalone build at ${standalone}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

copyTree(standalone, dest);
fs.cpSync(path.join(web, '.next', 'static'), path.join(dest, 'apps', 'web', '.next', 'static'), { recursive: true });
fs.rmSync(path.join(dest, 'apps', 'web', 'public'), { recursive: true, force: true });
fs.cpSync(path.join(web, 'public'), path.join(dest, 'apps', 'web', 'public'), { recursive: true });

// bun links packages through a store of symlinks that does not survive being installed, so the
// packages the server needs are copied into one flat folder. It is not called node_modules because the
// installer builder drops folders with that name from extra resources; the shell sets NODE_PATH to it.
const flat = path.join(dest, 'server_modules');
fs.mkdirSync(flat, { recursive: true });
const seen = new Map();

function addPackage(source, name) {
  let real;
  let version;
  try {
    real = fs.realpathSync(source);
    version = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8')).version;
  } catch (error) {
    console.warn(`warning: ${name} skipped (${error.code ?? error.message})`);
    return;
  }
  if (seen.has(name)) {
    if (seen.get(name) !== version) console.warn(`warning: ${name} ${version} skipped, ${seen.get(name)} kept`);
    return;
  }
  seen.set(name, version);
  fs.cpSync(real, path.join(flat, name), { recursive: true, dereference: true });
}

function addFrom(modules) {
  if (!fs.existsSync(modules)) return;
  for (const entry of fs.readdirSync(modules)) {
    if (entry === '.bun' || entry === '.bin') continue;
    const full = path.join(modules, entry);
    if (entry.startsWith('@')) {
      let children = [];
      try {
        children = fs.readdirSync(full);
      } catch {
        continue;
      }
      for (const child of children) addPackage(path.join(full, child), `${entry}/${child}`);
    } else {
      addPackage(full, entry);
    }
  }
}

const store = path.join(standalone, 'node_modules', '.bun');
addFrom(path.join(standalone, 'node_modules'));
addFrom(path.join(standalone, 'apps', 'web', 'node_modules'));
addFrom(path.join(store, 'node_modules'));
if (fs.existsSync(store)) {
  for (const id of fs.readdirSync(store).sort()) addFrom(path.join(store, id, 'node_modules'));
}

// Images are served unoptimized, so the platform-specific image libraries are not needed. A
// universal macOS build also cannot merge two different native add-ons.
fs.rmSync(path.join(flat, '@img'), { recursive: true, force: true });
const natives = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.node')) natives.push(full);
  }
})(dest);
if (natives.length > 0) {
  console.error('error: native add-ons are left in the staged web app:\n' + natives.join('\n'));
  process.exit(1);
}

const licenses = path.join(app, 'desktop', 'licenses');
fs.mkdirSync(licenses, { recursive: true });
fs.mkdirSync(path.join(app, 'desktop', 'build'), { recursive: true });
fs.copyFileSync(path.join(app, 'LICENSE'), path.join(licenses, 'LICENSE-OpenCut.txt'));
fs.copyFileSync(path.join(app, 'LICENSE'), path.join(app, 'desktop', 'build', 'license.txt'));
const third = path.join(app, 'THIRD_PARTY_LICENSES.md');
if (fs.existsSync(third)) fs.copyFileSync(third, path.join(licenses, 'THIRD_PARTY_LICENSES.md'));

console.log(`staged ${dest} with ${seen.size} packages`);
