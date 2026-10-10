import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const repo=process.cwd();
const destination='docs/research/cli/evidence/gap-2026-10-05/release-0.166.95/prepublish-attempt4';
const root=path.resolve(destination);
assert.ok(root.startsWith(path.resolve(repo)+path.sep));
assert.ok(!fs.existsSync(root),'Archive must be newly created; never overwrite evidence');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const slash=p=>p.replaceAll('\\','/');
const files=[],omittedFiles=[];
function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(path.join(directory,e.name)):[path.join(directory,e.name)]);}
function copy(source,target,scope){
 const bytes=fs.readFileSync(source);
 const resolved=path.resolve(root,target);assert.ok(resolved.startsWith(root+path.sep));
 fs.mkdirSync(path.dirname(resolved),{recursive:true});fs.writeFileSync(resolved,bytes,{flag:'wx'});
 const actual=fs.readFileSync(resolved);assert.ok(bytes.equals(actual));
 files.push({path:slash(target),source:slash(path.relative(repo,source)),bytes:bytes.length,sha256:hash(bytes),scope,byteForByteVerified:true});
}
function omit(source,reason){const bytes=fs.readFileSync(source);omittedFiles.push({source:slash(path.relative(repo,source)),bytes:bytes.length,sha256:hash(bytes),reason});}
const runRoot='.work/release-preflight-0.166.95/ide-arm64-a3f-failed';
const jobRoot='.work/release-preflight-0.166.95/ide-jb-windows-arm64-a3f-failed';
for(const [sourceRoot,target,scope] of [[runRoot,'ci-run','Original GitHub run/jobs/artifacts API capture'],[jobRoot,'ci-job','Original failing Windows ARM64 job API and raw job log']]){
 for(const source of walk(sourceRoot))copy(source,path.join(target,path.relative(sourceRoot,source)),scope);
}
const artifactRoot='.work/release-preflight-0.166.95/astra-jb-arm64-artifact-11625812501';
for(const source of walk(artifactRoot)){
 const relative=path.relative(artifactRoot,source);
 if(/\.(?:json|jsonl|log|xml|png)$/i.test(source))copy(source,path.join('host-artifact',relative),'Selected original artifact 11625812501: manifest, diagnostics, protocol, JUnit, failure screenshot and GUI guard');
 else omit(source,'Not copied: packaged release ZIP, binary test database or launcher wrapper; original artifact manifest retains its identity');
}
const contractRoot='.work/astra-popup-dispatch-contract-20261009';
for(const source of walk(contractRoot)){
 const relative=path.relative(contractRoot,source);
 if(source.endsWith('.class'))omit(source,'Compiled class omitted by archive scope; source, generated script, javap disassembly and class hashes retained');
 else copy(source,path.join('popup-contract',relative),'Original actual-generated-JS Rhino/Swing contract and independent Java bytecode review evidence');
}
const officialRoot='.work/astra-popup-official-source-20261010';
for(const source of walk(officialRoot)){
 if(path.basename(source)==='vendor-releases.original.json')omit(source,'Unrelated full vendor release catalog omitted; exact selected release, original payload size/hash and retrieval provenance retained');
 else copy(source,path.join('official-idea-source',path.relative(officialRoot,source)),'Official source bytes/metadata bound to IDEA build 262.8665.337 and immutable Git commit');
}
for(const name of ['PopupChooserBuilder','AbstractPopup','PopupFactoryImpl','PopupListAdapter'])copy('.work/astra-'+name+'-262.8665.337.java','official-idea-source/prior-analysis-captures/'+name+'.java','Earlier PowerShell-rendered source capture used during analysis; raw official bytes are archived separately');
for(const script of ['astra-capture-official-popup-sources-20261010.mjs','astra-finalize-official-popup-source-20261010.mjs','astra-archive-arm64-attempt4-20261010.mjs'])copy('.work/'+script,'archive-tools/'+script,'Archive/capture implementation, not product source');
const receiptSource='.work/astra-popup-dispatch-contract-20261009-compilation-tool-record.json';
const toolReceipt={recordType:'tool-presentation-record',rawShellLog:false,source:'Parent agent message quoting exec session 76569',exitCode:0,build:'BUILD SUCCESSFUL in 28s',lines:['Daemon will be stopped at the end of the build','Reusing configuration cache.',':checkKotlinGradlePluginConfigurationErrors',':compileUiTestKotlin NO-SOURCE',':compileUiTestJava','BUILD SUCCESSFUL in 28s','2 actionable tasks: 2 executed','Configuration cache entry reused.'],scope:'Compilation only; no GUI, host journey or CI re-run',recordedAt:new Date().toISOString()};
fs.writeFileSync(receiptSource,JSON.stringify(toolReceipt,null,2)+'\n',{flag:'wx'});
copy(receiptSource,'popup-contract/compilation-tool-record.json','Explicitly labeled tool presentation record; not original shell output');
const contract=JSON.parse(fs.readFileSync(path.join(root,'popup-contract/report.json')));
const resolution=JSON.parse(fs.readFileSync(path.join(root,'popup-contract/review-resolution.json')));
assert.equal(contract.caseCount,10);assert.equal(contract.passed,true);assert.equal(resolution.charArrayCastRemoved,true);assert.equal(resolution.generatedScriptUnchanged,true);
const jobLog=files.find(f=>f.path==='ci-job/job.log');assert.equal(jobLog.sha256,'f79aae2aa80b9f49bb586dab677027fe09cbae044208cc986e74f936f5a27804');
const manifest={
 schema:'chainlesschain.prepublish-attempt-evidence/v1',attempt:4,createdAt:new Date().toISOString(),releaseVersion:'0.166.95',sourceCommit:'a3f3ed3dd1fb809fb7fd520ad5a35616ae64bb3b',
 purpose:'Preserve the genuine Windows ARM64 rewind popup-transition failure and the narrowly scoped test-driver correction; this archive is not release-gate success evidence.',
 github:{runId:37947977140,jobId:113880537429,artifactId:11625812501,artifactArchiveSha256:'e01ebf0239d2e3ebf270324fae8d714b6bc0304fa1d55071268b7395c3f4a794',artifactDigestSource:'ci-run/artifacts-1.json',artifactZipRetained:false,artifactExtractedFileVerification:'All 30 files listed by the downloaded journey-evidence manifest were SHA256-verified before this selected archive; included originals remain byte-preserved.'},
 failure:{host:{os:'win32',architecture:'arm64',ideVersion:'2026.2.0.1',ideBuild:'262.8665.337'},result:'failure',uiSmokeTests:{passed:7,total:8},failedCase:'chainlessChainChatAndControlJourney',error:"Popup item 'Restore code + conversation' did not appear within 45s; visible lists=",confirmed:['Restore code and Restore conversation reached preview and confirm in the captured deterministic CLI protocol.','The third checkpoint-timeline response was recorded at 2026-10-09T15:19:07.328Z, followed by no restore-both preview or confirm request.','Failure screenshot contains no action popup; the test failed at the timeline-to-action-menu transition.'],rootCauseStatus:'unknown',notEstablished:['Exact focus/cancellation event or selected-item callback failure','Generic IDEA 2026.2 selector incompatibility','Restore-both engine execution failure','Network failure or infrastructure incident'],diagnosticLimitations:['Artifact contains no DOM or idea.log.','GUI guard records updater termination PIDs without per-event timestamps or focus evidence.','The host journey used a deterministic CLI peer; this is real-host plugin/UI evidence, not production checkpoint engine execution evidence.']},
 correction:{scope:'IdeUiSmokeTest test driver only; retain true menu/preview/confirm/completion assertions, existing 45 second budget and no newly added retry.',changes:['Capture target, label and prefix in an IIFE.','Validate showing and unique target, select target and execute the real Enter action in one deferred EDT runnable.','Persist/log scheduled, entered, validated, dispatch-returned or failed states and focus diagnostics.','Require dispatch-returned and hidden; still require the genuine next popup and preview/confirm assertions.'],reviewFinding:'Java generic callJs result initially selected String.valueOf(char[]); corrected to Object overload and independently verified in bytecode.',correctedSourceSha256:resolution.correctedSourceSha256,correctedClassSha256:resolution.correctedClassSha256},
 contract:{report:'popup-contract/report.json',reviewResolution:'popup-contract/review-resolution.json',passed:10,total:10,execution:'Actual compiled generator output, real Rhino 1.7.15, real Swing JList and EDT; controlled substitute IDEA scheduler and injected isShowing in a headless JVM.',realIdeExecuted:false,realPopupExecuted:false,originalCiFailureReproduced:false,selectedCallbackCompletionProven:false,firstAttempt:'Incomplete PowerShell invocation stopped on expected stderr; original outputs retained, complete second invocation passed.',postCorrection:'Generated JS was byte-identical after Java Object-overload correction; 10 scenarios were not repeated.'},
 officialSourceReview:{version:'2026.2.0.1',build:'262.8665.337',tag:'idea/262.8665.337',commit:'15645ead6f20019cc2537dbbd43df4eb344423a8',provenance:'official-idea-source/provenance.json',conclusion:'Normal Enter closes and disposes the parent popup before the focus-settled selected callback. This does not support changing production code on the theory that a later parent dispose necessarily removes the child popup. Enter dispatched after cancellation can return through the cancelled/disposed guard without executing the selected callback; mechanism confirmed, occurrence in original CI unproven.'},
 omittedDependencies:[{name:'rhino-1.7.15.jar',sha256:JSON.parse(fs.readFileSync(path.join(root,'popup-contract/run2-metadata.json'))).rhinoSha256,hashSource:'popup-contract/run2-metadata.json',copied:false}],
 verification:{byteForByteVerified:true,files:files.length,totalBytes:files.reduce((n,f)=>n+f.bytes,0),includedFileDigestsVerifiedAgainstCopiedBytes:true},files,omittedFiles
};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
for(const file of files){const source=fs.readFileSync(path.resolve(file.source));const target=fs.readFileSync(path.join(root,file.path));assert.ok(source.equals(target));assert.equal(target.length,file.bytes);assert.equal(hash(target),file.sha256);}
const verification={capturedAt:new Date().toISOString(),archive:destination,fileCount:files.length,bytes:manifest.verification.totalBytes,manifestBytes:fs.statSync(path.join(root,'manifest.json')).size,manifestSha256:hash(fs.readFileSync(path.join(root,'manifest.json'))),byteMismatches:0,digestMismatches:0,omittedFiles:omittedFiles.length};
fs.writeFileSync('.work/astra-prepublish-attempt4-archive-verification.json',JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
