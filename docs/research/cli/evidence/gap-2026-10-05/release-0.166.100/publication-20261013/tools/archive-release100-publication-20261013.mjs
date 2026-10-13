import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyIdeWorkflowObservation } from './readback-ide-workflow100-final.mjs';
import { listZipEntries, readZipEntry } from '../packages/vscode-extension/scripts/verify-vsix.mjs';

const workspace = 'C:/code/chainlesschain';
const target = path.join(workspace, '.work/p100');
const sha = '6a8db627c87f33ce4f8e5d3db704868957aa685e';
const cliRoot = path.join(workspace, '.work/r100/.work/release-readback-0.166.100/verified-38322183193-' + sha + '/public-2026-10-13T01-15-35.195Z');
const [vscodeFile, jetbrainsFile] = process.argv.slice(2);
const cli = JSON.parse(fs.readFileSync(path.join(cliRoot, 'public-authority-readback.json'), 'utf8'));
assert.equal(cli.status, 'VERIFIED');
assert.equal(cli.sha, sha);
assert.equal(cli.version, '0.166.100');
assert.equal(cli.childCount, 13);
const receipts = {};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [kind, file, version, runId] of [['vscode', vscodeFile, '0.37.144', '38331570568'], ['jetbrains', jetbrainsFile, '0.4.162', '38331689410']]) {
  if (!file || file === '-') continue;
  const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(receipt.sourceCommit, sha);
  assert.equal(receipt.version, version);
  assert.equal(receipt.cliVersion, '0.166.100');
  assert.equal(receipt.tag, `ide-${kind}-v${version}`);
  assert.equal(receipt.channel, kind === 'vscode' ? 'open-vsx' : 'jetbrains');
  assert.equal(String(receipt.tagWorkflow.id), runId);
  const root = path.dirname(file);
  const run = JSON.parse(fs.readFileSync(path.join(root, 'run.raw.json'), 'utf8'));
  const jobs = JSON.parse(fs.readFileSync(path.join(root, 'jobs.raw.json'), 'utf8'));
  assert.deepEqual(receipt.workflowObservation, verifyIdeWorkflowObservation(run, jobs, {kind, sha, version, runId}));
  const candidate = fs.readFileSync(path.join(root, kind === 'vscode' ? 'candidate.vsix' : 'candidate.zip'));
  assert.equal(hash(candidate), receipt.artifact.sha256);
  assert.equal(hash(fs.readFileSync(path.join(root, 'actions-artifact.zip'))), receipt.artifact.zipDigest.replace(/^sha256:/, ''));
  assert(['ready', 'pending'].includes(receipt.status));
  if (receipt.status === 'ready') {
    assert.equal(receipt.tagWorkflow.status, 'completed');
    assert.equal(receipt.tagWorkflow.conclusion, 'success');
    assert.equal(receipt.workflowObservation.workflowComplete, true);
    assert.match(receipt.publicPackage?.sha256 ?? '', /^[a-f0-9]{64}$/);
    const published = fs.readFileSync(path.join(root, kind === 'vscode' ? 'public.vsix' : 'public.zip'));
    assert.equal(hash(published), receipt.publicPackage.sha256);
    assert.equal(published.length, receipt.publicPackage.bytes);
    const local = listZipEntries(candidate), remote = listZipEntries(published);
    assert.deepEqual([...local.keys()].sort(), [...remote.keys()].sort());
    for (const [name, entry] of local) assert(readZipEntry(candidate, entry).equals(readZipEntry(published, remote.get(name))), name);
    if (kind === 'vscode') {
      assert.equal(receipt.downloadable, true);
      assert.equal(receipt.listed, true);
      assert.equal(receipt.latest, version);
      assert.equal(receipt.registryArchiveSha256, hash(published));
      assert.equal(receipt.localArchiveSha256, hash(candidate));
    } else {
      assert.equal(receipt.publicUpdate.approve, true);
      assert.equal(receipt.publicUpdate.listed, true);
      assert.equal(receipt.publicUpdate.hidden, false);
      assert.equal(receipt.publicPackage.allEntryBytesMatch, true);
    }
  } else {
    assert.equal(kind, 'jetbrains');
    assert.equal(receipt.publicationState, 'PENDING_NOT_PUBLIC');
    assert.equal(receipt.publicPackage, null);
  }
  receipts[kind] = { file, receipt };
}
const relativeRoot = 'docs/research/cli/evidence/gap-2026-10-05/release-0.166.100/publication-20261013';
const evidence = path.join(target, relativeRoot);
assert(!fs.existsSync(evidence), 'Use a new snapshot; never replace archived evidence');
const documentFiles = ['docs/research/cli/cli-claude-code-codex-gap-analysis-2026-10-05.md', 'docs/research/ide/ide-claude-code-codex-gap-analysis-2026-10-05.md'];
const documentBytes = documentFiles.map(file => fs.readFileSync(path.join(target, file), 'utf8'));
for (const text of documentBytes) {
  assert(text.indexOf('\n\n') > 0);
  assert(!text.includes('2026-10-13 配对发行最新状态'));
}
assert(/^\| CLI 0\.166\.100 \/ VS 0\.37\.144 \/ JB 0\.4\.162[^\n]*$/m.test(documentBytes[0]));
fs.mkdirSync(evidence, {recursive: true});
const copied = [];
function copy(source, relative) {
  const bytes = fs.readFileSync(source);
  const destination = path.join(evidence, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, bytes, {flag: 'wx'});
  copied.push({path: relative, source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
for (const name of ['public-authority-readback.json', 'invocation.json', 'run.raw.json', 'publish-jobs.raw.json', 'artifact-readback.json', 'publication-job-contract.json', 'release-gates-independent-readback.json', 'install-invocation.json', 'install.stdout', 'install.stderr']) {
  const file = path.join(cliRoot, name);
  copy(file, 'cli/' + name);
}
const authority = path.join(cliRoot, 'chainlesschain-npm-readback-' + sha);
for (const name of ['chainlesschain', 'agent-sdk', 'agent-protocol', 'context-memory-kernel']) copy(path.join(authority, name + '-npm-provenance.json'), 'cli/' + name + '-npm-provenance.json');
copy(path.join(workspace, '.work/release100-source-' + sha + '.json'), 'preflight/source-binding.json');
copy(path.join(cliRoot, 'public/chainlesschain-0.166.100.metadata.json'), 'cli/public-metadata.json');
copy(path.join(workspace, '.work/release100-production-preflight-2026-10-12T23-24-38.779Z/summary.json'), 'preflight/summary.json');
copy(path.join(workspace, '.work/pr435-final-independent-release-audit-20261013/assessment.md'), 'astra/prepublish-assessment.md');
copy(path.join(workspace, '.work/release100-ide-independent-review-20261013/assessment.md'), 'astra/ide-assessment.md');
copy(path.join(workspace, '.work/release100-ide-independent-review-20261013/summary.json'), 'astra/ide-summary.json');
copy(path.join(workspace, '.work/release100-cli-offline-archive-review-20261013/summary.json'), 'astra/cli-offline-summary.json');
copy(path.join(workspace, '.work/release100-cli-offline-archive-review-20261013/assessment.md'), 'astra/cli-offline-assessment.md');
for (const kind of ['vscode', 'jetbrains']) {
  const review = path.join(workspace, '.work/release100-' + kind + '-offline-review-20261013');
  copy(path.join(review, 'assessment.md'), 'astra/' + kind + '-offline-assessment.md');
  copy(path.join(review, 'summary.json'), 'astra/' + kind + '-offline-summary.json');
}
copy(path.join(workspace, '.work/release100-openvsx-activation-review-20261013/assessment.md'), 'astra/openvsx-activation-assessment.md');
copy(path.join(workspace, '.work/release100-openvsx-activation-review-20261013/platform-sources.json'), 'astra/openvsx-platform-sources.json');
for (const name of ['archive-release100-publication-20261013.mjs', 'readback-public-release100-final.mjs', 'readback-ide-release100-final.mjs', 'readback-ide-workflow100-final.mjs', 'release100-final-workflow-contract.mjs', 'release100-source-freeze.mjs', 'release100-source-config.mjs']) copy(path.join(workspace, '.work', name), 'tools/' + name);
for (const kind of ['vscode', 'jetbrains']) {
  const tagRoot = path.join(workspace, '.work/release100-' + kind + '-live-tag-6a8-20261013');
  for (const name of ['release-intent.json', 'summary.json', 'ide-tag-after.stdout', 'push-ide-tag.stdout', 'push-ide-tag.stderr']) {
    const file = path.join(tagRoot, name);
    copy(file, kind + '/tag-' + name);
  }
  if (!receipts[kind]) continue;
  const root = path.dirname(receipts[kind].file);
  copy(receipts[kind].file, kind + '/public-readback.json');
  for (const name of ['invocation.json', 'run.raw.json', 'jobs.raw.json', 'artifacts.raw.json', 'artifact-readback.json', 'preflight-readback.json', 'marketplace-verifier.stdout', 'marketplace-verifier.stderr']) {
    const file = path.join(root, name);
    copy(file, kind + '/' + name);
  }
  for (const name of ['open-vsx-exact-metadata.json', 'jetbrains-updates.json']) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) copy(file, kind + '/' + name);
  }
}
const status = kind => receipts[kind]?.receipt.status === 'ready' ? '公开回读完成' : receipts[kind]?.receipt.status === 'pending' ? '已提交，仍待市场批准或最终核验' : '发行流程已触发，公开回读待完成';
const manifest = {schema: 'chainlesschain.release-publication-evidence/v1', observedAt: new Date().toISOString(), sourceCommit: sha, cli: {version: cli.version, status: cli.status, runId: cli.runId, receipt: 'cli/public-authority-readback.json'}, ide: Object.fromEntries(['vscode', 'jetbrains'].map(kind => [kind, {version: kind === 'vscode' ? '0.37.144' : '0.4.162', status: receipts[kind]?.receipt.status ?? 'publication-in-progress', runId: receipts[kind]?.receipt.tagWorkflow.id ?? null, receipt: receipts[kind] ? kind + '/public-readback.json' : null}])), formal: {status: 'NOT_RUN', tasks: '0/36', firstRuns: '0/9', sharedBudgetUsd: 99, allocation: 'Volcengine 18 tasks + 9 first runs; OpenAI 18 tasks'}, files: copied};
fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
fs.writeFileSync(path.join(evidence, 'README.md'), `# CLI 0.166.100 / IDE 配对发行公开核验\n\n冻结源码：\`${sha}\`；[源 PR435](https://github.com/chainlesschain/chainlesschain/pull/435)。\n\n- CLI **0.166.100 VERIFIED**：[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/38322183193)、[npm](https://www.npmjs.com/package/chainlesschain/v/0.166.100)。公开 tarball 与不可变 Actions 制品一致；14 个公开包含 13 个子包，SRI、四份签名来源回执、复用源码树和禁用生命周期脚本的 registry-only 安装通过。\n- VS Code / Open VSX **0.37.144**：${status('vscode')}。Microsoft Marketplace 不包含在此标签发布渠道内。\n- JetBrains **0.4.162**：${status('jetbrains')}。只有批准、listed、可公开下载且 ZIP 内容与 Actions 制品匹配才能算公开完成；pending 不算发布成功。\n\n七个完整冻结源码门包含 114 个作业（113 success、1 预期 skip），见 preflight/summary.json 与 Astra 独立审阅。额外 15 个 merge-checkout 作业仅有相同 tree，不称 exact-source 执行。原失败与旧时点记录保留。\n\n签名审计来源是成功 OIDC 工作流的 digest-bound npm audit signatures 回执，未重新本地执行签名审计；禁用脚本安装仅证明来源与依赖一致，不证明原生功能。大型 tarball/VSIX/ZIP 留在原独立回读目录，公开 URL、摘要和原件目录见回执与 manifest。\n\n正式验收仍 **NOT_RUN / 0/36 / 0/9 / 共享 $99**；冻结火山18任务+9首次旅程、OpenAI18任务分配。预算模块31ff独立分支不在本次发布内，仍 NOT_PAID_READY。真实火山诊断和 Astra 审阅不计正式样本。\n`, {flag: 'wx'});
for (const [kind, file] of [['cli', 'docs/research/cli/cli-claude-code-codex-gap-analysis-2026-10-05.md'], ['ide', 'docs/research/ide/ide-claude-code-codex-gap-analysis-2026-10-05.md']]) {
  const destination = path.join(target, file);
  let text = fs.readFileSync(destination, 'utf8');
  const link = kind === 'cli' ? './evidence/gap-2026-10-05/release-0.166.100/publication-20261013/README.md' : '../cli/evidence/gap-2026-10-05/release-0.166.100/publication-20261013/README.md';
  const addition = `> **2026-10-13 配对发行最新状态**：冻结源码\`6a8db627c87f33ce4f8e5d3db704868957aa685e\`完整七门114作业通过（113 success/1预期skip）；CLI **0.166.100 已通过 OIDC 发布及完整公开回读**，13子包和公开安装来源一致。VS Code/Open VSX **0.37.144：${status('vscode')}**；JetBrains **0.4.162：${status('jetbrains')}**。Microsoft Marketplace另行发行，JetBrains pending不算公开完成。见[发行原件与边界](${link})。预算模块31ff不在本次发行内，正式仍 **NOT_RUN / 0/36 / 0/9 / 共享$99**，火山18任务+9首次旅程、OpenAI18任务分配保持。以下历史记录保留各自时点。\n\n`;
  assert(!text.includes('2026-10-13 配对发行最新状态'));
  const firstBreak = text.indexOf('\n\n');
  assert(firstBreak > 0);
  text = text.slice(0, firstBreak + 2) + addition + text.slice(firstBreak + 2);
  if (kind === 'cli') {
    const row = /^\| CLI 0\.166\.100 \/ VS 0\.37\.144 \/ JB 0\.4\.162[^\n]*$/m;
    assert(row.test(text));
    text = text.replace(row, `| CLI 0.166.100 / VS 0.37.144 / JB 0.4.162 | CLI OIDC发行与公开回读完成；VS ${status('vscode')}；JB ${status('jetbrains')} | 后续源码独立重验；Microsoft Marketplace另验；正式36+9继续开放 |`);
  }
  fs.writeFileSync(destination, text);
}
console.log(JSON.stringify({evidence, files: copied.length, cli: manifest.cli, ide: manifest.ide, docsUpdated: 2}, null, 2));
