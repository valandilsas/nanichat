import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

// Both Windows installers publish to the same GitHub Release with `--clobber`: equal names would overwrite each other.
test('the Electron Windows installer name differs from the Inno Setup one', () => {
  const inno = /OutputBaseFilename=(.+)\{#AppVersion\}/u.exec(read('packaging/windows/SocialDesk.iss'))?.[1];
  const electron = /^\s*artifactName:\s*(\S+)\$\{version\}\.exe\s*$/mu.exec(read('electron-builder.yml'))?.[1];
  assert.ok(inno && electron, 'both installer name prefixes must be found');
  assert.notEqual(electron, inno);
});

test('the desktop workflow uploads the Electron Windows installer under its own name', () => {
  const electron = /^\s*artifactName:\s*(\S+)\$\{version\}\.exe\s*$/mu.exec(read('electron-builder.yml'))?.[1];
  const workflow = read('.github/workflows/desktop-installers.yml');
  assert.ok(electron);
  assert.equal(workflow.includes(`dist/${electron}*.exe`), true);
  assert.equal(workflow.includes('dist/NaniChat-Setup-*.exe'), false);
});
