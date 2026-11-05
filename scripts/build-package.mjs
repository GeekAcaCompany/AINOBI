#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Builds a public component package into dist/ for publication: run from the package directory
// (`pnpm --filter <name> build`). The workspace keeps importing src/ through package.json
// `exports`; dist/ is what `publishConfig.exports` points at when the package is packed.
//
// Steps: compile with the package's tsconfig.build.json (JS, declarations, source maps), then
// rewrite the specifiers that only work inside the workspace:
//   - relative `./x.ts` imports in declaration files become `./x.js` (tsc rewrites them only
//     in emitted JS);
//   - `@ainobi/<pkg>/<path>.ts` subpath imports become the extensionless public subpath
//     `@ainobi/<pkg>/<path>` in both JS and declarations.
// The build fails when an emitted relative import has no extension, because Node's ESM
// resolver cannot load it.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const packageDir = process.cwd();
const distDir = join(packageDir, 'dist');
if (!existsSync(join(packageDir, 'tsconfig.build.json'))) {
  console.error(`build-package: no tsconfig.build.json in ${packageDir}`);
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
// typescript does not export bin/tsc; resolve it next to its package.json (as scripts/typecheck.mjs does)
const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: packageDir, stdio: 'inherit' });

// tsc copies JSON modules but not stylesheets, which compiled modules still import.
const sourceDir = join(packageDir, 'src');
if (existsSync(sourceDir)) {
  for (const file of readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.css')) continue;
    mkdirSync(dirname(join(distDir, file)), { recursive: true });
    copyFileSync(join(sourceDir, file), join(distDir, file));
  }
}

const files = (function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
})(distDir);

// from "x", import("x"), export ... from "x", and bare side-effect imports
const specifierPattern = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;
const problems = [];
for (const file of files) {
  const isDeclaration = file.endsWith('.d.ts');
  if (!isDeclaration && !file.endsWith('.js')) continue;
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(specifierPattern, (match, lead, quote, specifier) => {
    let next = specifier;
    if (/^@ainobi\/[^/]+\/.+\.ts$/.test(next)) {
      next = next.slice(0, -'.ts'.length);
    } else if (isDeclaration && /^\.\.?\/.+\.tsx?$/.test(next) && !next.endsWith('.d.ts')) {
      next = next.replace(/\.tsx?$/, '.js');
    }
    if (/^\.\.?\//.test(next) && !/\.(m?js|json|css)$/.test(next)) {
      problems.push(`${relative(packageDir, file)}: "${next}" has no extension`);
    }
    return `${lead}${quote}${next}${quote}`;
  });
  if (rewritten !== source) writeFileSync(file, rewritten);
}

if (problems.length > 0) {
  console.error(`build-package: unresolvable relative imports in ${relative(process.cwd(), distDir)}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
