import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {workflowSourceHashes} from './release100-final-workflow-contract.mjs';
import {historicalBranch,verifySourceBranch,toolingDirectory,originalBindingPath} from './release100-source-config.mjs';
export const preparationSha='ff292775c4a032541fb50147d49dd353967be3b4';
export const childBaselineSha='311e01a5ec34a8e433c7abde0e4b6b05bce4513b';
export const evaluatorSha='07f050be901dd806f68ccb3ddb8eee12ad7a5254';
export const defaultBinding=originalBindingPath;
export const versions={cli:'0.166.100',vscode:'0.37.144',jetbrains:'0.4.162'};
export const childDirectories=['agent-protocol','core-env','core-mtc','core-multisig','core-settlement','shared-logger','core-config','core-db','core-infra','session-core','context-memory-kernel','agent-sdk','personal-data-hub'];
export const evaluatorFiles=['packages/cli/scripts/verify01-review-runtime.mjs','packages/cli/scripts/verify01-review-specs.mjs','packages/cli/src/lib/eval/verify01-execution-window.js','packages/cli/src/lib/eval/verify01-execution.js','packages/cli/src/lib/eval/verify01-host-capture.js'];
export const hash=b=>createHash('sha256').update(b).digest('hex');
const summaryBytes=fs.readFileSync(new URL('../docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-12/release100-preparation/summary.json',import.meta.url));
assert.equal(hash(summaryBytes),'7c977c2d24a5b8a408129b235be37c2822338035aa2cc3a2f50236b5151e095c','Preparation receipt changed');
export const preparation=JSON.parse(summaryBytes);
const git=args=>execFileSync('git',args,{windowsHide:true,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
const immutableObjects=new Map();
function object(args) {const key=JSON.stringify(args);if(!immutableObjects.has(key)) immutableObjects.set(key,git(args));return Buffer.from(immutableObjects.get(key));}
export const localSource={blob:(sha,file)=>object(['show',`${sha}:${file}`]),tree:(sha,file)=>object(['rev-parse',`${sha}:${file}`]).toString().trim(),commit:sha=>object(['rev-parse','--verify',`${sha}^{commit}`]).toString().trim()};
export function verifyMetadataDelta(file,baseline,current) {
 if(baseline.equals(current)) return 'unchanged-preparation-bytes';
 const old=baseline.toString('utf8'),text=current.toString('utf8');
 if(file==='packages/vscode-extension/CHANGELOG.md') {
  assert.equal(text,old.replace('## [0.37.144] - Bounded stream retry pairing (2026-10-12)','## [0.37.144] - Bounded stream retry pairing (2026-10-13)'),`Unapproved metadata delta: ${file}`);
  return 'known-release-date-2026-10-13';
 }
 if(file==='packages/jetbrains-plugin/CHANGELOG.md') {
  const dated=old.replace('## [0.4.162] - Bounded stream retry pairing (2026-10-12)','## [0.4.162] - Bounded stream retry pairing (2026-10-13)');
  const notes='- Add opt-in checkpoint chooser diagnostics for real-host selection, closure\n  and focus observations while preserving existing transition deadlines.\n- Open checkpoint actions on the next EDT dispatch after the timeline chooser\n  closes; discard handoffs when the view, project or session becomes stale.\n';
  const expanded=dated.replace('- Retain the bridge compatibility floor;',notes+'- Retain the bridge compatibility floor;');
  assert(text===dated||text===expanded,`Unapproved metadata delta: ${file}`);
  return text===dated?'known-release-date-2026-10-13':'known-release-date-and-checkpoint-notes';
 }
 assert.fail(`Unapproved metadata delta: ${file}`);
}
export function buildSourceBinding(sha,source=localSource,sourceBranch=historicalBranch) {
 verifySourceBranch(sourceBranch);
 assert.match(sha??'',/^[a-f0-9]{40}$/u,'Explicit lowercase 40-digit commit required; HEAD/ref names forbidden');
 assert.equal(source.commit(sha),sha,'Not the requested commit');
 const metadata=preparation.metadataWorktreeHashes.map(entry=>{
  const original=source.blob(preparationSha,entry.source);
  assert.equal(hash(original),entry.sha256,`Original preparation blob mismatch: ${entry.source}`);
  const current=source.blob(sha,entry.source);
  return {source:entry.source,preparationSha256:entry.sha256,sha256:hash(current),delta:verifyMetadataDelta(entry.source,original,current)};
 });
 assert.equal(metadata.length,16);
 const cli=JSON.parse(source.blob(sha,'packages/cli/package.json'));
 const vscode=JSON.parse(source.blob(sha,'packages/vscode-extension/package.json'));
 const lock=JSON.parse(source.blob(sha,'package-lock.json'));
 assert.equal(cli.name,'chainlesschain');assert.equal(cli.version,versions.cli);
 assert.equal(vscode.publisher,'chainlesschain');assert.equal(vscode.version,versions.vscode);
 assert.equal(vscode.chainlesschain.recommendedCliVersion,versions.cli);
 assert.equal(lock.packages['packages/cli'].version,versions.cli);
 assert.deepEqual(lock.packages['packages/cli'].dependencies,cli.dependencies);
 assert.deepEqual(lock.packages['node_modules/chainlesschain'],{resolved:'packages/cli',link:true});
 const text=file=>source.blob(sha,file).toString('utf8');
 assert.match(text('packages/jetbrains-plugin/build.gradle.kts'),/^version = "0\.4\.162"$/mu);
 assert.match(text('packages/jetbrains-plugin/gradle.properties'),/^chainlesschainRecommendedCliVersion=0\.166\.100$/mu);
 assert.match(text('packages/jetbrains-plugin/src/main/resources/META-INF/plugin.xml'),/<version>0\.4\.162<\/version>/u);
 assert.match(text('packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/CliVersionCheck.java'),/RECOMMENDED_CLI_VERSION = "0\.166\.100"/u);
 const children=childDirectories.map(directory=>{
  const packagePath=`packages/${directory}`,manifest=JSON.parse(source.blob(sha,packagePath+'/package.json'));
  assert.equal(manifest.name,`@chainlesschain/${directory}`);
  const currentTree=source.tree(sha,packagePath);
  assert.equal(currentTree,source.tree(childBaselineSha,packagePath),`Child subtree changed: ${packagePath}`);
  assert.equal(lock.packages[packagePath].version,manifest.version,`Child lock version: ${directory}`);
  return {name:manifest.name,version:manifest.version,packagePath,currentTree,baselineSource:childBaselineSha};
 });
 for(const [name,pin] of Object.entries(cli.dependencies).filter(([name])=>name.startsWith('@chainlesschain/'))) assert.equal(children.find(c=>c.name===name)?.version,pin,`CLI child pin: ${name}`);
 const sameImplementation=evaluatorFiles.map(file=>{
  const bytes=source.blob(sha,file);assert(bytes.equals(source.blob(evaluatorSha,file)),`Evaluator source changed: ${file}`);
  return {source:file,sha256:hash(bytes),reviewedSource:evaluatorSha};
 });
 const workflows=Object.entries(workflowSourceHashes).map(([file,expected])=>{
  const actual=hash(source.blob(sha,file));assert.equal(actual,expected,`Workflow contract changed: ${file}`);
  return {source:file,sha256:actual};
 });
 return {schema:'chainlesschain.release-source-binding/v2',sourceCommit:sha,sourceBranch,status:'SOURCE_BOUND_RELEASE_NOT_VERIFIED',versions,preparationSource:preparationSha,metadata,children,sameImplementation,workflows,releaseGatePassed:false,finalKeylessRun:null,finalReviewDigest:null,formalObservationsCreated:false,sourceGateReceipts:[],historicalEvidencePolicy:'Prior source checks and review receipts are not transferred to this source. Byte equality is source evidence only.'};
}
export function readSourceBinding(expectedSha,file=process.env.CC_RELEASE100_SOURCE_BINDING||defaultBinding) {
 const stored=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.match(stored.sourceCommit??'',/^[a-f0-9]{40}$/u);
 if(expectedSha!==undefined) assert.equal(stored.sourceCommit,expectedSha,'Readback SHA differs from explicit source binding');
 const computed=buildSourceBinding(stored.sourceCommit,localSource,stored.sourceBranch||historicalBranch);
 if(stored.schema===computed.schema) assert.deepEqual(stored,computed,'Source binding differs from freshly verified source');
 else {
  assert.equal(stored.sourceCommit,preparationSha,'Only original ff binding supports legacy format');
  assert.equal(stored.releaseGatePassed,false);
  for(const entry of computed.metadata) assert.equal(stored.metadata.find(x=>x.source===entry.source)?.sha256,entry.sha256);
 }
 return computed;
}
export function writeSourceBinding(binding,file) {
 assert.equal(binding.sourceCommit,git(['rev-parse','HEAD']).toString().trim(),'Freeze requires HEAD at explicitly supplied SHA');
 assert.equal(binding.sourceBranch,git(['symbolic-ref','--short','HEAD']).toString().trim(),'Freeze requires explicitly supplied branch');
 assert.equal(git(['status','--porcelain','--untracked-files=no']).toString().trim(),'','Tracked source must be stable and clean before freezing');
 assert.deepEqual(binding,buildSourceBinding(binding.sourceCommit,localSource,binding.sourceBranch));
 assert.equal(binding.sourceCommit,git(['rev-parse','HEAD']).toString().trim(),'HEAD changed during validation');
 assert.equal(binding.sourceBranch,git(['symbolic-ref','--short','HEAD']).toString().trim(),'Branch changed during validation');
 assert.equal(git(['status','--porcelain','--untracked-files=no']).toString().trim(),'','Tracked source changed during validation');
 const resolved=path.resolve(file),work=path.resolve('.work');
 assert(resolved.startsWith(work+path.sep)||resolved.startsWith(path.resolve(toolingDirectory)+path.sep),'Binding output must remain under candidate or original .work');
 fs.writeFileSync(resolved,JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
}
