// SPDX-License-Identifier: AGPL-3.0-only
// Installs one profile from components.json into another project, with only the packages it needs:
//
//   npm run add -- avatar --to ../my-app
//
// The packages are not on npm yet, so this packs them with their internal dependencies into
// <app>/vendor/ainobi and installs those files.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PNPM = 'pnpm@10.5.0';

/** The named packages plus every workspace package they depend on, dependencies first. */
export function packageClosure(names, manifests) {
  const ordered = [];
  const visit = (name) => {
    if (ordered.includes(name)) return;
    const manifest = manifests.get(name);
    if (!manifest) throw new Error(`${name} is not a package in this repository`);
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (String(range).startsWith('workspace:')) visit(dependency);
    }
    ordered.push(name);
  };
  names.forEach(visit);
  return ordered;
}

export function readPackageManifests(root) {
  const manifests = new Map();
  for (const directory of readdirSync(join(root, 'packages'))) {
    const path = join(root, 'packages', directory, 'package.json');
    if (!existsSync(path)) continue;
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifests.set(manifest.name, { ...manifest, directory: join(root, 'packages', directory) });
  }
  return manifests;
}

function run(command, args, cwd) {
  const { status, error } = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (error) throw error;
  if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function main(argv) {
  const catalog = JSON.parse(readFileSync(join(repositoryRoot, 'components.json'), 'utf8'));
  const [profileName] = argv;
  const toIndex = argv.indexOf('--to');
  const profile = catalog.profiles[profileName];
  if (!profile || toIndex === -1 || !argv[toIndex + 1]) {
    console.error('usage: npm run add -- <profile> --to <path to your app>\n\nprofiles:');
    for (const [name, { summary }] of Object.entries(catalog.profiles)) console.error(`  ${name.padEnd(8)} ${summary}`);
    return 2;
  }
  const app = resolve(argv[toIndex + 1]);
  if (!existsSync(join(app, 'package.json'))) {
    console.error(`${app} has no package.json`);
    return 2;
  }
  if (profile.packages.length === 0) {
    console.log(`The ${profileName} profile installs nothing into your app: run \`npm start\` in this repository.`);
    return 0;
  }
  const manifests = readPackageManifests(repositoryRoot);
  const names = packageClosure(profile.packages, manifests);
  const vendor = join(app, 'vendor', 'ainobi');
  mkdirSync(vendor, { recursive: true });
  const tarballs = [];
  for (const name of names) {
    const manifest = manifests.get(name);
    console.log(`[ainobi] packing ${name}`);
    if (manifest.scripts?.build) run('npx', ['--yes', PNPM, '--filter', name, 'build'], repositoryRoot);
    run('npx', ['--yes', PNPM, 'pack', '--pack-destination', vendor], manifest.directory);
    const stem = `${name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
    tarballs.push(join('vendor', 'ainobi', stem).replaceAll('\\', '/'));
  }
  console.log(`[ainobi] installing into ${app}`);
  run('npm', ['install', ...tarballs.map((path) => `./${path}`)], app);
  console.log(`\nInstalled: ${names.join(', ')}`);
  if (profile.services.length > 0) console.log(`This profile talks to a running service: ${profile.services.join(', ')}. See docs/integration.md.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`[ainobi] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
