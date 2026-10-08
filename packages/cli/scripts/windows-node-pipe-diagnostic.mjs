#!/usr/bin/env node
/** Explicit experimental runtime diagnostics; never formal review admission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { evalDigest } from "../src/lib/eval/evidence.js";
import { createWindowsNativeEvaluator } from "../src/lib/process-execution-broker/windows-native-evaluator.js";

const SCHEMA = "chainlesschain/windows-node-pipe-adapter@1";
const requireCondition = (value, detail) => {
  if (!value) throw new Error(`Experimental pipe diagnostic: ${detail}`);
};
const childSource = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto');
const mode=process.argv[2];
function reply(input){return {marker:'cc-adapted-child',mode,pid:process.pid,ppid:process.ppid,inputDigest:crypto.createHash('sha256').update(input).digest('hex'),bytes:input.length};}
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
const journal=fs.openSync(path.join(scratch,'pipe-runtime-journal.jsonl'),'wx');let seq=0;
function record(stage,detail={}){fs.writeSync(journal,JSON.stringify({seq:seq++,stage,pid:process.pid,...detail})+'\n');fs.fsyncSync(journal);}
record('started');
(async()=>{
 const preload=path.join(workspace,'adapter/windows-node-pipe-preload.cjs');
 const adapter=require(preload);record('installed',{native:adapter.snapshot()});
 const contract=adapter.childContract(),input=Buffer.from(Array.from({length:97},(_,i)=>(i*17+5)%256));
 const expected=crypto.createHash('sha256').update(input).digest('hex'),child=path.join(workspace,'child.cjs');
 const execArgv=['--preserve-symlinks','--preserve-symlinks-main',...contract.execArgv];
 const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.dirname(process.execPath),
   TMP:process.env.TMP,TEMP:process.env.TEMP,HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA,...contract.environment};
 const observations=[];
 function verify(value,mode,pid){if(value.marker!=='cc-adapted-child'||value.mode!==mode||value.pid!==pid||value.ppid!==process.pid||value.inputDigest!==expected||value.bytes!==input.length)throw Error('Child data/identity mismatch');}
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
 record('completed',{observations,native});
 process.stdout.write('CC_PIPE_RUNTIME:'+JSON.stringify({schema:${JSON.stringify(SCHEMA)},pid:process.pid,observations,native})+'\n');
})().catch(error=>{record('failed',{error:error.message});process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>fs.closeSync(journal));
`;

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
            before[key] === named[key] &&
            before[key] === opened[key] &&
            before[key] === after[key],
        ),
      "artifact changed during read",
    );
    return bytes.subarray(0, count);
  } finally {
    fs.closeSync(fd);
  }
}
export function inspectPipeRuntimeResult(report) {
  const result = report.execution,
    receipt = report.settlement;
  requireCondition(
    report.schema ===
      "chainlesschain.windows-node-pipe-runtime-diagnostic/v1" &&
      report.experimental === true &&
      report.admissionEligible === false &&
      report.formalSample === false &&
      report.providerAssessed === false &&
      report.capabilities &&
      Object.keys(report.capabilities).length === 0 &&
      [
        report.manifestDigest,
        report.runtimeDigest,
        report.addonDigest,
        report.preloadDigest,
        report.adapterManifestDigest,
        report.journalDigest,
      ].every((digest) => /^sha256:[a-f0-9]{64}$/u.test(digest)) &&
      /^[a-f0-9]{64}$/u.test(report.inputDigest) &&
      result?.status === 0 &&
      result.signal === null &&
      result.error === null &&
      result.stderr === "" &&
      receipt?.cleanupConfirmed === true &&
      receipt.executionFailed === false &&
      receipt.targetExitCode === 0 &&
      receipt.capabilityCount === 0 &&
      receipt.loopbackExemptionAbsent === true &&
      Number.isSafeInteger(receipt.targetPid) &&
      receipt.targetPid > 0 &&
      receipt.manifestDigest === report.manifestDigest.slice(7),
    "execution or scope/cleanup differs",
  );
  const frames = result.stdout.trim().split(/\r?\n/u);
  requireCondition(
    frames.length === 1 && frames[0].startsWith("CC_PIPE_RUNTIME:"),
    "unique runtime frame required",
  );
  const frame = JSON.parse(frames[0].slice("CC_PIPE_RUNTIME:".length));
  requireCondition(
    frame.schema === SCHEMA &&
      frame.pid === receipt.targetPid &&
      frame.native.pid === receipt.targetPid &&
      frame.native.capabilityCount === 0 &&
      frame.native.inJob === true &&
      frame.native.state === 2 &&
      frame.native.patches === 2 &&
      frame.native.installError === 0 &&
      frame.native.appContainerSid === receipt.appContainerSid &&
      frame.native.serverMapped > 0 &&
      frame.native.clientMapped > 0,
    "native pipe installation/token/use differs",
  );
  requireCondition(
    JSON.stringify(frame.observations.map((row) => row.mode)) ===
      JSON.stringify(["sync", "async", "fork"]) &&
      new Set(frame.observations.map((row) => row.pid)).size === 3 &&
      frame.observations.every(
        (row) =>
          row.marker === "cc-adapted-child" &&
          Number.isSafeInteger(row.pid) &&
          row.pid > 0 &&
          row.pid !== frame.pid &&
          row.ppid === frame.pid &&
          row.bytes === 97 &&
          row.inputDigest === report.inputDigest,
      ),
    "child population/identity/data differs",
  );
  requireCondition(
    typeof report.journal === "string" &&
      Buffer.byteLength(report.journal) <= 65536 &&
      report.journal.endsWith("\n") &&
      evalDigest(Buffer.from(report.journal)) === report.journalDigest,
    "complete journal bytes/digest required",
  );
  const journal = report.journal
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const stages = [
    "started",
    "installed",
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
          row.pid === frame.pid &&
          row.stage === stages[index],
      ),
    "journal stage population/order/identity differs",
  );
  requireCondition(
    JSON.stringify(journal.at(-1).observations) ===
      JSON.stringify(frame.observations) &&
      JSON.stringify(journal.at(-1).native) === JSON.stringify(frame.native) &&
      [3, 5, 7].every(
        (index, childIndex) =>
          journal[index].childPid === frame.observations[childIndex].pid,
      ),
    "journal completion/actual child bindings differ",
  );
  for (const pid of [frame.pid, ...frame.observations.map((row) => row.pid)]) {
    const installed = report.adapterReceipts.find(
      (row) => row.pid === pid && row.phase === "installed",
    );
    const exit = report.adapterReceipts.find(
      (row) => row.pid === pid && row.phase === "exit",
    );
    for (const row of [installed, exit])
      requireCondition(
        row?.schema === SCHEMA &&
          row.experimental === true &&
          row.admissionEligible === false &&
          row.ppid === (pid === frame.pid ? installed?.ppid : frame.pid) &&
          Number.isSafeInteger(row.ppid) &&
          row.ppid > 0 &&
          row.execPath === report.manifest.runtime.path &&
          row.nodeVersion === report.nodeVersion.slice(1) &&
          row.manifestSha256 === report.adapterManifestDigest.slice(7) &&
          row.native.schema === SCHEMA &&
          row.native.experimental === true &&
          row.native.admissionEligible === false &&
          row.native.pid === pid &&
          row.native.appContainerSid === receipt.appContainerSid &&
          row.native.capabilityCount === 0 &&
          row.native.inJob === true &&
          row.native.state === 2 &&
          row.native.patches === 2 &&
          row.native.installError === 0 &&
          row.runtimeSha256 === report.runtimeDigest.slice(7) &&
          row.addonSha256 === report.addonDigest.slice(7) &&
          row.preloadSha256 === report.preloadDigest.slice(7),
        "actual process preload receipt missing or differs",
      );
    requireCondition(exit.exitCode === 0, "instrumented process exit differs");
    for (const key of [
      "serverCalls",
      "clientCalls",
      "serverMapped",
      "clientMapped",
    ])
      requireCondition(
        Number.isSafeInteger(installed.native[key]) &&
          installed.native[key] >= 0 &&
          Number.isSafeInteger(exit.native[key]) &&
          exit.native[key] >= installed.native[key],
        "native hook counters regressed or differ",
      );
    if (pid === frame.pid)
      requireCondition(
        JSON.stringify(installed.native) ===
          JSON.stringify(journal[1].native) &&
          JSON.stringify(exit.native) === JSON.stringify(frame.native),
        "parent receipt/journal differs",
      );
  }
  requireCondition(
    report.adapterReceipts.length === 8,
    "extra/missing adapted process receipts",
  );
  return frame;
}

export async function runPipeRuntimeDiagnostic({ addon, addonDigest, output }) {
  requireCondition(
    process.platform === "win32" &&
      process.arch === "x64" &&
      path.isAbsolute(output),
    "Windows x64 and absolute new output required",
  );
  const binary = readPlain(path.resolve(addon), 1024 * 1024);
  requireCondition(
    evalDigest(binary) === addonDigest,
    "independent addon byte digest differs",
  );
  const preload = fs.readFileSync(
    new URL("./diagnostics/windows-node-pipe-preload.cjs", import.meta.url),
  );
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pipe-runtime-source-"),
  );
  fs.mkdirSync(path.join(root, "adapter"));
  const runtimeDigest = evalDigest(
    readPlain(fs.realpathSync.native(process.execPath), 128 * 1024 * 1024),
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
      path: "windows-node-pipe-adapter.node",
      sha256: addonDigest.slice(7),
    },
    preload: {
      path: "windows-node-pipe-preload.cjs",
      sha256: evalDigest(preload).slice(7),
    },
    receiptDirectory: "../../scratch/adapter-receipts",
  };
  const adapterManifestBytes = Buffer.from(JSON.stringify(manifest) + "\n");
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-pipe-adapter.node"),
    binary,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-pipe-preload.cjs"),
    preload,
    { flag: "wx" },
  );
  fs.writeFileSync(
    path.join(root, "adapter/windows-node-pipe-adapter.manifest.json"),
    adapterManifestBytes,
    { flag: "wx" },
  );
  fs.writeFileSync(path.join(root, "child.cjs"), childSource, { flag: "wx" });
  fs.mkdirSync(output, { mode: 0o700 });
  const input = Buffer.from(
    Array.from({ length: 97 }, (_, i) => (i * 17 + 5) % 256),
  );
  const report = {
    schema: "chainlesschain.windows-node-pipe-runtime-diagnostic/v1",
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
    runtimeDigest,
    addonDigest,
    preloadDigest: evalDigest(preload),
    adapterManifestDigest: evalDigest(adapterManifestBytes),
    inputDigest: evalDigest(input).slice(7),
    diagnosticCompleted: false,
  };
  try {
    const evaluator = createWindowsNativeEvaluator({
      sourceRoot: root,
      files: [
        "adapter/windows-node-pipe-adapter.node",
        "adapter/windows-node-pipe-preload.cjs",
        "adapter/windows-node-pipe-adapter.manifest.json",
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
      "pipe-runtime-journal.jsonl",
    );
    if (fs.existsSync(journal)) {
      const bytes = readPlain(journal, 65536);
      report.journalDigest = evalDigest(bytes);
      report.journal = bytes.toString("utf8");
      fs.writeFileSync(path.join(output, "journal.jsonl"), bytes, {
        flag: "wx",
      });
    }
    const receipts = path.join(evaluator.manifest.scratch, "adapter-receipts");
    report.adapterReceipts = [];
    if (fs.existsSync(receipts))
      for (const file of fs.readdirSync(receipts).sort()) {
        requireCondition(
          /^pipe-adapter-[1-9][0-9]*-(installed|exit)\.json$/u.test(file),
          "unknown preload receipt artifact",
        );
        report.adapterReceipts.push(
          JSON.parse(readPlain(path.join(receipts, file), 16384)),
        );
      }
    report.completion = inspectPipeRuntimeResult(report);
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
    const r = await runPipeRuntimeDiagnostic({
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
