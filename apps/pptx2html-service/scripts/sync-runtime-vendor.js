#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'runtime', 'vendor');

// pptx-preview is not copied here: src/static-runtime.js serves it from the installed package,
// as published, so the repository holds no copy of it.
const files = [['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js']];

// The upstream license texts for everything inside the bundle, kept beside it. Each entry is the dependency
// path from this package, the file in that dependency, and its name here. set-immediate-shim ships no license
// file: its readme states the license and is copied instead.
const licenses = [
  [['jszip'], 'LICENSE.markdown', 'jszip-LICENSE.markdown'],
  [['jszip', 'pako'], 'LICENSE', 'pako-LICENSE'],
  [['jszip', 'lie'], 'license.md', 'lie-LICENSE.md'],
  [['jszip', 'lie', 'immediate'], 'LICENSE.txt', 'immediate-LICENSE.txt'],
  [['jszip', 'set-immediate-shim'], 'readme.md', 'set-immediate-shim-README.md'],
];

// Follows a dependency path the way Node resolves it, so hoisted and linked installs both work.
function packageDir(names) {
  let dir = root;
  for (const name of names) {
    let from = fs.realpathSync(dir);
    for (;;) {
      const candidate = path.join(from, 'node_modules', name);
      if (fs.existsSync(candidate)) {
        dir = candidate;
        break;
      }
      const parent = path.dirname(from);
      if (parent === from) return null;
      from = parent;
    }
  }
  return dir;
}

fs.mkdirSync(vendorDir, { recursive: true });

for (const [relSrc, destName] of files) {
  const src = path.join(root, relSrc);
  const dest = path.join(vendorDir, destName);
  if (!fs.existsSync(src)) {
    console.error(`Missing source (run the install): ${relSrc}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${relSrc} -> runtime/vendor/${destName}`);
}

const licenseDir = path.join(vendorDir, 'licenses');
fs.mkdirSync(licenseDir, { recursive: true });

for (const [names, file, destName] of licenses) {
  const dir = packageDir(names);
  const src = dir && path.join(dir, file);
  if (!src || !fs.existsSync(src)) {
    console.error(`Missing license (run the install): ${names.join(' > ')}/${file}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(licenseDir, destName));
  console.log(`Copied ${names.join(' > ')}/${file} -> runtime/vendor/licenses/${destName}`);
}
