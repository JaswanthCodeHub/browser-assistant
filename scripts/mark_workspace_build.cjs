const { readFileSync, renameSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const extension = join(root, 'extension');
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'));
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (manifest.version !== metadata.version) throw new Error('Extension and npm versions must match before activating a build.');
const backend = readFileSync(join(root, 'server', 'main.py'), 'utf8');
if (!backend.includes(`version="${manifest.version}"`)) throw new Error('Backend version must match before activating a build.');

// Publish this only after TypeScript has emitted all the new scripts.
const marker = join(extension, 'workspace-release.json');
writeFileSync(marker + '.tmp', JSON.stringify({version: manifest.version}) + '\n', 'utf8');
renameSync(marker + '.tmp', marker);
