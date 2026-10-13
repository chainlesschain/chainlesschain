import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listZipEntries, readZipEntry } from '../packages/vscode-extension/scripts/verify-vsix.mjs';
import { verifyJetBrainsRecommendedCli } from './jvm-string-constant.mjs';
import { verifyIdeWorkflowObservation } from './readback-ide-workflow100-final.mjs';
import {preflightPolicies,verifyPreflightGate,selectReleasePreflightRun} from './release100-final-workflow-contract.mjs';
import {readSourceBinding} from './release100-source-freeze.mjs';

const execute = promisify(execFile);
const args = process.argv.slice(2), planOnly = args[0] === '--plan';
if (planOnly) args.shift();
const [kind, sha, version, runId, ...extra] = args;
assert.match(sha || '', /^[a-f0-9]{40}$/u);
const sourceBinding=readSourceBinding(sha);
assert.match(version || '', /^\d+\.\d+\.\d+$/u);
const gitJson = async file => JSON.parse((await execute('git', ['show', `${sha}:${file}`], { encoding: 'utf8', windowsHide: true })).stdout);
const cliVersion = (await gitJson('packages/cli/package.json')).version;
assert(['vscode', 'jetbrains'].includes(kind));
assert.match(runId || '', /^[1-9]\d*$/u);
assert.equal(extra.length, 0);
if (kind === 'vscode') {
  const manifest = await gitJson('packages/vscode-extension/package.json');
  assert.equal(manifest.version, version); assert.equal(manifest.chainlesschain.recommendedCliVersion, cliVersion);
} else {
  const { stdout: xml } = await execute('git', ['show', `${sha}:packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`], { encoding: 'utf8', windowsHide: true });
  assert(xml.includes(`<version>${version}</version>`));
  const { stdout: pin } = await execute('git', ['show', `${sha}:packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/CliVersionCheck.java`], { encoding: 'utf8', windowsHide: true });
  assert(pin.includes(`RECOMMENDED_CLI_VERSION = "${cliVersion}"`));
}
if (planOnly) {
  console.log(JSON.stringify({ status: 'PREPARED_PUBLIC_NOT_VERIFIED', kind, sha, version, cliVersion, runId,
    source: 'Digest-bound exact-run Actions candidate, independently downloaded', sourceBinding, pendingIsPublic: false }));
  process.exit(0);
}
const tag = `ide-${kind}-v${version}`;
const channel = kind === 'vscode' ? 'open-vsx' : 'jetbrains';
const root = path.resolve(`.work/release-readback-${cliVersion}/${kind}-verified-${runId}-${sha}/public-${new Date().toISOString().replaceAll(':', '-')}`);
fs.mkdirSync(path.dirname(root), {recursive:true});
fs.mkdirSync(root); // Refuse to overwrite any previous readback attempt.
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const save = (name, bytes) => fs.writeFileSync(path.join(root, name), bytes, { flag: 'wx' });
const json = (name, value) => save(name, JSON.stringify(value, null, 2) + '\n');
json('invocation.json', { kind, runId, sha, version, cliVersion, tag, sourceBinding, helperSha256: hash(fs.readFileSync(new URL(import.meta.url))), workflowGuardSha256: hash(fs.readFileSync(new URL('./readback-ide-workflow100-final.mjs',import.meta.url))), classParserSha256: hash(fs.readFileSync(new URL('./jvm-string-constant.mjs',import.meta.url))), startedAt: new Date().toISOString() });
try {
  const { stdout: runBytes } = await execute('gh', ['api', `repos/chainlesschain/chainlesschain/actions/runs/${runId}?cc_nonce=${Date.now()}`], { encoding: 'buffer', windowsHide: true, timeout: 60000 });
  save('run.raw.json', runBytes);
  const run = JSON.parse(runBytes);
  assert.equal(String(run.id), runId);
  assert.equal(run.head_sha, sha);
  assert.equal(run.event, 'push');
  assert.equal(run.head_branch, tag);
  assert.equal(run.path, '.github/workflows/ide-extensions.yml');
  const { stdout: jobsBytes } = await execute('gh', ['api', `repos/chainlesschain/chainlesschain/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`], {encoding:'buffer', windowsHide:true, timeout:60000, maxBuffer:8*1024*1024});
  save('jobs.raw.json',jobsBytes);
  const workflowObservation=verifyIdeWorkflowObservation(run,JSON.parse(jobsBytes),{kind,sha,version,runId});
  const preflight=[];
  for(const policy of preflightPolicies) {
    const {stdout:runsBytes}=await execute('gh',['api',`repos/chainlesschain/chainlesschain/actions/workflows/${policy.workflow}/runs?head_sha=${sha}&per_page=100`],{encoding:'buffer',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
    save(`preflight-${policy.workflow}-runs.json`,runsBytes);
    const payload=JSON.parse(runsBytes);
    assert.equal(payload.workflow_runs.length,payload.total_count,'Preflight run pagination required');
    const selected=selectReleasePreflightRun(payload.workflow_runs,policy,sha);
    assert(selected,`Missing exact-SHA preflight: ${policy.name}`);
    const {stdout:gateJobsBytes}=await execute('gh',['api',`repos/chainlesschain/chainlesschain/actions/runs/${selected.id}/attempts/${selected.run_attempt}/jobs?per_page=100`],{encoding:'buffer',windowsHide:true,timeout:60000,maxBuffer:8*1024*1024});
    save(`preflight-${policy.workflow}-jobs.json`,gateJobsBytes);
    const gateJobs=JSON.parse(gateJobsBytes); assert.equal(gateJobs.jobs.length,gateJobs.total_count);
    const {stdout:workflowSource}=await execute('git',['show',`${sha}:.github/workflows/${policy.workflow}`],{encoding:'utf8',windowsHide:true});
    save(`preflight-${policy.workflow}-source.yml`,workflowSource);
    preflight.push(verifyPreflightGate(selected,gateJobs.jobs,policy,sha,workflowSource));
  }
  json('preflight-readback.json',preflight);
  const { stdout: listingBytes } = await execute('gh', ['api', `repos/chainlesschain/chainlesschain/actions/runs/${runId}/artifacts?per_page=100`], {encoding:'buffer', windowsHide:true, timeout:60000});
  save('artifacts.raw.json', listingBytes);
  const listing=JSON.parse(listingBytes);
  assert(listing.total_count <= 100, 'Artifact pagination required');
  const artifacts=listing.artifacts.filter(row => kind === 'vscode' ? row.name === 'chainlesschain-ide-vscode-candidate' : row.name === `chainlesschain-ide-jetbrains-${run.run_attempt}`);
  assert.equal(artifacts.length,1,'Missing/duplicate IDE candidate');
  const artifact=artifacts[0];
  assert.equal(artifact.expired,false);
  assert.equal(artifact.workflow_run.head_sha,sha);
  assert.equal(String(artifact.workflow_run.id),runId);
  const { stdout: archive }=await execute('gh',['api',`repos/chainlesschain/chainlesschain/actions/artifacts/${artifact.id}/zip`], {encoding:'buffer',windowsHide:true,timeout:60000,maxBuffer:256*1024*1024});
  assert.equal('sha256:'+hash(archive),artifact.digest);
  save('actions-artifact.zip',archive);
  artifact.zipDigest=artifact.digest;
  const entries=listZipEntries(archive);
  const candidates=[...entries.keys()].filter(name=>name.endsWith(kind==='vscode'?'.vsix':'.zip'));
  assert.equal(candidates.length,1);
  const entryName=candidates[0];
  const payload=readZipEntry(archive,entries.get(entryName));
  const file={name:entryName,sha256:hash(payload)};
  const artifactPath=path.join(root,kind==='vscode'?'candidate.vsix':'candidate.zip');
  fs.writeFileSync(artifactPath,payload,{flag:'wx'});
  json('artifact-readback.json',{sha,run,artifacts:[{...artifact,files:[file]}]});
  const local = fs.readFileSync(artifactPath);
  assert.equal(hash(local), file.sha256);
  const report = { observedAt: new Date().toISOString(), sourceCommit: sha, tag, cliVersion, version, workflowObservation, tagWorkflow: { id: run.id, attempt: run.run_attempt, status:run.status, conclusion: run.conclusion, url: run.html_url }, artifact: { name: artifact.name, file: file.name, zipDigest: artifact.zipDigest, bytes: local.length, sha256: hash(local) } };
  const localEntries = listZipEntries(local);
  if (kind === 'vscode') {
    const packaged = JSON.parse(readZipEntry(local, localEntries.get('extension/package.json')));
    assert.equal(packaged.version, version);
    assert.equal(packaged.publisher, 'chainlesschain');
    assert.equal(packaged.chainlesschain.recommendedCliVersion, cliVersion);
    const versionCheck = readZipEntry(local, localEntries.get('extension/src/version-check.js'));
    const { stdout: expectedVersionCheck } = await execute('git', ['show', `${sha}:packages/vscode-extension/src/version-check.js`], { encoding: 'buffer', windowsHide: true });
    assert(versionCheck.equals(expectedVersionCheck));
    assert.match(versionCheck.toString('utf8'), /const RECOMMENDED_CLI_VERSION\s*=\s*require\("\.\.\/package\.json"\)\.chainlesschain\.recommendedCliVersion;/u);
    report.packagedPlugin = { version, pairedCliVersion: cliVersion, tagArtifactSha256: hash(local), versionCheckSourceMatchesReleaseBlob: true };
  } else {
    const jarNames = [...localEntries.keys()].filter(name => name.endsWith(`/chainlesschain-ide-bridge-${version}.jar`));
    assert.equal(jarNames.length, 1);
    const jar = readZipEntry(local, localEntries.get(jarNames[0]));
    const entries = listZipEntries(jar);
    const xml = readZipEntry(jar, entries.get('META-INF/plugin.xml')).toString('utf8');
    assert(xml.includes(`<version>${version}</version>`));
    const classBytes = readZipEntry(jar, entries.get('com/chainlesschain/ide/CliVersionCheck.class'));
    const classPin = verifyJetBrainsRecommendedCli(classBytes, cliVersion);
    report.packagedPlugin = { version, pairedCliVersion: cliVersion, tagArtifactSha256: hash(local), classSha256: hash(classBytes), classPin };
  }
  const args = ['scripts/verify-ide-marketplace.mjs', channel, version, ...(kind === 'vscode' ? ['--artifact', artifactPath] : ['--allow-pending'])];
  const { stdout, stderr } = await execute(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CC_MARKETPLACE_VERIFY_ATTEMPTS: '1', CC_OPEN_VSX_LISTING_VERIFY_ATTEMPTS: '1' } });
  save('marketplace-verifier.stdout', stdout);
  save('marketplace-verifier.stderr', stderr);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.version, version);
  Object.assign(report, result);
  if (!workflowObservation.workflowComplete) {
    assert.equal(kind,'jetbrains');
    assert(['ready','pending'].includes(result.status));
    report.marketplaceObservedStatus=result.status;
    report.status='pending';
    report.publicationState='PENDING_NOT_PUBLIC';
    report.publicPackage=null;
    report.boundary='Publisher and every non-post job passed; post-publish verification remains incomplete. This observation does not establish public release completion.';
    json('public-readback.json',report);
    console.log(JSON.stringify({root,kind,version,status:'pending',publicationState:report.publicationState,downloadable:false,sha}));
    process.exit(0);
  }
  async function download(url, name) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'Cache-Control': 'no-cache' } });
    assert(response.ok, `HTTP ${response.status} ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    save(name, bytes);
    return bytes;
  }
  if (kind === 'vscode') {
    assert.equal(result.status, 'ready');
    const metadata = JSON.parse(await download(`${result.endpoint}/${version}`, 'open-vsx-exact-metadata.json'));
    assert.equal(metadata.version, version);
    assert.equal(metadata.downloadable, true);
    const bytes = await download(metadata.files.download, 'public.vsix');
    assert.equal(hash(bytes), result.registryArchiveSha256);
    report.publicPackage = { url: metadata.files.download, sha256: hash(bytes), bytes: bytes.length, canonicalContentSha256: result.contentSha256, archiveExactMatch: local.equals(bytes) };
  } else {
    const updates = JSON.parse(await download(result.endpoint, 'jetbrains-updates.json'));
    const update = updates.find(row => row.version === version);
    report.publicUpdate = update || null;
    if (result.status === 'ready') {
      assert(update);
      assert.equal(update.approve, true);
      assert.equal(update.listed, true);
      assert.equal(update.hidden, false);
      const url = `https://plugins.jetbrains.com/plugin/download?rel=true&updateId=${update.id}`;
      const bytes = await download(url, 'public.zip');
      const publicEntries = listZipEntries(bytes);
      assert.deepEqual([...publicEntries.keys()].sort(), [...localEntries.keys()].sort());
      const matched = [];
      for (const [name, entry] of localEntries) {
        const left = readZipEntry(local, entry);
        assert(left.equals(readZipEntry(bytes, publicEntries.get(name))), `Marketplace payload differs: ${name}`);
        matched.push({ name, bytes: left.length, sha256: hash(left) });
      }
      report.publicPackage = { url, sha256: hash(bytes), bytes: bytes.length, archiveExactMatch: local.equals(bytes), allEntryBytesMatch: true, entries: matched };
    } else { assert.equal(result.status, 'pending'); report.publicPackage = null; report.publicationState = 'PENDING_NOT_PUBLIC'; }
  }
  json('public-readback.json', report);
  console.log(JSON.stringify({ root, kind, version, status: report.status, updateId: report.publicUpdate?.id || null, downloadable: !!report.publicPackage, sha }));
} catch (error) {
  if (error.stdout != null) save('failed-child.stdout', error.stdout);
  if (error.stderr != null) save('failed-child.stderr', error.stderr);
  json('failure.json', { at: new Date().toISOString(), status: 'NOT_VERIFIED', message: error.message, stack: error.stack });
  throw error;
}
