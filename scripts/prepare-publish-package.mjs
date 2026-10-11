import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory = process.env.PACKAGE_DIRECTORY;
if (!directory) throw new Error('Missing PACKAGE_DIRECTORY');
const path = join(directory, 'package.json');
const pkg = JSON.parse(readFileSync(path, 'utf8'));
// Both public packages are bundled before publishing. Workspace build helpers
// must not be resolved or distributed as part of the published manifest.
delete pkg.devDependencies;
if (pkg.scripts) delete pkg.scripts.prepublishOnly;
writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Prepared bundled publish manifest: ${pkg.name}@${pkg.version}`);
