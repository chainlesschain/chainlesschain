import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const frozen = path.resolve(here, '../verify01-funded-20261027/frozen-debug-workspace');
const relativeFiles = [
  'packages/cli/src/lib/session-history-origins.js',
  'packages/cli/src/lib/context-memory-kernel/message-adapter.js',
  'packages/cli/src/lib/session-message-provenance.js',
  'packages/cli/src/lib/checkpoint-summary-projection.js',
  'packages/cli/src/harness/structured-handoff.js',
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = relativeFiles.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(frozen, file))) }));
const outcomes = [];
for (const variant of ['original', 'mutant']) {
  const destination = path.join(here, variant);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  for (const file of relativeFiles) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(frozen, file), target);
  }
  // Use the actual frozen SDK 0.1.5, not the root installation's newer 0.1.10.
  fs.cpSync(path.join(frozen, 'packages/context-memory-kernel'), path.join(destination, 'node_modules/@chainlesschain/context-memory-kernel'), { recursive: true });
  const source = path.join(destination, relativeFiles[0]);
  if (variant === 'mutant') {
    const body = fs.readFileSync(source, 'utf8');
    const find = 'source?.sourceRef.digest === item.sourceRef.digest &&';
    if (body.split(find).length !== 2) throw new Error('Expected one frozen mutation anchor');
    fs.writeFileSync(source, body.replace(find, 'Boolean(source) &&'));
  }
  const execution = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(here, 'control.test.mjs')], {
    cwd: here,
    env: { ...process.env, VERIFY09_CONTROL_ROOT: destination },
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  fs.writeFileSync(path.join(here, `${variant}.stdout.log`), execution.stdout || '');
  fs.writeFileSync(path.join(here, `${variant}.stderr.log`), execution.stderr || '');
  outcomes.push({ variant, exitCode: execution.status, signal: execution.signal, error: execution.error?.message || null,
    sourceSha256: sha(fs.readFileSync(source)), stdout: `${variant}.stdout.log`, stderr: `${variant}.stderr.log` });
}
const frozenFilesUnchanged = manifest.every(({ file, sha256 }) => sha(fs.readFileSync(path.join(frozen, file))) === sha256);
const originalOutput = fs.readFileSync(path.join(here, 'original.stdout.log'), 'utf8');
const mutantOutput = fs.readFileSync(path.join(here, 'mutant.stdout.log'), 'utf8');
const validated = frozenFilesUnchanged && outcomes[0].exitCode === 0 && outcomes[1].exitCode === 1 &&
  /# pass 2\b/.test(originalOutput) && /# fail 0\b/.test(originalOutput) &&
  /not ok 2 - foreign-session/.test(mutantOutput) && /code: 'ERR_ASSERTION'/.test(mutantOutput) && /# fail 1\b/.test(mutantOutput);
const result = {
  scope: 'operator-only-offline-diagnostic', nativeSample: false, countsTowardAcceptance: false,
  frozenCommit: 'b2aa3aba082873570e85dce39b00754e5504ff37',
  runtime: { node: process.version, platform: process.platform, sdk: JSON.parse(fs.readFileSync(path.join(frozen, 'packages/context-memory-kernel/package.json'), 'utf8')).version },
  limitations: ['Local Node test runner on Windows, not the independent pinned Linux Docker acceptance or native model generation.'],
  frozenFilesUnchanged, manifest, outcomes, validated,
};
fs.writeFileSync(path.join(here, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
process.exitCode = validated ? 0 : 1;
