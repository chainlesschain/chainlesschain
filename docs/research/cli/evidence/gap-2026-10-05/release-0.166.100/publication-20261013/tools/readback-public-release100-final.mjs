import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { list as listTarball } from "tar";
import {verifyNpmPublicationJobs,preflightPolicies,verifyPreflightGate,workflowSourceHashes} from './release100-final-workflow-contract.mjs';
import { listZipEntries, readZipEntry } from "../packages/vscode-extension/scripts/verify-vsix.mjs";
import { verifyReleaseArtifact } from "../packages/cli/scripts/npm-release-artifact.mjs";
import { verifyCliRegistryInstall } from "../packages/cli/scripts/verify-cli-registry-install.mjs";
import {readSourceBinding} from './release100-source-freeze.mjs';

export const defaultBaseline=fileURLToPath(new URL('./release-readback-0.166.99/verified-38231920482-311e01a5ec34a8e433c7abde0e4b6b05bce4513b/public-2026-10-12T10-08-52.570Z/public-authority-readback.json',import.meta.url));
export const releaseCandidateSha=readSourceBinding().sourceCommit;
const baselineSha='311e01a5ec34a8e433c7abde0e4b6b05bce4513b';
const baselineDigest='461ebfef3c50488b67f72fa38e9126758067567255f34655a712b0eacf26b8d9';
const repository = "https://github.com/chainlesschain/chainlesschain";
const registry = "https://registry.npmjs.org";
const workflow = ".github/workflows/npm-publish.yml";
const childDirectories = ["agent-protocol", "core-env", "core-mtc", "core-multisig", "core-settlement", "shared-logger", "core-config", "core-db", "core-infra", "session-core", "context-memory-kernel", "agent-sdk", "personal-data-hub"];
const digest = (bytes, algorithm = "sha256", encoding = "hex") => crypto.createHash(algorithm).update(bytes).digest(encoding);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const git = args => execFileSync("git", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
const tag = version => `refs/tags/v-npm-${version.replaceAll(".", "-")}`;

export function validateProof(proof, expected) {
  assert.equal(proof.schema, 1);
  for (const key of ["package", "version", "sha512"]) assert.equal(proof[key], expected[key], key);
  assert.equal(proof.repository, repository);
  assert.equal(proof.workflow, workflow);
  assert.equal(proof.builder, "https://github.com/actions/runner/github-hosted");
  assert.equal(proof.verifier, "npm audit signatures --include-attestations");
  assert.equal(proof.audit?.invalid, 0);
  assert.match(proof.commit, /^[a-f0-9]{40}$/u);
  assert.match(proof.ref, /^refs\/tags\/v-npm-\d+-\d+-\d+$/u);
  assert(Number.isSafeInteger(proof.runId) && proof.runId > 0);
  assert(Number.isSafeInteger(proof.attempt) && proof.attempt > 0);
  assert.equal(proof.invocationId, `${repository}/actions/runs/${proof.runId}/attempts/${proof.attempt}`);
  if(expected.requireTrustedReuse) {
    assert.equal(proof.anchorMode,'trusted-reuse');
    assert.notEqual(proof.commit,expected.sha);
    if(expected.baselineAnchor) assert.equal(proof.commit,expected.baselineAnchor);
    if(expected.baselineProvenance) for(const key of ['commit','ref','runId','attempt','invocationId']) {
      assert.equal(proof[key],expected.baselineProvenance[key],`Reused signed anchor ${key} changed`);
    }
  }
  if (expected.requireExactRelease || expected.package === "chainlesschain" || proof.anchorMode === "exact-release") {
    assert.equal(proof.anchorMode, "exact-release");
    assert.equal(proof.commit, expected.sha);
    assert.equal(proof.ref, tag(expected.releaseVersion));
    assert.equal(String(proof.runId), expected.runId);
  } else {
    assert.equal(proof.anchorMode, "trusted-reuse");
    assert.equal(proof.reuse?.currentCommit, expected.sha);
    assert.equal(proof.reuse?.anchorCommit, proof.commit);
    assert.equal(proof.reuse?.anchorRef, proof.ref);
    assert.equal(proof.reuse?.packagePath, expected.packagePath);
    assert.equal(proof.reuse?.anchorTree, expected.currentTree);
    assert.equal(proof.reuse?.currentTree, expected.currentTree);
    assert.equal(expected.anchorTree, expected.currentTree);
  }
  // Registry gitHead belongs to the published package's signed anchor, not
  // necessarily to the CLI release that reuses that package.
  if (expected.registryGitHead != null) assert.equal(expected.registryGitHead, proof.commit);
  return { anchorMode: proof.anchorMode, publishedCommit: proof.commit, releaseCommit: expected.sha, runId: proof.runId };
}

export function validateKernelProvenance(proof, child, expected) {
  assert.equal(child.name,'@chainlesschain/context-memory-kernel');
  assert.equal(child.packagePath,'packages/context-memory-kernel');
  assert.match(proof.sha512,/^[a-f0-9]{128}$/u);
  assert.equal(proof.anchorMode,'trusted-reuse','Kernel must retain its prior signed publication anchor');
  return validateProof(proof,{...expected,package:child.name,version:child.version,
    sha512:expected.sha512??proof.sha512,requireTrustedReuse:true,
    packagePath:child.packagePath,currentTree:child.currentTree,baselineAnchor:child.baselineAnchor,baselineProvenance:child.baselineProvenance});
}

export function validatePublicArchive(metadata, bytes, expected) {
  assert.equal(metadata.name, expected.name);
  assert.equal(metadata.version, expected.version);
  const leaf = expected.name.split("/").at(-1);
  assert.equal(metadata.dist?.tarball, `${registry}/${expected.name}/-/${leaf}-${expected.version}.tgz`);
  assert.equal(metadata.dist.integrity, `sha512-${digest(bytes, "sha512", "base64")}`);
  assert.equal(metadata.dist.shasum, digest(bytes, "sha1"));
  if (expected.sha512) assert.equal(digest(bytes, "sha512"), expected.sha512);
  return { name: expected.name, version: expected.version, url: metadata.dist.tarball, integrity: metadata.dist.integrity, sha512: digest(bytes, "sha512"), sha256: digest(bytes), bytes: bytes.length, registryGitHead: metadata.gitHead ?? null };
}

export function validateLockEntry(entry, metadata) {
  assert(entry && !entry.link, "Registry package cannot be a workspace link");
  assert.equal(entry.version, metadata.version);
  assert.equal(entry.resolved, metadata.dist.tarball);
  assert.equal(entry.integrity, metadata.dist.integrity);
}

export function plan(sha, version, runId, summaryFile = defaultBaseline) {
  assert.match(sha ?? "", /^[a-f0-9]{40}$/u);
  assert.match(version ?? "", /^\d+\.\d+\.\d+$/u);
  assert.match(runId ?? "", /^[1-9]\d*$/u);
  const cli = JSON.parse(git(["show", `${sha}:packages/cli/package.json`]));
  assert.equal(cli.name, "chainlesschain"); assert.equal(cli.version, version);
  const sourceBinding=readSourceBinding(sha);
  assert.equal(version,'0.166.100');
  for(const [file,hash] of Object.entries(workflowSourceHashes)) {
    assert.equal(digest(execFileSync('git',['show',`${sha}:${file}`])),hash,`Workflow source changed: ${file}`);
  }
  const baselineBytes = fs.readFileSync(summaryFile);
  assert.equal(digest(baselineBytes),baselineDigest,'Unrecognized prior verified readback');
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.schema,'chainlesschain.public-release-readback/v4');
  assert.equal(baseline.status,'VERIFIED'); assert.equal(baseline.sha,baselineSha);
  assert.equal(baseline.version,'0.166.99'); assert.equal(String(baseline.runId),'38231920482');
  assert.equal(baseline.children.length,13); assert.equal(baseline.archives.length,14);
  assert.equal(new Set(baseline.children.map(row=>row.name)).size,13);
  const children = childDirectories.map(directory => {
    const packagePath = `packages/${directory}`;
    const manifest = JSON.parse(git(['show',`${sha}:${packagePath}/package.json`]));
    assert.equal(manifest.name,`@chainlesschain/${directory}`);
    const previous=baseline.children.find(row=>row.name===manifest.name);
    const archive=baseline.archives.find(row=>row.name===manifest.name);
    assert(previous&&archive,'Missing child baseline');
    assert.equal(previous.version,manifest.version); assert.equal(archive.version,manifest.version);
    const currentTree=git(['rev-parse',`${sha}:${packagePath}`]);
    assert.equal(previous.packagePath,packagePath);
    assert.equal(currentTree,previous.currentTree,'Candidate child tree changed');
    assert.equal(currentTree,git(['rev-parse',`${baselineSha}:${packagePath}`]));
    assert.match(archive.sha512,/^[a-f0-9]{128}$/u); assert.equal(previous.sha512,archive.sha512);
    const stem=`chainlesschain-${directory}-${manifest.version}`;
    const archiveRoot=path.join(path.dirname(summaryFile),'public');
    const meta=read(path.join(archiveRoot,stem+'.metadata.json'));
    const bytes=fs.readFileSync(path.join(archiveRoot,stem+'.tgz'));
    validatePublicArchive(meta,bytes,{name:manifest.name,version:manifest.version,sha512:archive.sha512});
    assert.equal(meta.gitHead??null,archive.registryGitHead);
    const priorProof=baseline.proofs.find(row=>row.name===manifest.name)?.proof;
    const baselineAnchor=priorProof?.commit??archive.registryGitHead??null;
    if(baselineAnchor) assert.equal(currentTree,git(['rev-parse',`${baselineAnchor}:${packagePath}`]));
    return {name:manifest.name,version:manifest.version,directory,packagePath,currentTree,
      sourceMode:'trusted-reuse-unchanged-source-tree-and-prior-verified-public-bytes',
      sha512:archive.sha512,baselineCommit:baselineSha,baselineAnchor,baselineGitHead:archive.registryGitHead,
      baselineProvenance:priorProof?Object.fromEntries(['commit','ref','runId','attempt','invocationId'].map(key=>[key,priorProof[key]])):null,
      ...(directory==='session-core'?{candidateArchive:`children/chainlesschain-session-core-${manifest.version}.tgz`}:{}),
      ...(directory==='context-memory-kernel'?{provenanceFile:'context-memory-kernel-npm-provenance.json'}:{})};
  });
  for (const [name, pin] of Object.entries(cli.dependencies).filter(([name]) => name.startsWith("@chainlesschain/"))) {
    assert.equal(children.find(child => child.name === name)?.version, pin, `CLI dependency differs: ${name}`);
  }
  return { sha, version, runId, cli, children, baselineBytes, sourceBinding };
}

export async function bindSessionCandidate(file, sha, child) {
  assert.equal(child.packagePath, "packages/session-core");
  return bindPackedChildSource(file,sha,child);
}

export async function bindPackedChildSource(file, sha, child) {
  assert.match(sha, /^[a-f0-9]{40}$/u);
  assert(['packages/session-core','packages/context-memory-kernel'].includes(child.packagePath));
  const label=child.packagePath==='packages/session-core'?'Session Core':'Context Memory Kernel';
  assert.equal(child.currentTree, git(["rev-parse", `${sha}:${child.packagePath}`]));
  const archive = fs.readFileSync(file);
  assert(archive.length > 0 && archive.length < 32 * 1024 * 1024);
  const tree = new Map(git(["ls-tree", "-r", "-z", `${sha}:${child.packagePath}`]).split("\0").filter(Boolean).map(row => {
    const match = row.match(/^([0-9]+) blob ([a-f0-9]{40})\t(.+)$/u);
    assert(match && ["100644", "100755"].includes(match[1]), "Unexpected source tree entry");
    return [match[3], match[2]];
  }));
  const files = [], seen = new Set(), pending = [];
  await listTarball({ file, strict: true, onReadEntry(entry) {
    assert(["File", "OldFile", "Directory"].includes(entry.type), "Unexpected tar entry type");
    assert(!/[\\:\0]/u.test(entry.path) && entry.path.startsWith("package/"));
    if (entry.type === "Directory") return;
    const relative = entry.path.slice("package/".length);
    assert(!relative.split("/").some(part => ["", ".", ".."].includes(part)));
    assert(!seen.has(relative), "Duplicate package entry"); seen.add(relative);
    assert(entry.size <= 8 * 1024 * 1024);
    pending.push(new Promise((resolve, reject) => {
      const chunks = []; entry.on("data", chunk => chunks.push(chunk)); entry.on("error", reject);
      entry.on("end", () => {
        try {
          const bytes = Buffer.concat(chunks);
          const gitBlob = digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1");
          assert.equal(gitBlob, tree.get(relative), `${label} source differs: ${relative}`);
          files.push({ path: relative, bytes: bytes.length, sha256: digest(bytes), gitBlob });
          resolve();
        } catch (error) { reject(error); }
      });
    }));
    pending.at(-1).catch(() => {}); // Collect failures after the archive reader settles.
  }});
  await Promise.all(pending);
  const manifest = JSON.parse(git(["show", `${sha}:${child.packagePath}/package.json`]));
  assert.equal(manifest.name, child.name); assert.equal(manifest.version, child.version);
  const required = git(["ls-tree", "-r", "--name-only", sha, `${child.packagePath}/lib`]).split("\n").map(name => name.slice(child.packagePath.length + 1));
  assert(required.length > 0);
  for (const name of ["package.json", ...required]) assert(seen.has(name), `Candidate omits ${name}`);
  return { package: child.name, version: child.version, releaseCommit: sha, sourceTree: child.currentTree,
    sourceMode: child.sourceMode, candidateArchive: child.candidateArchive, sha512: digest(archive, "sha512"),
    sha256: digest(archive), bytes: archive.length, manifest, files: files.sort((a,b) => a.path.localeCompare(b.path)),
    signatureAudit: "NOT_SEPARATELY_PERFORMED", allPackedFilesMatchGitBlobs: true };
}

async function collect(input) {
  const { sha, version, runId, cli, children } = input;
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const root = path.resolve(`.work/release-readback-${version}/verified-${runId}-${sha}/public-${stamp}`);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(root); // Refuse to overwrite or silently reuse a previous attempt.
  fs.writeFileSync(path.join(root, "baseline-public-readback.json"), input.baselineBytes, { flag: "wx" });
  write(path.join(root, "invocation.json"), { sha, version, runId, startedAt: new Date().toISOString(), helperSha256: digest(fs.readFileSync(fileURLToPath(import.meta.url))), workflowContractSha256:digest(fs.readFileSync(new URL('./release100-final-workflow-contract.mjs',import.meta.url))), baselineSha256:digest(input.baselineBytes) });
  const api = (endpoint, file) => {
    const separator = endpoint.includes("?") ? "&" : "?";
    const freshEndpoint = `${endpoint}${separator}cc_release_readback=${Date.now()}`;
    const bytes = execFileSync("gh", ["api", `repos/chainlesschain/chainlesschain/${freshEndpoint}`], { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    fs.writeFileSync(path.join(root, file), bytes, { flag: "wx" }); return bytes;
  };
  try {
    const run = JSON.parse(api(`actions/runs/${runId}`, "run.raw.json"));
    assert.equal(String(run.id), runId); assert.equal(run.head_sha, sha);
    assert.equal(run.path, workflow); assert.equal(run.event, "push");
    assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success");
    assert.equal(run.head_branch, tag(version).slice("refs/tags/".length));
    const sourceWorkflow=git(['show',`${sha}:${workflow}`]);
    fs.writeFileSync(path.join(root,'npm-publish.source.yml'),sourceWorkflow,{flag:'wx'});
    const publishJobs=JSON.parse(api(`actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,'publish-jobs.raw.json'));
    assert.equal(publishJobs.jobs.length,publishJobs.total_count);
    const publicationJobs=verifyNpmPublicationJobs(run,publishJobs.jobs,{sha,version,runId},sourceWorkflow);
    write(path.join(root,'publication-job-contract.json'),publicationJobs);
    const listing = JSON.parse(api(`actions/runs/${runId}/artifacts?per_page=100`, "artifacts.raw.json"));
    assert(listing.total_count <= 100, "Artifact list needs explicit pagination");
    const names = [`chainlesschain-npm-${sha}`, `chainlesschain-npm-readback-${sha}`, `cli-release-gate-${sha}`];
    const evidence = [];
    for (const name of names) {
      const matches = listing.artifacts.filter(row => row.name === name);
      assert.equal(matches.length, 1, `Missing/duplicate artifact: ${name}`);
      const artifact = matches[0]; assert.equal(artifact.expired, false);
      assert.equal(artifact.workflow_run.head_sha, sha);
      assert.equal(String(artifact.workflow_run.id), runId);
      const bytes = api(`actions/artifacts/${artifact.id}/zip`, `${name}.zip`);
      assert.equal(`sha256:${digest(bytes)}`, artifact.digest);
      const directory = path.join(root, name); fs.mkdirSync(directory);
      const files = [];
      for (const [entryName, entry] of listZipEntries(bytes)) {
        if (entryName.endsWith("/")) continue;
        assert(!/[\\:]/u.test(entryName) && !entryName.startsWith("/") && !entryName.split("/").some(part => ["", ".", ".."].includes(part)));
        const target = path.resolve(directory, entryName); assert(target.startsWith(directory + path.sep));
        const payload = readZipEntry(bytes, entry);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, payload, { flag: "wx" });
        files.push({ name: entryName, bytes: payload.length, sha256: digest(payload) });
      }
      evidence.push({ ...artifact, files });
    }
    write(path.join(root, "artifact-readback.json"), { sha, version, runId, artifacts: evidence });
    const gateReceipt=read(path.join(root,names[2],'cli-release-gate.json'));
    assert.equal(gateReceipt.schema,1); assert.equal(gateReceipt.sha,sha);
    assert.equal(gateReceipt.repository,'chainlesschain/chainlesschain'); assert.equal(gateReceipt.gates.length,2);
    const releaseGateReadback=[];
    for(const policy of preflightPolicies.slice(0,2)) {
      const matches=gateReceipt.gates.filter(g=>g.workflow===policy.workflow);
      assert.equal(matches.length,1); const gate=matches[0];
      assert.equal(gate.sha,sha); assert.equal(gate.name,policy.name); assert.equal(gate.conclusion,'success');
      assert.deepEqual([...gate.platforms].sort(),['linux','macos','windows']);
      const gateRun=JSON.parse(api(`actions/runs/${gate.runId}`,`gate-${gate.runId}-run.json`));
      const gateJobs=JSON.parse(api(`actions/runs/${gate.runId}/attempts/${gateRun.run_attempt}/jobs?per_page=100`,`gate-${gate.runId}-jobs.json`));
      assert.equal(gateJobs.jobs.length,gateJobs.total_count);
      releaseGateReadback.push(verifyPreflightGate(gateRun,gateJobs.jobs,policy,sha));
    }
    write(path.join(root,'release-gates-independent-readback.json'),releaseGateReadback);
    const candidate = path.join(root, names[0]), authority = path.join(root, names[1]);
    const manifest = read(path.join(candidate, "chainlesschain-release.json"));
    assert.equal(manifest.version, version); assert.equal(manifest.commit, sha);
    assert.equal(manifest.artifact, `chainlesschain-${version}.tgz`);
    await verifyReleaseArtifact(path.join(candidate, manifest.artifact), manifest, { version, commit: sha });
    assert.deepEqual(read(path.join(authority, "chainlesschain-release.json")), manifest);
    const session = children.find(row => row.directory === "session-core");
    const sessionCandidate = path.join(authority, session.candidateArchive);
    const sessionBinding = await bindSessionCandidate(sessionCandidate, sha, session);
    assert.equal(session.sha512,sessionBinding.sha512,'Repacked Session Core differs from prior verified public bytes');
    write(path.join(root, "session-core-candidate-source.json"), sessionBinding);
    const kernel=children.find(row=>row.directory==='context-memory-kernel');
    const kernelProof=read(path.join(authority,kernel.provenanceFile));
    const kernelAnchorTree=git(['rev-parse',`${kernelProof.commit}:${kernel.packagePath}`]);
    const kernelProvenance=validateKernelProvenance(kernelProof,kernel,{sha,releaseVersion:version,runId,sha512:kernel.sha512,anchorTree:kernelAnchorTree});
    let kernelBinding=null;
    const publicDirectory = path.join(root, "public"); fs.mkdirSync(publicDirectory);
    const fetchBytes = async (url, file) => {
      assert.equal(new URL(url).origin, registry);
      const freshUrl = new URL(url);
      freshUrl.searchParams.set("cc_release_readback", String(Date.now()));
      const response = await fetch(freshUrl, { redirect: "error", signal: AbortSignal.timeout(60000), headers: { "Cache-Control": "no-cache" } });
      assert(response.ok, `Public readback unavailable: HTTP ${response.status} ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer()); fs.writeFileSync(file, bytes, { flag: "wx" }); return bytes;
    };
    const metadata = new Map(), archives = [];
    for (const expected of [{ name: "chainlesschain", version, sha512: manifest.sha512 }, ...children]) {
      const stem = expected.name.replace(/^@/u, "").replaceAll("/", "-") + "-" + expected.version;
      const meta = JSON.parse(await fetchBytes(`${registry}/${encodeURIComponent(expected.name)}/${expected.version}`, path.join(publicDirectory, `${stem}.metadata.json`)));
      const leaf = expected.name.split("/").at(-1);
      const url = `${registry}/${expected.name}/-/${leaf}-${expected.version}.tgz`;
      assert.equal(meta.dist?.tarball, url);
      const archiveFile = path.join(publicDirectory, `${stem}.tgz`);
      const bytes = await fetchBytes(url, archiveFile);
      if(expected.baselineCommit) assert.equal(meta.gitHead??null,expected.baselineGitHead,'Reused registry gitHead changed');
      archives.push(validatePublicArchive(meta, bytes, expected)); metadata.set(expected.name, meta);
      if (expected.name === session.name) {
        assert(bytes.equals(fs.readFileSync(sessionCandidate)), "Public reused Session Core differs from OIDC workflow candidate");
        assert.equal(meta.gitHead??null,session.baselineGitHead,"Session Core registry gitHead differs from prior publication");
        assert.deepEqual(meta.dependencies, sessionBinding.manifest.dependencies);
      }
      if(expected.name===kernel.name) {
        validateKernelProvenance(kernelProof,kernel,{sha,releaseVersion:version,runId,attempt:run.run_attempt,
          sha512:digest(bytes,'sha512'),registryGitHead:meta.gitHead,anchorTree:kernelAnchorTree});
        kernelBinding=await bindPackedChildSource(archiveFile,sha,kernel);
        assert.equal(kernelBinding.sha512,kernelProof.sha512);
        kernelBinding.signatureAudit='DIGEST_BOUND_WORKFLOW_SIGNATURE_AUDIT_RECEIPT';
        kernelBinding.provenance=kernelProvenance;
        assert.deepEqual(meta.dependencies,kernelBinding.manifest.dependencies);
        write(path.join(root,'context-memory-kernel-public-source.json'),kernelBinding);
      }
      if (expected.name === "chainlesschain") {
        assert(bytes.equals(fs.readFileSync(path.join(candidate, manifest.artifact))));
        await verifyReleaseArtifact(archiveFile, manifest, { version, commit: sha });
        assert.deepEqual(meta.dependencies, cli.dependencies);
      }
    }
    const proofs = [];
    for (const [name, filename] of [["chainlesschain", "chainlesschain"], ["@chainlesschain/agent-sdk", "agent-sdk"], ["@chainlesschain/agent-protocol", "agent-protocol"], ["@chainlesschain/context-memory-kernel", "context-memory-kernel"]]) {
      const proof = read(path.join(authority, `${filename}-npm-provenance.json`));
      const child = children.find(row => row.name === name), meta = metadata.get(name);
      if (name === "chainlesschain") assert.equal(proof.attempt,run.run_attempt,"CLI provenance is not bound to the observed publish attempt");
      assert.match(proof.commit, /^[a-f0-9]{40}$/u);
      const anchorTree = child ? git(["rev-parse", `${proof.commit}:${child.packagePath}`]) : null;
      const binding = validateProof(proof, { package: name, version: meta.version, sha512: archives.find(row => row.name === name).sha512, sha, releaseVersion: version, runId, registryGitHead: meta.gitHead, packagePath: child?.packagePath, currentTree: child?.currentTree, anchorTree,requireTrustedReuse:!!child,baselineAnchor:child?.baselineAnchor,baselineProvenance:child?.baselineProvenance });
      if (name === "@chainlesschain/agent-sdk" && child.baselineGitHead) {
        assert.equal(proof.commit, child.baselineGitHead);
        assert.equal(meta.gitHead, child.baselineGitHead);
      }
      proofs.push({ name, ...binding, proof });
    }
    const workflowInstall = read(path.join(authority, "cli-public-child-install.json"));
    assert.equal(workflowInstall.package, "chainlesschain"); assert.equal(workflowInstall.version, version);
    assert.equal(workflowInstall.cliSource, "immutable-candidate-tarball");
    assert.equal(workflowInstall.childrenSource, registry);
    const direct = Object.keys(cli.dependencies).filter(name => name.startsWith("@chainlesschain/"));
    assert.equal(workflowInstall.children.length, direct.length); assert.equal(new Set(workflowInstall.children.map(row => row.name)).size, direct.length);
    for (const row of workflowInstall.children) { assert(direct.includes(row.name)); validateLockEntry(row, metadata.get(row.name)); }
    // Independently install the public CLI and all 13 children. This deliberately
    // skips lifecycle scripts; it verifies source/lock identity, not native functionality.
    const installRoot = path.join(root, "public-install"); fs.mkdirSync(installRoot);
    write(path.join(installRoot, "package.json"), { name: "release-public-source-readback", version: "0.0.0", private: true });
    fs.writeFileSync(path.join(installRoot, ".npmrc"), `registry=${registry}\n@chainlesschain:registry=${registry}\nignore-scripts=true\nfetch-retries=0\n`, { flag: "wx" });
    const npmCli = process.env.CC_READBACK_NPM_CLI || path.join(path.dirname(fs.realpathSync(process.execPath)), "node_modules/npm/bin/npm-cli.js");
    assert(fs.existsSync(npmCli), "Set CC_READBACK_NPM_CLI to npm-cli.js for this Node installation");
    const args = [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-online", `--registry=${registry}`, "--fetch-retries=0", `chainlesschain@${version}`, ...children.map(row => `${row.name}@${row.version}`)];
    write(path.join(root, "install-invocation.json"), { executable: process.execPath, args, cwd: installRoot });
    const installed = spawnSync(process.execPath, args, { cwd: installRoot, windowsHide: true, timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(root, "install.stdout"), installed.stdout ?? Buffer.alloc(0), { flag: "wx" });
    fs.writeFileSync(path.join(root, "install.stderr"), installed.stderr ?? Buffer.alloc(0), { flag: "wx" });
    assert.equal(installed.status, 0, `Public install failed: ${installed.error?.message ?? installed.signal ?? installed.status}`);
    const lock = read(path.join(installRoot, "package-lock.json"));
    for (const [name, meta] of metadata) {
      const directory = path.join(installRoot, "node_modules", name);
      assert(!fs.lstatSync(directory).isSymbolicLink()); assert.equal(fs.realpathSync(directory).toLowerCase(), directory.toLowerCase());
      const installedManifest = read(path.join(directory, "package.json"));
      assert.equal(installedManifest.name, name); assert.equal(installedManifest.version, meta.version);
      validateLockEntry(lock.packages?.[`node_modules/${name}`], meta);
    }
    const publicCliInstall = verifyCliRegistryInstall(installRoot, metadata.get("chainlesschain"));
    assert(kernelBinding,'Kernel public archive source binding was not established');
    for (const child of publicCliInstall.children) validateLockEntry(child, metadata.get(child.name));
    const receipt = { schema: "chainlesschain.public-release-readback/v4", observedAt: new Date().toISOString(), status: "VERIFIED", sha, version, runId, immutableCliBytesMatch: true, registryArchiveCount: archives.length, childCount: children.length, archives, proofs, publicationJobs, releaseGateReadback, sessionBinding, kernelBinding, children, workflowInstall, publicCliInstall, allThirteenChildrenPublicInstallBound: true, signatureVerificationSource: "Successful OIDC publish workflow and digest-bound artifact receipts from npm audit signatures --include-attestations; no new local signature audit performed.", boundaries: ["Public-install lifecycle scripts intentionally disabled; native/functional installation is not tested here.", "Only CLI, SDK, Agent Protocol and Context Memory Kernel have signature-audit provenance receipts checked. Reused Session Core is bound to the prior verified public bytes and the current successful exact-SHA OIDC workflow repack, every packed source file, public tarball bytes and registry-only install; no separate Session Core signature-audit receipt is asserted. All thirteen children reuse their prior verified public bytes and unchanged source trees. Kernel provenance retains the prior signed publication anchor with trusted-reuse tree equality, and every public packed Kernel source file is checked against candidate Git blobs. No separate Kernel candidate tarball is asserted.", "This readback does not replace the exact-SHA CI release gates or establish IDE marketplace publication."] };
    write(path.join(root, "public-authority-readback.json"), receipt);
    console.log(JSON.stringify({ root, status: receipt.status, sha, version, childCount: children.length }));
  } catch (error) {
    write(path.join(root, "failure.json"), { status: "NOT_VERIFIED", at: new Date().toISOString(), message: error.message, stack: error.stack });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), planOnly = args[0] === "--plan";
  if (planOnly) args.shift();
  const [sha, version, runId, summary = defaultBaseline, ...extra] = args;
  try {
    assert.equal(extra.length, 0, "Usage: [--plan] <sha> <version> <publish-run-id> [baseline-public-readback.json]");
    const input = plan(sha, version, runId, summary);
    if (planOnly) console.log(JSON.stringify({ status: "PREPARED_PUBLIC_NOT_VERIFIED", sha, version, runId, children: input.children, registryRequests: 28, publicInstall: "CLI + 13 children, ignore-scripts, no automatic retries" }, null, 2));
    else await collect(input);
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
