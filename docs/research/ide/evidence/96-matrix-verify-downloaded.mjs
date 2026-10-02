import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Buffer as hash, redactDiagnosticText } from '../../../../scripts/ide-journey-evidence.mjs';
import { verifyNativeTranscriptEvidence } from '../../../../packages/jetbrains-plugin/scripts/native-transcript-evidence.mjs';
import { verifyConversationRecovery } from '../../../../packages/jetbrains-plugin/scripts/conversation-recovery-evidence.mjs';
import { verifyWorkbenchVisibilityMetrics, verifyWorkbenchFixtureLedger, verifyRewindFixtureLedger, verifyModelConfigurationFixtureLedger } from '../../../../packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs';
import { inspectVsixReleaseArtifact, verifyVsixReleaseArtifact } from '../../../../packages/vscode-extension/scripts/vsix-release-artifact.mjs';
import { listZipEntries, readZipEntry } from '../../../../packages/vscode-extension/scripts/verify-vsix.mjs';
const require=createRequire(import.meta.url);
const {verifyStreamingProfile}=require('../../../../packages/vscode-extension/test/extension-host/driver/streaming-profile.cjs');
const {assertMultiWindowEvidence}=require('../../../../packages/vscode-extension/test/extension-host/run.cjs');
const {JOURNEY_PHASES,PHASE_DOM_MARKERS,PHASE_WORKBENCH_DOM_MARKERS}=require('../../../../packages/vscode-extension/test/extension-host/cdp-journey.cjs');
const root=path.resolve(process.argv[2] || (()=>{throw new Error('Pass the complete candidate96-hosts download directory');})());
const sha='96cbf6ba5631d5ef855e3cdc41801d837142e62b';
const rel=p=>path.relative(root,p).replaceAll('\\','/');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const jsonl=p=>fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const p95=a=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1];
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const p=path.join(dir,e.name);assert.ok(!e.isSymbolicLink());return e.isDirectory()?walk(p):[p];});}
const hostRoots=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^(jetbrains-|vscode-).*host-evidence-1$/.test(e.name)).map(e=>path.join(root,e.name));
assert.equal(hostRoots.length,9);
const files=hostRoots.flatMap(walk);
const inventory=files.map(file=>({path:rel(file),bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))}));
const candidateFile=path.join(root,'candidate-package/chainlesschain-ide.vsix');
const candidateManifest=read(path.join(root,'candidate-package/manifest.json'));
const candidate=verifyVsixReleaseArtifact(candidateFile,candidateManifest,{commit:sha});
const candidateIdentity=inspectVsixReleaseArtifact(candidateFile);
assert.equal(candidateManifest.commit,sha);assert.equal(candidateIdentity.version,'0.37.127');
const hosts=[];
const issues=[];
for(const envelopeFile of files.filter(f=>path.basename(f)==='journey-evidence.json')){
 const label=rel(envelopeFile), dir=path.dirname(envelopeFile), e=read(envelopeFile);
 const h={envelope:label,host:e.host,journeyId:e.journeyId,artifactCount:e.artifacts.length,evidenceDigest:e.evidenceDigest,artifactBundleDigest:e.artifactBundleDigest,issues:[]};
 hosts.push(h);
 try{
  assert.equal(e.schema,'chainlesschain.ide-journey-evidence');assert.equal(e.schemaVersion,2);
  assert.equal(e.releaseCommit,sha);assert.equal(e.result,'passed');assert.equal(e.evidenceComplete,true);assert.deepEqual(e.incidents,[]);
  assert.ok(Date.parse(e.finishedAt)>=Date.parse(e.startedAt));
  const {evidenceDigest,...core}=e;assert.equal(hash(canonicalJson(core)),evidenceDigest);
  assert.equal(hash(canonicalJson(e.artifacts.filter(a=>a.path).map(({kind,name=null,path,sha256,bytes})=>({kind,name,path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path)))),e.artifactBundleDigest);
  const names=new Set();
  for(const a of e.artifacts){assert.ok(!names.has(a.path));names.add(a.path);const f=path.resolve(dir,a.path);assert.ok(f.startsWith(dir+path.sep));assert.ok(!fs.lstatSync(f).isSymbolicLink());assert.equal(fs.statSync(f).size,a.bytes);assert.equal(hash(fs.readFileSync(f)),a.sha256);}
  const artifact=e.artifacts.filter(a=>a.kind==='release-artifact');assert.equal(artifact.length,1);
  h.releaseArtifact=artifact[0];
  const bound=path.join(dir,artifact[0].path);
  const diag=name=>{const found=e.artifacts.filter(a=>a.kind==='host-diagnostic'&&a.path.endsWith('-'+name));assert.equal(found.length,1,name);return path.join(dir,found[0].path);};
  if(e.host.name==='vscode'){
   const identity=inspectVsixReleaseArtifact(bound);assert.equal(identity.sha256,candidateIdentity.sha256);assert.equal(identity.version,e.extensionVersion);
   h.vsixIdentity=identity;delete h.vsixIdentity.file;
   const profile=read(diag('streaming-profile.json'));assert.equal(profile.schema,'cc-ide-host-streaming-profile/v2');assert.equal(profile.renderer,'installed-vsix-production-streaming-transcript');assert.equal(profile.fixtureOutput,true);assert.equal(profile.performanceGate,false);assert.equal(profile.warmupCases,1);assert.equal(profile.hostPlatform,e.host.operatingSystem);assert.equal(profile.hostArchitecture,e.host.architecture);assert.deepEqual(profile.cases.map(c=>c.chars),[10000,100000,200000]);profile.cases.forEach(verifyStreamingProfile);
   h.streaming={schema:profile.schema,warmupCases:1,performanceGate:false,cases:profile.cases.map(c=>({chars:c.chars,samples:c.samples,frameSamples:c.frameSamples,frameP95Ms:c.frameP95Ms,updateP95Ms:c.updateP95Ms,finalizationMs:c.finalizationMs,finalizationStagesMs:c.finalizationStagesMs,longestTaskMs:c.longestTaskMs,longTasks:c.longTasks,streamingParseCalls:c.streamingParseCalls,parseCalls:c.parseCalls,selectionStable:c.selectionStable,finalizationIdempotent:c.finalizationIdempotent}))};
   const records=jsonl(diag('cdp-journey.jsonl'));assert.ok(!records.some(r=>r.status==='failed'));
   for(const [phase,steps]of Object.entries(JOURNEY_PHASES)){
    for(const step of steps)assert.ok(records.some(r=>r.phase===phase&&r.step===step&&r.status==='passed'),phase+'/'+step);
    for(const status of ['target-found','sessions-workbench-found'])assert.ok(records.some(r=>r.phase===phase&&r.status===status&&r.targetType&&r.targetUrl));
    const markers=phase==='initial'?PHASE_DOM_MARKERS.initial.filter(m=>!['fixture permission approved #4','interrupted'].includes(m)):PHASE_DOM_MARKERS[phase];
    const dom=fs.readFileSync(diag(phase+'-dom.txt'),'utf8');for(const m of markers)assert.ok(dom.includes(m),m);
    const workbench=fs.readFileSync(diag(phase+'-workbench-dom.txt'),'utf8');for(const m of PHASE_WORKBENCH_DOM_MARKERS[phase])assert.ok(workbench.includes(m),m);
    const ready=read(diag(phase+'-host-ready.json')), result=read(diag(phase+'-cdp-result.json'));assert.equal(ready.phase,phase);assert.equal(result.phase,phase);assert.equal(result.ok,true);assert.equal(ready.workspaceFolders.length,2);assert.equal(ready.hostArchitecture,e.host.architecture);assert.ok(ready.extensionPath.replaceAll('\\','/').includes('/extensions/chainlesschain.chainlesschain-ide-'+e.extensionVersion));
   }
   const ready=read(diag('initial-host-ready.json')), restart=read(diag('restart-host-ready.json'));assert.deepEqual(ready.workspaceFolders,restart.workspaceFolders);assert.equal(hash(canonicalJson(ready.workspaceFolders.map(p=>e.host.operatingSystem==='win32'?p.toLowerCase():p))),e.workspace.orderedRootsDigest);
   h.multiWindow=assertMultiWindowEvidence(diag('multi-window-evidence.json'));
   const samples=records.filter(r=>r.phase==='initial'&&r.metric==='needs-input-visible');assert.equal(samples.length,100);samples.forEach((s,i)=>{assert.equal(s.sample,i+1);assert.equal(s.sampleCount,100);assert.equal(s.thresholdMs,2000);assert.ok(s.latencyMs>=0&&Number.isFinite(s.latencyMs));});
   const summary=records.filter(r=>r.phase==='initial'&&r.metric==='needs-input-visible-summary');assert.equal(summary.length,1);assert.equal(summary[0].p95LatencyMs,p95(samples.map(s=>s.latencyMs)));assert.ok(summary[0].p95LatencyMs<2000);assert.equal(summary[0].samples,100);assert.equal(summary[0].warmupSamples,1);h.needsInput=summary[0];
   const ledger=jsonl(diag('fixture-cli-protocol.jsonl'));let cursor=-1;
   for(let i=0;i<101;i++){
    const resume=ledger.findIndex((r,j)=>j>cursor&&r.direction==='command'&&r.command==='daemon-resume'&&r.stage==='needs_input');
    const reply=ledger.findIndex((r,j)=>j>resume&&r.direction==='command'&&r.command==='daemon-reply'&&r.stage==='done');
    assert.ok(resume>=0&&reply>resume,'ordered needs_input cycle '+(i+1));cursor=reply;
   }
   assert.ok(ledger.filter(r=>r.direction==='command'&&r.command==='session-projection').length>=202);
   assert.ok(ledger.some((r,i)=>i>cursor&&r.direction==='command'&&r.command==='session-projection'));
   const inbound=[r=>r.type==='user'&&r.text==='journey:stream',r=>r.type==='plan'&&r.action==='approve',r=>r.type==='user'&&r.text==='journey:permission',r=>r.type==='approval'&&r.approve===true,r=>r.type==='user'&&r.text==='journey:stop',r=>r.type==='interrupt',r=>r.type==='user'&&r.text==='journey:resume'];
   for(const predicate of inbound)assert.ok(ledger.some(r=>r.direction==='in'&&predicate(r.event||{})));
   assert.ok(ledger.filter(r=>r.direction==='in'&&r.event?.type==='user'&&r.event?.text==='journey:stream').length>=2);
   assert.ok(ledger.some(r=>r.direction==='out'&&r.event?.type==='system'&&Number(r.event?.resumed_messages)>=10));
   assert.ok(fs.readFileSync(diag('initial-permission-dom.txt'),'utf8').includes('fixture permission approved #4'));
   assert.ok(fs.readFileSync(diag('initial-interrupt-dom.txt'),'utf8').includes('interrupted'));
   h.fixtureLedgerRecords=ledger.length;h.orderedWorkbenchCycles=101;
  }else{
   assert.equal(e.host.name,'jetbrains');assert.equal(e.extensionVersion,'0.4.146');
   const hostRoot=hostRoots.find(r=>envelopeFile.startsWith(r+path.sep));
   if(e.journeyId==='jetbrains-canonical-conversation-recovery'){
    const captured=fs.readFileSync(diag('native-transcript-metrics.json'),'utf8');
    const raws=walk(path.join(hostRoot,'ui-host-driver')).filter(f=>path.basename(f)==='native-transcript-metrics.json'&&redactDiagnosticText(fs.readFileSync(f,'utf8'))===captured);assert.equal(raws.length,1);
    const raw=raws[0],logRoot=path.dirname(raw),initial=read(path.join(logRoot,'conversation-recovery-initial.json'));
    for(const name of ['conversation-recovery-initial.json','conversation-recovery-restart.json','conversation-recovery-host-phases.json'])assert.equal(redactDiagnosticText(fs.readFileSync(path.join(logRoot,name),'utf8')),fs.readFileSync(diag(name),'utf8'));
    assert.equal(fs.readFileSync(path.join(logRoot,'fake-cli-protocol.jsonl'),'utf8'),fs.readFileSync(diag('fake-cli-protocol.jsonl'),'utf8'));
    h.recovery=verifyConversationRecovery(logRoot,path.join(logRoot,'fake-cli-protocol.jsonl'));
    h.streaming=verifyNativeTranscriptEvidence(raw,{processId:initial.a.processId,ideVersion:e.host.version});h.rawMetrics=rel(raw);
    for(const c of h.streaming.cases)for(const key of ['selectionPreserved','selectionViewportPreserved','userScrollPreserved','followedBeforeSelection','followedAfterResume','streamedPlainThenStyled'])assert.equal(c[key],true,key);
    const phases=read(path.join(logRoot,'conversation-recovery-host-phases.json'));assert.deepEqual(phases.nativeTranscript,h.streaming);h.phases=phases.phases;h.jvmProcessIds={initial:initial.a.processId,restart:read(path.join(logRoot,'conversation-recovery-restart.json')).a.processId};assert.notEqual(h.phases[0].processId,h.phases[1].processId);
    assert.equal(initial.installation.archiveSha256,artifact[0].sha256);
    const zip=fs.readFileSync(bound),entries=listZipEntries(zip),jarHashes={};for(const [name,entry]of entries){if(!name.endsWith('/'))jarHashes[name.slice(name.indexOf('/')+1)]=hash(readZipEntry(zip,entry));}assert.deepEqual(jarHashes,initial.installation.files);h.installedZipFiles=jarHashes;
   }else{
    assert.equal(e.journeyId,'jetbrains-chat-control-workbench-restart-rewind');
    h.needsInput=verifyWorkbenchVisibilityMetrics(diag('workbench-metrics.jsonl'));
    h.workbench=verifyWorkbenchFixtureLedger(diag('fake-cli-protocol.jsonl'),h.needsInput.readinessSamples);
    h.rewind=verifyRewindFixtureLedger(diag('fake-cli-protocol.jsonl'));
    h.modelConfiguration=verifyModelConfigurationFixtureLedger(diag('fake-cli-protocol.jsonl'));
    const phases=read(diag('workbench-host-phases.json'));h.phases=phases.phases;assert.deepEqual(h.phases.map(p=>p.phase),['initial','restart']);assert.notEqual(h.phases[0].processId,h.phases[1].processId);assert.equal(phases.visibilitySummary.p95LatencyMs,h.needsInput.p95LatencyMs);h.needsInput=phases.visibilitySummary;
   }
  }
  h.status='verified';
 }catch(error){h.status='failed';h.issues.push(error.stack);issues.push({envelope:label,error:error.message});}
}
assert.equal(hosts.length,18);
for(const hostRoot of hostRoots.filter(p=>path.basename(p).startsWith('jetbrains-'))){const pair=hosts.filter(h=>h.envelope.startsWith(rel(hostRoot)+'/'));assert.equal(pair.length,2);assert.equal(pair[0].releaseArtifact.sha256,pair[1].releaseArtifact.sha256);}
const repoRoot=fileURLToPath(new URL('../../../../',import.meta.url));
const sourcePaths=['scripts/ide-journey-evidence.mjs','packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs','packages/jetbrains-plugin/scripts/conversation-recovery-evidence.mjs','packages/jetbrains-plugin/scripts/native-transcript-evidence.mjs','packages/vscode-extension/scripts/vsix-release-artifact.mjs','packages/vscode-extension/scripts/verify-vsix.mjs','packages/vscode-extension/test/extension-host/run.cjs','packages/vscode-extension/test/extension-host/cdp-journey.cjs','packages/vscode-extension/test/extension-host/driver/streaming-profile.cjs'];
const verifierSources=sourcePaths.map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(repoRoot,p)))}));
const sampleCoverage={vscode:{hostProfiles:6,sizes:[10000,100000,200000],updateSamplesPerSize:64,totalUpdateSamples:1152,frameIntervalsPerSize:63,totalFrameIntervals:1134,finalizations:18,measurementPhase:'initial',needsInputJourneys:6,needsInputSamplesPerJourney:100,totalNeedsInputSamples:600,warmupPerJourney:1},jetbrains:{hostProfiles:6,sizes:[10000,100000,200000],updateSamplesPerSize:64,totalUpdateSamples:1152,finalizations:18,totalSampledEdtTasksIncludingFinalize:1170,measurementPhase:'canonical initial',needsInputJourneys:6,needsInputSamplesPerJourney:100,totalNeedsInputSamples:600,observedReadinessSamplesPerJourney:40}};
const raw={schema:'cc-candidate96-host-raw-inventory/v1',releaseCommit:sha,workflowRun:'37054226885',hostArtifactCount:9,fileCount:inventory.length,files:inventory};
const verification={schema:'cc-candidate96-host-verification/v1',releaseCommit:sha,workflowRun:'37054226885',createdAt:new Date().toISOString(),candidateManifest,candidateIdentity,verifierSources,sampleCoverage,hostArtifactCount:9,journeyCount:hosts.length,status:issues.length?'failed':'verified',issues,hosts,limitations:['Local host envelopes bind commit labels and artifact hashes but contain no trusted CI provenance; producer workflow run identity is supplied separately.','Offline readback cannot re-observe the original live filesystem installation or processes.','Streaming samples cover the initial process only; restart checks cover recovery behavior, not a second streaming performance measurement.','VS performanceGate=false and JB sloStatus=not-evaluated: timings are measurements, not streaming SLO passes.','JB paintImmediately covers the visible region and long tasks cover sampled probe EDT tasks only; Markdown parse calls are uninstrumented.','Deterministic fixture content does not prove real-provider latency or fidelity.','Nine downloaded host artifacts exclude Remote-SSH evidence; this receipt does not verify that separate gate.','IDE host verification does not satisfy CLI CI or CLI Strict Sandbox release gates.']};
for(const [name,data]of [['raw-inventory.json',raw],['host-verification.json',verification]])fs.writeFileSync(path.join(root,name),JSON.stringify(data,null,2)+'\n');
const receipt={schema:'cc-candidate96-host-verification-receipt/v1',releaseCommit:sha,workflowRun:'37054226885',status:verification.status,hostArtifacts:9,journeys:18,verifiedJourneys:hosts.filter(h=>h.status==='verified').length,artifactRecords:hosts.reduce((n,h)=>n+h.artifactCount,0),issues,outputs:['raw-inventory.json','host-verification.json'].map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(root,p)))})),verifierSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))};
fs.writeFileSync(path.join(root,'verification-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
if (issues.length) process.exitCode = 1;
