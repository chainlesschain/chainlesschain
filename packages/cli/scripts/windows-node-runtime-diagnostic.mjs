#!/usr/bin/env node
/** Explicit experimental runtime diagnostics; never formal review admission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { createWindowsNativeEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const SCHEMA = "chainlesschain/windows-node-runtime-adapter@2";
const ADDON_DIGEST =
  "sha256:0dab7447d7732ebb132a087daefba158c6e2d4f26855ba488b7a0b8471428077";
const PRELOAD_DIGEST =
  "sha256:02782b94f3a85ab4a97036c2f50e6d55350b9f014b3ce078ef5b6f1c50b0b452";
const RUNTIME_DIGEST =
  "sha256:ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3";
const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Experimental runtime diagnostic: ${detail}`);
};
const childSource = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');
const mode=process.argv[2];
function reply(input){return {marker:'cc-adapted-child',mode,pid:process.pid,ppid:process.ppid,inputDigest:crypto.createHash('sha256').update(input).digest('hex'),bytes:input.length,resolvedSelf:fs.realpathSync.native(__filename)};}
if(mode==='fork'){process.once('message',value=>process.send(reply(Buffer.from(value.input,'base64')),()=>process.disconnect()));}
else{const input=fs.readFileSync(0);process.stdout.write(JSON.stringify(reply(input))+'\n');process.stderr.write('CC_ADAPTED_STDERR\n');}
`;
const checkSource = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const workspace=process.argv[2],scratch=process.argv[3];
for(const[key,relative]of Object.entries({TMP:'tmp',TEMP:'tmp',HOME:'home',USERPROFILE:'home',APPDATA:'home/AppData/Roaming',LOCALAPPDATA:'home/AppData/Local'})){
const target=path.join(scratch,relative);fs.mkdirSync(target,{recursive:true});process.env[key]=target;
}
fs.mkdirSync(path.join(scratch,'adapter-receipts'));
const journal=fs.openSync(path.join(scratch,'node-runtime-journal.jsonl'),'wx');let seq=0;
function record(stage,detail={}){fs.writeSync(journal,JSON.stringify({seq:seq++,stage,pid:process.pid,...detail})+'\n');fs.fsyncSync(journal);}
record('started');
(async()=>{
 const preload=path.join(workspace,'adapter/windows-node-runtime-preload.cjs');
 const adapter=require(preload);record('installed',{native:adapter.snapshot()});
 record('realpath-started');
 const realpaths=[];
 for(const[label,target]of [['scratch',path.join(scratch,'tmp')],['workspace',path.join(workspace,'child.cjs')]]){
  const before=adapter.snapshot(),resolved=fs.realpathSync.native(target),after=adapter.snapshot();
  if(resolved!==target||after.realpathMapped<=before.realpathMapped)throw Error('Private canonical realpath did not use adapter: '+label);
  realpaths.push({label,requested:target,resolved,mappedBefore:before.realpathMapped,mappedAfter:after.realpathMapped});
 }
 record('realpath-completed',{realpaths});
 record('outside-started');
 const outsideAttempts=[];let outside=null;
 const outsideProven=value=>['EPERM','EACCES'].includes(value.error)&&value.result===null&&value.fallbacksAfter===value.fallbacksBefore+1&&value.rejectedAfter===value.rejectedBefore+1&&value.mappedAfter===value.mappedBefore;
 for(const outsidePath of [path.dirname(path.dirname(workspace)),process.env.SystemRoot,path.join(process.env.SystemRoot,'System32'),path.join(process.env.SystemRoot,'System32/kernel32.dll')]){
  const beforeOutside=adapter.snapshot();let outsideError=null,outsideResult=null;
  try{outsideResult=fs.realpathSync.native(outsidePath);}catch(error){outsideError=error.code;}
  const afterOutside=adapter.snapshot(),attempt={requested:outsidePath,result:outsideResult,error:outsideError,
   fallbacksBefore:beforeOutside.realpathFallbacks,fallbacksAfter:afterOutside.realpathFallbacks,
   rejectedBefore:beforeOutside.realpathRejected,rejectedAfter:afterOutside.realpathRejected,
   mappedBefore:beforeOutside.realpathMapped,mappedAfter:afterOutside.realpathMapped};
  outsideAttempts.push(attempt);if(outsideProven(attempt)){outside=attempt;break;}
 }
 record('outside-completed',{outside,outsideAttempts});
 const contract=adapter.childContract(),input=Buffer.from(Array.from({length:97},(_,i)=>(i*17+5)%256));
 const expected=crypto.createHash('sha256').update(input).digest('hex'),child=path.join(workspace,'child.cjs');
 const execArgv=['--preserve-symlinks','--preserve-symlinks-main',...contract.execArgv];
 const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.dirname(process.execPath),
   TMP:process.env.TMP,TEMP:process.env.TEMP,HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,...contract.environment};
 const observations=[];
 function verify(value,mode,pid){if(value.marker!=='cc-adapted-child'||value.mode!==mode||value.pid!==pid||value.ppid!==process.pid||value.inputDigest!==expected||value.bytes!==input.length||value.resolvedSelf!==child)throw Error('Child data/identity/realpath mismatch');}
 record('sync-started');
 const sync=cp.spawnSync(contract.executable,[...execArgv,child,'sync'],{encoding:'utf8',windowsHide:true,timeout:3000,maxBuffer:65536,env,input});
 if(sync.status!==0||sync.signal||sync.error)throw Error('Sync child failed: '+sync.stderr+' '+sync.error?.message);
 const syncValue=JSON.parse(sync.stdout.trim());verify(syncValue,'sync',sync.pid);
 if(sync.stderr!=='CC_ADAPTED_STDERR\n')throw Error('Sync stderr differs');
 observations.push(syncValue);record('sync-completed',{childPid:sync.pid});
 record('async-started');
 const asyncValue=await new Promise((resolve,reject)=>{
  const processChild=cp.spawn(contract.executable,[...execArgv,child,'async'],{windowsHide:true,env,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',settled=false;
  const timer=setTimeout(()=>{reject(Error('Async child deadline'));},3000);
  processChild.on('error',error=>{clearTimeout(timer);reject(error);});
  processChild.stdout.on('data',data=>{stdout+=data;if(stdout.length>65536)reject(Error('Async stdout exceeds bound'));});
  processChild.stderr.on('data',data=>{stderr+=data;if(stderr.length>65536)reject(Error('Async stderr exceeds bound'));});
  processChild.on('close',(status,signal)=>{clearTimeout(timer);if(settled)return;settled=true;
   try{if(status!==0||signal||stderr!=='CC_ADAPTED_STDERR\n')throw Error('Async child exit/stderr differs: '+stderr);
    const value=JSON.parse(stdout.trim());verify(value,'async',processChild.pid);resolve(value);}catch(error){reject(error);}});
  processChild.stdin.end(input);
 });
 observations.push(asyncValue);record('async-completed',{childPid:asyncValue.pid});
 record('fork-started');
 const forkValue=await new Promise((resolve,reject)=>{
  const processChild=cp.fork(child,['fork'],{execPath:contract.executable,execArgv,windowsHide:true,env,stdio:['pipe','pipe','pipe','ipc']});
  let value=null,stdout='',stderr='';const timer=setTimeout(()=>reject(Error('Fork child deadline')),3000);
  processChild.on('error',error=>{clearTimeout(timer);reject(error);});
  processChild.stdout.on('data',data=>{stdout+=data;if(stdout.length>65536)reject(Error('Fork stdout exceeds bound'));});
  processChild.stderr.on('data',data=>{stderr+=data;if(stderr.length>65536)reject(Error('Fork stderr exceeds bound'));});
  processChild.on('message',message=>{if(value)reject(Error('Duplicate fork reply'));else value=message;});
  processChild.on('close',(status,signal)=>{clearTimeout(timer);try{if(status!==0||signal||stdout||stderr||!value)throw Error('Fork exit/reply differs: '+stderr);verify(value,'fork',processChild.pid);resolve(value);}catch(error){reject(error);}});
  processChild.send({input:input.toString('base64')});
 });
 observations.push(forkValue);record('fork-completed',{childPid:forkValue.pid});
 const native=adapter.snapshot();if(native.serverMapped<1||native.clientMapped<1)throw Error('Actual pipe hooks were not used');
 if(!outside)throw Error('Outside actual-handle realpath was not rejected by adapter; inspect bounded outsideAttempts');
 record('completed',{observations,native,realpaths,outside});
 process.stdout.write('CC_NODE_RUNTIME:'+JSON.stringify({schema:${JSON.stringify(SCHEMA)},pid:process.pid,observations,native,realpaths,outside})+'\n');
})().catch(error=>{
 let nativeFailure=null;try{nativeFailure=JSON.parse(require(path.join(workspace,'adapter/windows-node-runtime-adapter.node')).snapshot());}catch(snapshotError){nativeFailure={snapshotError:snapshotError.message};}
 record('failed',{error:error.message,nativeFailure});process.stderr.write(error.stack+'\n');process.exitCode=1;
}).finally(()=>fs.closeSync(journal));
`;

export const runtimeAdapterDiagnosticIdentity = Object.freeze({
  schema: SCHEMA,
  addonDigest: ADDON_DIGEST,
  preloadDigest: PRELOAD_DIGEST,
  runtimeDigest: RUNTIME_DIGEST,
  childDigest: evalDigest(childSource),
  checkDigest: evalDigest(checkSource),
});

/** Validate one observed process receipt. This never establishes descendant
 * completeness, a frozen-toolchain result, or formal admission eligibility.
 * Expected hashes/root/runtime must come from the supervisor's captured bytes.
 */
export function inspectRuntimeAdapterProcessReceipt(row, expected) {
  const integer = (value) => Number.isSafeInteger(value) && value >= 0;
  const matchesDigest = (actual, digest) =>
    typeof digest === "string" &&
    /^sha256:[a-f0-9]{64}$/.test(digest) &&
    actual === digest.slice(7);
  const native = row?.native;
  const proof = native?.rootProof;
  requireCondition(
    row?.schema === SCHEMA &&
      row.experimental === true &&
      row.admissionEligible === false &&
      ["installed", "exit"].includes(row.phase) &&
      (!expected.phase || row.phase === expected.phase) &&
      integer(row.pid) &&
      row.pid > 0 &&
      row.pid === expected.pid &&
      integer(row.ppid) &&
      row.ppid > 0 &&
      row.ppid !== row.pid &&
      (expected.ppid === undefined || row.ppid === expected.ppid) &&
      row.execPath === expected.runtimePath &&
      row.nodeVersion === (expected.nodeVersion ?? process.versions.node) &&
      matchesDigest(row.runtimeSha256, expected.runtimeDigest) &&
      matchesDigest(row.addonSha256, expected.addonDigest) &&
      matchesDigest(row.preloadSha256, expected.preloadDigest) &&
      matchesDigest(row.manifestSha256, expected.adapterManifestDigest) &&
      (row.phase !== "exit" || row.exitCode === 0),
    "observed process identity/byte receipt differs",
  );
  requireCondition(
    native?.schema === SCHEMA &&
      native.experimental === true &&
      native.admissionEligible === false &&
      native.pid === expected.pid &&
      native.appContainerSid === expected.appContainerSid &&
      native.capabilityCount === 0 &&
      native.inJob === true &&
      native.state === 2 &&
      native.patches === 3 &&
      native.installError === 0 &&
      native.supportedPrivateRealpath === true &&
      [
        "serverMapped",
        "clientMapped",
        "serverFailures",
        "clientFailures",
        "realpathMapped",
        "realpathFallbacks",
        "realpathRejected",
      ].every((key) => integer(native[key])) &&
      integer(native.serverFailures) &&
      integer(native.clientFailures),
    "observed native installation/token/use differs",
  );
  requireCondition(
    proof?.dos === expected.privateRoot &&
      typeof proof.nt === "string" &&
      /^\\Device\\[^\\]+\\/.test(proof.nt) &&
      /^[0-9]+$/.test(proof.volumeSerial) &&
      /^[a-f0-9]{32}$/.test(proof.fileId) &&
      proof.normalizedNtFlags === 2 &&
      proof.handlePinned === true &&
      proof.ancestorAuthority === "supervisor-private-tree-guards" &&
      proof.componentPolicy === "pinned-no-reparse-single-link-file-id" &&
      row.rootProofSha256 === evalDigest(JSON.stringify(proof)).slice(7) &&
      (expected.rootProof === undefined ||
        JSON.stringify(expected.rootProof) === JSON.stringify(proof)),
    "observed kernel root proof differs",
  );
  return row;
}

function readPlain(file, bound) {
  const before = fs.lstatSync(file, { bigint: true });
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size <= BigInt(bound),
    "bounded plain artifact required",
  );
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(fd, bytes, count, bytes.length - count, count);
      if (!read) break;
      count += read;
    }
    const after = fs.fstatSync(fd, { bigint: true }),
      named = fs.lstatSync(file, { bigint: true });
    requireCondition(
      count === Number(before.size) &&
        ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink"].every(
          (key) =>
            before[key] === opened[key] &&
            before[key] === named[key] &&
            before[key] === after[key],
        ),
      "artifact changed during read",
    );
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}
export function inspectRuntimeAdapterResult(report) {
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const result = report.execution,
    receipt = report.settlement;
  requireCondition(
    report.schema === "chainlesschain.windows-node-runtime-diagnostic/v2" &&
      report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.providerAssessed === false &&
      equal(report.capabilities, {}) &&
      report.addonDigest === ADDON_DIGEST &&
      report.preloadDigest === PRELOAD_DIGEST &&
      report.runtimeDigest === RUNTIME_DIGEST &&
      report.nodeVersion === "v22.22.2" &&
      report.architecture === "x64" &&
      report.platform === "win32" &&
      result?.status === 0 &&
      result.signal === null &&
      result.error === null &&
      result.stderr === "" &&
      receipt?.cleanupConfirmed === true &&
      receipt.executionFailed === false &&
      receipt.targetExitCode === 0 &&
      receipt.capabilityCount === 0 &&
      receipt.loopbackExemptionAbsent === true &&
      typeof report.manifestDigest === "string" &&
      receipt.manifestDigest === report.manifestDigest.slice(7) &&
      evalDigest(JSON.stringify(report.manifest)) === report.manifestDigest &&
      report.manifest.root === report.stage &&
      report.manifest.runtime.sha256 === report.runtimeDigest.slice(7) &&
      count(receipt.targetPid) &&
      receipt.targetPid > 0,
    "execution or scope/cleanup differs",
  );
  const frames = result.stdout.trim().split(/\r?\n/u);
  requireCondition(
    frames.length === 1 && frames[0].startsWith("CC_NODE_RUNTIME:"),
    "unique runtime frame required",
  );
  const frame = JSON.parse(frames[0].slice("CC_NODE_RUNTIME:".length));
  const privateRoot = report.manifest.root;
  const workspace = path.win32.join(privateRoot, "workspace");
  const scratch = path.win32.join(privateRoot, "scratch");
  requireCondition(
    report.manifest.workspace === workspace &&
      report.manifest.scratch === scratch &&
      report.manifest.runtime.path ===
        path.win32.join(privateRoot, "control/node.exe"),
    "private tree layout differs",
  );
  const boundFile = (relative, digest) => {
    const matches = report.manifest.files.filter(
      (file) => file.path === path.win32.join(privateRoot, relative),
    );
    requireCondition(
      matches.length === 1 && matches[0].sha256 === digest.slice(7),
      "captured diagnostic bytes differ",
    );
  };
  boundFile(
    "workspace/adapter/windows-node-runtime-adapter.node",
    ADDON_DIGEST,
  );
  boundFile(
    "workspace/adapter/windows-node-runtime-preload.cjs",
    PRELOAD_DIGEST,
  );
  boundFile(
    "workspace/child.cjs",
    runtimeAdapterDiagnosticIdentity.childDigest,
  );
  boundFile("control/check.cjs", runtimeAdapterDiagnosticIdentity.checkDigest);
  requireCondition(
    typeof report.adapterManifestRaw === "string",
    "raw adapter manifest missing",
  );
  const adapterManifestDigest = evalDigest(report.adapterManifestRaw);
  boundFile(
    "workspace/adapter/windows-node-runtime-adapter.manifest.json",
    adapterManifestDigest,
  );
  const adapterManifest = JSON.parse(report.adapterManifestRaw);
  requireCondition(
    adapterManifest.schema === SCHEMA &&
      adapterManifest.experimental === true &&
      adapterManifest.admissionEligible === false &&
      adapterManifest.expectedSidEnvironment ===
        "CC_WINDOWS_APPCONTAINER_SID" &&
      adapterManifest.nodeVersion === "22.22.2" &&
      adapterManifest.nodeModuleVersion === "127" &&
      equal(adapterManifest.runtime, {
        path: "../../control/node.exe",
        sha256: RUNTIME_DIGEST.slice(7),
      }) &&
      equal(adapterManifest.addon, {
        path: "windows-node-runtime-adapter.node",
        sha256: ADDON_DIGEST.slice(7),
      }) &&
      equal(adapterManifest.preload, {
        path: "windows-node-runtime-preload.cjs",
        sha256: PRELOAD_DIGEST.slice(7),
      }) &&
      adapterManifest.receiptDirectory === "../../scratch/adapter-receipts",
    "adapter manifest contract differs",
  );
  const proof = frame.native?.rootProof;
  requireCondition(
    proof?.dos === privateRoot &&
      typeof proof.nt === "string" &&
      /^\\Device\\[^\\]+\\/.test(proof.nt) &&
      /^[0-9]+$/.test(proof.volumeSerial) &&
      /^[a-f0-9]{32}$/.test(proof.fileId) &&
      proof.normalizedNtFlags === 2 &&
      proof.handlePinned === true &&
      proof.ancestorAuthority === "supervisor-private-tree-guards" &&
      proof.componentPolicy === "pinned-no-reparse-single-link-file-id",
    "private root kernel proof differs",
  );
  const proofDigest = evalDigest(JSON.stringify(proof)).slice(7);
  const inspectNative = (native, pid) => {
    requireCondition(
      native?.schema === SCHEMA &&
        native.experimental === true &&
        native.admissionEligible === false &&
        native.pid === pid &&
        native.appContainerSid === receipt.appContainerSid &&
        native.capabilityCount === 0 &&
        native.inJob === true &&
        native.state === 2 &&
        native.patches === 3 &&
        native.installError === 0 &&
        native.supportedPrivateRealpath === true &&
        equal(native.rootProof, proof) &&
        [
          "serverMapped",
          "clientMapped",
          "serverFailures",
          "clientFailures",
          "realpathMapped",
          "realpathFallbacks",
          "realpathRejected",
        ].every((key) => count(native[key])) &&
        count(native.serverFailures) &&
        count(native.clientFailures),
      "native installation/token/root/use differs",
    );
  };
  inspectNative(frame.native, frame.pid);
  requireCondition(
    frame.schema === SCHEMA &&
      frame.pid === receipt.targetPid &&
      frame.native.pid === receipt.targetPid &&
      frame.native.capabilityCount === 0 &&
      frame.native.inJob === true &&
      frame.native.state === 2 &&
      frame.native.patches === 3 &&
      frame.native.installError === 0 &&
      frame.native.appContainerSid === receipt.appContainerSid &&
      frame.native.serverMapped > 0 &&
      frame.native.clientMapped > 0 &&
      frame.native.realpathMapped >= 2 &&
      frame.native.realpathRejected >= 1,
    "native pipe installation/token/use differs",
  );
  requireCondition(
    JSON.stringify(frame.observations.map((row) => row.mode)) ===
      JSON.stringify(["sync", "async", "fork"]) &&
      new Set(frame.observations.map((row) => row.pid)).size === 3 &&
      frame.observations.every(
        (row) =>
          Number.isSafeInteger(row.pid) &&
          row.pid > 0 &&
          row.pid !== frame.pid &&
          row.ppid === frame.pid &&
          row.bytes === 97 &&
          row.inputDigest === report.inputDigest &&
          row.marker === "cc-adapted-child" &&
          row.resolvedSelf === path.win32.join(workspace, "child.cjs"),
      ),
    "child population/identity/data differs",
  );
  requireCondition(
    report.inputDigest ===
      evalDigest(
        Buffer.from(Array.from({ length: 97 }, (_, i) => (i * 17 + 5) % 256)),
      ).slice(7),
    "binary input digest differs",
  );
  requireCondition(
    Array.isArray(frame.realpaths) && frame.realpaths.length === 2,
    "private realpath population differs",
  );
  for (const [index, row] of frame.realpaths.entries()) {
    const expected =
      index === 0
        ? path.win32.join(scratch, "tmp")
        : path.win32.join(workspace, "child.cjs");
    requireCondition(
      row.label === ["scratch", "workspace"][index] &&
        row.requested === expected &&
        row.resolved === expected &&
        count(row.mappedBefore) &&
        count(row.mappedAfter) &&
        row.mappedAfter > row.mappedBefore,
      "private canonical realpath evidence differs",
    );
  }
  const outside = frame.outside;
  requireCondition(
    [
      path.win32.dirname(privateRoot),
      report.systemRoot,
      path.win32.join(report.systemRoot ?? "", "System32"),
      path.win32.join(report.systemRoot ?? "", "System32/kernel32.dll"),
    ].includes(outside?.requested) &&
      outside.result === null &&
      ["EPERM", "EACCES"].includes(outside.error) &&
      [
        "fallbacksBefore",
        "fallbacksAfter",
        "rejectedBefore",
        "rejectedAfter",
        "mappedBefore",
        "mappedAfter",
      ].every((key) => count(outside[key])) &&
      outside.fallbacksAfter === outside.fallbacksBefore + 1 &&
      outside.rejectedAfter === outside.rejectedBefore + 1 &&
      outside.mappedAfter === outside.mappedBefore &&
      frame.native.realpathRejected >= outside.rejectedAfter,
    "outside actual-handle rejection evidence differs",
  );
  for (const pid of [frame.pid, ...frame.observations.map((row) => row.pid)]) {
    const installed = report.adapterReceipts.find(
      (row) => row.pid === pid && row.phase === "installed",
    );
    const exit = report.adapterReceipts.find(
      (row) => row.pid === pid && row.phase === "exit",
    );
    for (const row of [installed, exit]) {
      inspectNative(row?.native, pid);
      requireCondition(
        row?.schema === SCHEMA &&
          row.experimental === true &&
          row.admissionEligible === false &&
          row.execPath === report.manifest.runtime.path &&
          row.nodeVersion === "22.22.2" &&
          row.manifestSha256 === adapterManifestDigest.slice(7) &&
          row.rootProofSha256 === proofDigest &&
          count(row.ppid) &&
          row.ppid > 0 &&
          row.ppid !== pid &&
          (pid === frame.pid || row.ppid === frame.pid) &&
          row.native.pid === pid &&
          row.native.appContainerSid === receipt.appContainerSid &&
          row.native.capabilityCount === 0 &&
          row.native.inJob === true &&
          row.native.state === 2 &&
          row.native.patches === 3 &&
          row.runtimeSha256 === report.runtimeDigest.slice(7) &&
          row.addonSha256 === report.addonDigest.slice(7) &&
          row.preloadSha256 === report.preloadDigest.slice(7),
        "actual process preload receipt missing or differs",
      );
    }
    requireCondition(
      exit.exitCode === 0 &&
        exit.ppid === installed.ppid &&
        exit.native.realpathMapped > 0 &&
        [
          "serverMapped",
          "clientMapped",
          "realpathMapped",
          "realpathFallbacks",
          "realpathRejected",
        ].every((key) => exit.native[key] >= installed.native[key]),
      "instrumented process exit differs",
    );
  }
  requireCondition(
    report.adapterReceipts.length === 8 &&
      new Set(report.adapterReceipts.map((row) => `${row.pid}/${row.phase}`))
        .size === 8,
    "extra/missing adapted process receipts",
  );
  requireCondition(
    typeof report.journalRaw === "string" &&
      evalDigest(report.journalRaw) === report.journalDigest,
    "journal bytes/digest differ",
  );
  const journal = report.journalRaw
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  const stages = [
    "started",
    "installed",
    "realpath-started",
    "realpath-completed",
    "outside-started",
    "outside-completed",
    "sync-started",
    "sync-completed",
    "async-started",
    "async-completed",
    "fork-started",
    "fork-completed",
    "completed",
  ];
  requireCondition(
    journal.length === stages.length &&
      journal.every(
        (row, index) =>
          row.seq === index &&
          row.stage === stages[index] &&
          row.pid === frame.pid,
      ) &&
      equal(journal[3].realpaths, frame.realpaths) &&
      equal(journal[5].outside, frame.outside) &&
      frame.observations.every(
        (row, index) => journal[7 + index * 2].childPid === row.pid,
      ) &&
      equal(journal[12].native, frame.native) &&
      equal(journal[12].observations, frame.observations) &&
      equal(journal[12].realpaths, frame.realpaths) &&
      equal(journal[12].outside, frame.outside),
    "journal stages/completion differ",
  );
  return frame;
}

export async function runRuntimeAdapterDiagnostic({
  addon,
  addonDigest,
  output,
}) {
  requireCondition(
    process.platform === "win32" &&
      process.arch === "x64" &&
      path.isAbsolute(output),
    "Windows x64 and absolute new output required",
  );
  const binary = readPlain(path.resolve(addon), 1024 * 1024);
  requireCondition(
    addonDigest === ADDON_DIGEST && evalDigest(binary) === addonDigest,
    "independent addon byte digest differs",
  );
  const preload = fs.readFileSync(
    new URL("./diagnostics/windows-node-runtime-preload.cjs", import.meta.url),
  );
  requireCondition(
    evalDigest(preload) === PRELOAD_DIGEST,
    "pinned preload byte digest differs",
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-node-runtime-source-"),
  );
  fs.mkdirSync(path.join(root, "adapter"));
  const runtimeDigest = evalDigest(
    readPlain(fs.realpathSync.native(process.execPath), 128 * 1024 * 1024),
  );
  requireCondition(
    runtimeDigest === RUNTIME_DIGEST && process.versions.node === "22.22.2",
    "pinned official runtime differs",
  );
  const manifest = {
    schema: SCHEMA,
    experimental: true,
    admissionEligible: false,
    expectedSidEnvironment: "CC_WINDOWS_APPCONTAINER_SID",
    nodeVersion: process.versions.node,
    nodeModuleVersion: process.versions.modules,
    runtime: { path: "../../control/node.exe", sha256: runtimeDigest.slice(7) },
    addon: {
      path: "windows-node-runtime-adapter.node",
      sha256: addonDigest.slice(7),
    },
    preload: {
      path: "windows-node-runtime-preload.cjs",
      sha256: evalDigest(preload).slice(7),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-runtime-adapter.node"),
    binary,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-runtime-preload.cjs"),
    preload,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-runtime-adapter.manifest.json"),
    JSON.stringify(manifest) + "\n",
    { flag: "wx" },
  );
  fs.writeFileSync(path.join(root, "child.cjs"), childSource, { flag: "wx" });
  fs.mkdirSync(output, { mode: 0o700 });
  const input = Buffer.from(
    Array.from({ length: 97 }, (_, i) => (i * 17 + 5) % 256),
  );
  const report = {
    schema: "chainlesschain.windows-node-runtime-diagnostic/v2",
    experimental: true,
    admissionEligible: false,
    formalSample: false,
    providerAssessed: false,
    capabilities: {},
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    osRelease: os.release(),
    systemRoot: process.env.SystemRoot,
    runtimeDigest,
    adapterManifestRaw: JSON.stringify(manifest) + "\n",
    addonDigest,
    preloadDigest: evalDigest(preload),
    inputDigest: evalDigest(input).slice(7),
    diagnosticCompleted: false,
  };
  try {
    const evaluator = createWindowsNativeEvaluator({
      sourceRoot: root,
      files: [
        "adapter/windows-node-runtime-adapter.node",
        "adapter/windows-node-runtime-preload.cjs",
        "adapter/windows-node-runtime-adapter.manifest.json",
        "child.cjs",
      ],
      checkSource,
      wallTimeMs: 15000,
    });
    report.stage = evaluator.root;
    report.manifest = evaluator.manifest;
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    const { result, receipt } = await evaluator.execute();
    report.execution = {
      status: result.status,
      signal: result.signal,
      error: result.error?.message ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    report.settlement = receipt;
    const journal = path.join(
      evaluator.manifest.scratch,
      "node-runtime-journal.jsonl",
    );
    if (fs.existsSync(journal)) {
      const bytes = readPlain(journal, 65536);
      report.journalDigest = evalDigest(bytes);
      report.journalRaw = bytes.toString("utf8");
      fs.writeFileSync(path.join(output, "journal.jsonl"), bytes, {
        flag: "wx",
      });
    }
    const receipts = path.join(evaluator.manifest.scratch, "adapter-receipts");
    report.adapterReceipts = [];
    if (fs.existsSync(receipts))
      for (const file of fs.readdirSync(receipts).sort()) {
        requireCondition(
          /^runtime-adapter-[1-9][0-9]*-(installed|exit)\.json$/u.test(file),
          "unknown preload receipt artifact",
        );
        report.adapterReceipts.push(
          JSON.parse(readPlain(path.join(receipts, file), 16384)),
        );
      }
    report.completion = inspectRuntimeAdapterResult(report);
    report.diagnosticCompleted = true;
  } catch (error) {
    report.error = error.message;
    if (error.nativeEvaluator) report.failure = error.nativeEvaluator;
  } finally {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  return report;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { values } = parseArgs({
      options: {
        "confirm-native": { type: "boolean" },
        addon: { type: "string" },
        "addon-digest": { type: "string" },
        output: { type: "string" },
      },
    });
    requireCondition(
      values["confirm-native"] === true,
      "explicit --confirm-native required",
    );
    const r = await runRuntimeAdapterDiagnostic({
      addon: values.addon,
      addonDigest: values["addon-digest"],
      output: values.output,
    });
    console.log(
      JSON.stringify({
        diagnosticCompleted: r.diagnosticCompleted,
        error: r.error ?? null,
        output: values.output,
      }),
    );
    process.exitCode = r.diagnosticCompleted ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
