import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWindowsNativeEvaluator } from "./windows-native-evaluator.js";

const SCHEMA = "chainlesschain.windows-native-evaluator-capabilities/v1";
const PREFIX = "CC_NATIVE_CAPABILITIES:";
const HASH = /^sha256:[a-f0-9]{64}$/u;
const JOURNAL_FILE = "capability-journal.jsonl";
const JOURNAL_MAX_BYTES = 64 * 1024;
const PROBES = [
  "scratch-environment",
  "esm",
  "worker-threads",
  "child-inherited-stdio",
  "child-file-stdio",
  "child-pipe-stdio",
  "child-fork-ipc",
];
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const requireCondition = (condition, message) => {
  if (!condition) throw new Error(`Native capability diagnostic: ${message}`);
};

// These are diagnostic fixtures, never candidate answers or a replacement test runner.
const FIXTURES = Object.freeze({
  "esm-probe.mjs": 'export const marker = "native-esm-ok";\n',
  "worker-probe.cjs":
    'const {parentPort,threadId}=require("node:worker_threads"); parentPort.postMessage({marker:"native-worker-ok",threadId,pid:process.pid});\n',
  "child-probe.cjs":
    'const fs=require("node:fs"); const value=JSON.stringify({marker:"native-child-ok",pid:process.pid}); if(process.argv[2])fs.writeFileSync(process.argv[2],value,{flag:"wx"}); else process.stdout.write(value);\n',
  "fork-probe.cjs":
    'if(typeof process.send!=="function")process.exit(72); process.send({marker:"native-fork-ok",pid:process.pid},error=>{if(error)process.exitCode=73;process.disconnect();});\n',
  "anchor.txt": "private-native-capability-input\n",
});

function checkSource(probeTimeoutMs) {
  return `
const fs=require('node:fs');
const journalFd=fs.openSync(process.argv[3]+'/'+${JSON.stringify(JOURNAL_FILE)},'wx',0o600);
let journalBytes=0,journalSequence=0;
const journalStart=Date.now();
function journal(event,extra={}){
 const bytes=Buffer.from(JSON.stringify({version:1,sequence:journalSequence+1,event,pid:process.pid,elapsedMs:Date.now()-journalStart,...extra})+'\\n');
 if(bytes.length>16384||journalBytes+bytes.length>${JOURNAL_MAX_BYTES}||journalSequence>=17)throw new Error('Capability journal bound exceeded');
 let offset=0;while(offset<bytes.length){const written=fs.writeSync(journalFd,bytes,offset,bytes.length-offset);if(written<=0)throw new Error('Capability journal write stalled');offset+=written;}
 fs.fsyncSync(journalFd);journalBytes+=bytes.length;journalSequence++;
}
journal('initialization-started');
const path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url'),{Worker}=require('node:worker_threads');
const workspace=process.argv[2],scratch=process.argv[3],timeout=${probeTimeoutMs};
const observations=[];
const hash=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
journal('initialization-settled');
function settled(value){journal('settled',{id:value.id,observation:value});observations.push(value);}
function observe(id,operation){
 const start=Date.now();
 journal('started',{id});
 return Promise.resolve().then(operation).then(value=>{
  const output=String(value.output??'');
  settled({id,status:value.supported?'supported':value.timedOut?'timed-out':['EACCES','EPERM'].includes(value.errorCode)?'blocked':'failed',timedOut:value.timedOut===true,code:value.code??null,signal:value.signal??null,errorCode:value.errorCode??null,error:value.error??null,output,outputSha256:hash(output),details:value.details??{},elapsedMs:Date.now()-start});
 },error=>{
  const output=String(error.stack||error);
  settled({id,status:['EACCES','EPERM'].includes(error.code)?'blocked':'failed',timedOut:false,code:null,signal:null,errorCode:error.code??null,error:String(error.message||error),output,outputSha256:hash(output),details:{},elapsedMs:Date.now()-start});
 });
}
function childResult(result,output){
 let payload=null;try{payload=JSON.parse(output);}catch{}
 return {supported:!result.error&&!result.signal&&result.status===0&&payload?.marker==='native-child-ok'&&Number.isSafeInteger(payload.pid)&&payload.pid!==process.pid,code:result.status,signal:result.signal,errorCode:result.error?.code??null,error:result.error?.message??null,timedOut:result.error?.code==='ETIMEDOUT',output,details:{stderr:result.stderr?.toString('utf8')||'',payload}};
}
function asyncProbe(create,valid){
 return new Promise(resolve=>{
  let child,settled=false,message=null,error=null,timedOut=false;
  const done=(code,signal)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({supported:!timedOut&&!error&&code===0&&!signal&&valid(message),timedOut,code,signal,errorCode:error?.code??null,error:error?String(error.stack||error):null,output:message===null?'':JSON.stringify(message),details:{message}});};
  const timer=setTimeout(()=>{timedOut=true;if(child instanceof Worker)child.terminate().catch(()=>{});else child?.kill();done(null,null);},timeout);
  try{child=create();child.on('message',value=>{message=value;});child.once('error',value=>{error=value;done(null,null);});child.once('exit',done);}catch(value){error=value;done(null,null);}
 });
}
(async()=>{
 await observe('scratch-environment',()=>{
  const inheritedKeys=Object.keys(process.env).sort();
  const credentialKeys=inheritedKeys.filter(key=>/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|AUTHORIZATION/i.test(key));
  const derived={TMP:path.join(scratch,'tmp'),TEMP:path.join(scratch,'tmp'),HOME:path.join(scratch,'home'),USERPROFILE:path.join(scratch,'home'),APPDATA:path.join(scratch,'home','AppData','Roaming'),LOCALAPPDATA:path.join(scratch,'home','AppData','Local')};
  for(const directory of new Set(Object.values(derived)))fs.mkdirSync(directory,{recursive:true});
  for(const [key,value]of Object.entries(derived))process.env[key]=value;
  const proofs=[];
  for(const [key,value]of Object.entries(derived)){const file=path.join(value,key+'.txt');fs.writeFileSync(file,key,{flag:'wx'});proofs.push({key,path:value,value:fs.readFileSync(file,'utf8')});}
  const details={credentialKeys,inheritedKeys,derived,proofs,tmpdir:os.tmpdir(),homedir:os.homedir(),credentialsAbsent:credentialKeys.length===0,nodeOptionsAbsent:!Object.hasOwn(process.env,'NODE_OPTIONS')};
  return {supported:details.credentialsAbsent&&details.nodeOptionsAbsent&&os.tmpdir()===derived.TEMP&&os.homedir()===derived.USERPROFILE,code:0,output:JSON.stringify(details),details};
 });
 await observe('esm',async()=>{
  let timer;
  try{return await Promise.race([
   import(pathToFileURL(path.join(workspace,'esm-probe.mjs')).href).then(value=>({supported:value.marker==='native-esm-ok',code:0,output:JSON.stringify({marker:value.marker})})),
   new Promise(resolve=>{timer=setTimeout(()=>resolve({supported:false,timedOut:true,code:null,errorCode:'ETIMEDOUT',error:'ESM import deadline exceeded',output:''}),timeout);})
  ]);}finally{clearTimeout(timer);}
 });
 await observe('worker-threads',()=>asyncProbe(()=>new Worker(path.join(workspace,'worker-probe.cjs'),{execArgv:['--preserve-symlinks','--preserve-symlinks-main']}),value=>value?.marker==='native-worker-ok'&&value.pid===process.pid&&Number.isSafeInteger(value.threadId)&&value.threadId>0));
 await observe('child-inherited-stdio',()=>{
  const proof=path.join(scratch,'inherited-child.json');
  const result=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(workspace,'child-probe.cjs'),proof],{stdio:'inherit',windowsHide:true,timeout});
  return childResult(result,fs.existsSync(proof)?fs.readFileSync(proof,'utf8'):'');
 });
 await observe('child-file-stdio',()=>{
  const outputFile=path.join(scratch,'fd-stdout.txt'),errorFile=path.join(scratch,'fd-stderr.txt');
  const out=fs.openSync(outputFile,'wx'),err=fs.openSync(errorFile,'wx');let result;
  try{result=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(workspace,'child-probe.cjs')],{stdio:['ignore',out,err],windowsHide:true,timeout});}finally{fs.closeSync(out);fs.closeSync(err);}
  result.stderr=fs.readFileSync(errorFile);return childResult(result,fs.readFileSync(outputFile,'utf8'));
 });
 await observe('child-pipe-stdio',()=>{
  const result=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(workspace,'child-probe.cjs')],{windowsHide:true,encoding:'utf8',timeout,maxBuffer:65536});
  return childResult(result,result.stdout||'');
 });
 await observe('child-fork-ipc',()=>asyncProbe(()=>cp.fork(path.join(workspace,'fork-probe.cjs'),[],{execArgv:['--preserve-symlinks','--preserve-symlinks-main'],windowsHide:true,stdio:['inherit','inherit','inherit','ipc']}),value=>value?.marker==='native-fork-ok'&&Number.isSafeInteger(value.pid)&&value.pid!==process.pid));
 journal('completed');
 process.stdout.write(${JSON.stringify(PREFIX)}+JSON.stringify({version:1,pid:process.pid,workspace,scratch,observations})+'\\n');
})().catch(error=>{console.error(error.stack||error);process.exitCode=74;}).finally(()=>fs.closeSync(journalFd));
`;
}

function validateJournal(report, complete) {
  const artifact = report.journal;
  if (!artifact) {
    requireCondition(!complete, "completed target omitted its journal");
    return { available: false, records: [], lastPhase: null, complete: false };
  }
  requireCondition(
    artifact.name === JOURNAL_FILE &&
      typeof artifact.raw === "string" &&
      Buffer.byteLength(artifact.raw) <= JOURNAL_MAX_BYTES &&
      artifact.sha256 === sha256(artifact.raw),
    "journal byte binding or bound changed",
  );
  const boundary = artifact.raw.lastIndexOf("\n");
  const lines = boundary < 0 ? [] : artifact.raw.slice(0, boundary).split("\n");
  const tail = artifact.raw.slice(boundary + 1);
  const expected = [
    { event: "initialization-started" },
    { event: "initialization-settled" },
    ...PROBES.flatMap((id) => [
      { event: "started", id },
      { event: "settled", id },
    ]),
    { event: "completed" },
  ];
  requireCondition(lines.length <= expected.length, "journal has extra events");
  let previousElapsed = -1;
  const records = lines.map((line, index) => {
    requireCondition(
      Buffer.byteLength(line) <= 16384,
      "journal event exceeds bound",
    );
    const row = JSON.parse(line),
      wanted = expected[index];
    requireCondition(
      row.version === 1 &&
        row.sequence === index + 1 &&
        row.pid === report.settlement.targetPid &&
        row.event === wanted.event &&
        row.id === wanted.id &&
        Number.isSafeInteger(row.elapsedMs) &&
        row.elapsedMs >= previousElapsed,
      "journal phase, sequence or process identity differs",
    );
    previousElapsed = row.elapsedMs;
    if (row.event === "settled") {
      const observed = row.observation;
      requireCondition(
        observed?.id === row.id &&
          typeof observed.output === "string" &&
          sha256(observed.output) === observed.outputSha256 &&
          ["supported", "blocked", "timed-out", "failed"].includes(
            observed.status,
          ) &&
          typeof observed.timedOut === "boolean" &&
          Number.isSafeInteger(observed.elapsedMs) &&
          observed.elapsedMs >= 0,
        "journal observation identity or digest changed",
      );
    } else
      requireCondition(
        row.observation === undefined,
        "unexpected journal observation",
      );
    return row;
  });
  if (complete)
    requireCondition(
      lines.length === expected.length && tail === "",
      "target journal incomplete",
    );
  return {
    available: true,
    records,
    lastPhase: records.at(-1)?.id || records.at(-1)?.event || null,
    complete: records.length === expected.length && tail === "",
    trailingPartialBytes: Buffer.byteLength(tail),
  };
}

function sameJournalIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === 1n &&
    right.nlink === 1n &&
    left.isFile() &&
    right.isFile()
  );
}

function journalDescriptorIdentity(file) {
  const fd = fs.openSync(file, "r");
  try {
    return fs.fstatSync(fd, { bigint: true });
  } finally {
    fs.closeSync(fd);
  }
}

function readJournalAfterSettlement(report) {
  requireCondition(
    report.settlement?.cleanupConfirmed === true &&
      report.settlement.manifestDigest === report.manifestDigest.slice(7),
    "scratch read requires confirmed native cleanup",
  );
  const scratch = report.stage.scratch;
  const expected = report.manifest.directories.find(
    (entry) => entry.path === scratch,
  );
  const directory = fs.lstatSync(scratch, { bigint: true });
  requireCondition(
    expected &&
      directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      String(directory.dev) === expected.dev &&
      String(directory.ino) === expected.ino &&
      fs.realpathSync.native(scratch).toLowerCase() === scratch.toLowerCase(),
    "scratch identity changed before journal read",
  );
  const file = path.join(scratch, JOURNAL_FILE);
  let before;
  try {
    before = fs.lstatSync(file, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  requireCondition(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.nlink === 1n &&
      before.size <= BigInt(JOURNAL_MAX_BYTES) &&
      fs.realpathSync.native(file).toLowerCase() === file.toLowerCase(),
    "journal is linked or exceeds byte bound",
  );
  const fd = fs.openSync(file, "r");
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    // Windows pathname and descriptor stat can expose different dev/ino
    // projections. Bind the reader to another handle opened by name, and
    // compare each stat domain only with itself before and after the read.
    requireCondition(
      sameJournalIdentity(opened, journalDescriptorIdentity(file)) &&
        opened.size === before.size &&
        opened.size <= BigInt(JOURNAL_MAX_BYTES),
      "journal identity changed while opening",
    );
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(
        fd,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      requireCondition(read > 0, "journal truncated while reading");
      offset += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(file, { bigint: true });
    requireCondition(
      sameJournalIdentity(after, opened) &&
        sameJournalIdentity(named, before) &&
        sameJournalIdentity(after, journalDescriptorIdentity(file)) &&
        !named.isSymbolicLink() &&
        fs.realpathSync.native(file).toLowerCase() === file.toLowerCase(),
      "journal changed during bounded read",
    );
    const raw = bytes.toString("utf8");
    requireCondition(
      Buffer.from(raw, "utf8").equals(bytes),
      "journal is not valid UTF-8",
    );
    return {
      name: JOURNAL_FILE,
      raw,
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Incomplete captures may be inspected explicitly, but never grant capabilities. */
export function validateWindowsNativeEvaluatorCapabilitiesReport(
  report,
  { allowPartial = false } = {},
) {
  requireCondition(report?.schema === SCHEMA, "unknown report schema");
  requireCondition(
    report.formalSample === false &&
      report.providerAssessed === false &&
      report.fullReviewPackAssessed === false,
    "diagnostic scope changed",
  );
  requireCondition(HASH.test(report.manifestDigest), "manifest digest missing");
  requireCondition(
    sha256(JSON.stringify(report.manifest)) === report.manifestDigest &&
      report.checkSourceSha256 ===
        `sha256:${report.manifest.files.find((file) => file.path === report.manifest.check)?.sha256}`,
    "staged source manifest digest mismatch",
  );
  requireCondition(
    report.settlement?.manifestDigest === report.manifestDigest.slice(7) &&
      report.settlement.cleanupConfirmed === true &&
      report.settlement.capabilityCount === 0 &&
      report.settlement.loopbackExemptionAbsent === true &&
      /^[a-f0-9]{64}$/u.test(report.settlement.supervisorUserSidSha256),
    "native cleanup settlement is not confirmed",
  );
  const execution = report.execution;
  requireCondition(
    execution &&
      typeof execution.stdout === "string" &&
      typeof execution.stderr === "string" &&
      Buffer.byteLength(execution.stdout) <= 8 * 1024 * 1024 &&
      Buffer.byteLength(execution.stderr) <= 8 * 1024 * 1024,
    "target execution incomplete",
  );
  requireCondition(
    sha256(execution.stdout) === execution.stdoutSha256 &&
      sha256(execution.stderr) === execution.stderrSha256,
    "raw output digest mismatch",
  );
  const executionCompleted =
    execution.status === 0 &&
    execution.signal === null &&
    execution.error === null &&
    report.settlement.targetExitCode === 0 &&
    report.settlement.executionFailed === false;
  if (!executionCompleted) {
    const timedOut = /Windows sandbox wall-time limit exceeded/u.test(
      execution.stderr,
    );
    requireCondition(
      allowPartial,
      timedOut
        ? "target execution timed out; native cleanup confirmed"
        : "target execution incomplete; native cleanup confirmed",
    );
    const journal = validateJournal(report, false);
    return {
      diagnosticCompleted: false,
      allCapabilitiesSupported: false,
      capabilities: {},
      failureKind: timedOut ? "execution-timeout" : "execution-failure",
      cleanupConfirmed: true,
      journal,
      observedPrefix: journal.records
        .filter((row) => row.event === "settled")
        .map((row) => row.observation),
    };
  }
  const lines = execution.stdout.trim().split(/\r?\n/u);
  requireCondition(
    lines.length === 1 && lines[0].startsWith(PREFIX),
    "expected exactly one target report",
  );
  const target = JSON.parse(lines[0].slice(PREFIX.length));
  requireCondition(
    target.version === 1 &&
      Number.isSafeInteger(target.pid) &&
      target.pid > 0 &&
      target.pid === report.settlement.targetPid &&
      report.stage.workspace === report.manifest.workspace &&
      report.stage.scratch === report.manifest.scratch &&
      target.workspace === report.stage.workspace &&
      target.scratch === report.stage.scratch &&
      Array.isArray(target.observations) &&
      JSON.stringify(target.observations.map((item) => item.id)) ===
        JSON.stringify(PROBES),
    "target identity or probe sequence mismatch",
  );
  for (const observation of target.observations) {
    requireCondition(
      ["supported", "blocked", "timed-out", "failed"].includes(
        observation.status,
      ) &&
        (observation.code === null || Number.isInteger(observation.code)) &&
        (observation.signal === null ||
          typeof observation.signal === "string") &&
        typeof observation.timedOut === "boolean" &&
        typeof observation.output === "string" &&
        sha256(observation.output) === observation.outputSha256 &&
        Number.isSafeInteger(observation.elapsedMs) &&
        observation.elapsedMs >= 0,
      "malformed probe observation",
    );
    if (observation.status === "supported") {
      requireCondition(
        observation.code === 0 &&
          observation.signal === null &&
          observation.error === null &&
          observation.errorCode === null,
        "failed observation cannot advertise support",
      );
      const payload = JSON.parse(observation.output);
      if (observation.id === "scratch-environment") {
        requireCondition(
          payload.credentialsAbsent === true &&
            payload.nodeOptionsAbsent === true &&
            Array.isArray(payload.credentialKeys) &&
            payload.credentialKeys.length === 0,
          "credential environment was not isolated",
        );
        for (const name of [
          "TMP",
          "TEMP",
          "HOME",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA",
        ]) {
          const relative = path.win32.relative(
            target.scratch,
            payload.derived[name],
          );
          requireCondition(
            relative &&
              !relative.startsWith("..") &&
              !path.win32.isAbsolute(relative) &&
              payload.proofs.some(
                (proof) =>
                  proof.key === name &&
                  proof.path === payload.derived[name] &&
                  proof.value === name,
              ),
            "environment escaped scratch or omitted a write/read proof",
          );
        }
        requireCondition(
          payload.tmpdir === payload.derived.TEMP &&
            payload.homedir === payload.derived.USERPROFILE,
          "temporary or home directory differs from isolated environment",
        );
      } else {
        const expected =
          observation.id === "esm"
            ? "native-esm-ok"
            : observation.id === "worker-threads"
              ? "native-worker-ok"
              : observation.id === "child-fork-ipc"
                ? "native-fork-ok"
                : "native-child-ok";
        requireCondition(payload.marker === expected, "probe marker mismatch");
        if (observation.id === "worker-threads")
          requireCondition(
            payload.pid === target.pid &&
              Number.isSafeInteger(payload.threadId) &&
              payload.threadId > 0,
            "worker identity mismatch",
          );
        else if (observation.id !== "esm")
          requireCondition(
            Number.isSafeInteger(payload.pid) &&
              payload.pid > 0 &&
              payload.pid !== target.pid,
            "child identity mismatch",
          );
      }
    }
    if (observation.status === "blocked")
      requireCondition(
        ["EPERM", "EACCES"].includes(observation.errorCode),
        "blocked probe lacks its actual access error",
      );
    let payload;
    try {
      payload = JSON.parse(observation.output);
    } catch {
      payload = null;
    }
    const expectedMarker =
      observation.id === "esm"
        ? "native-esm-ok"
        : observation.id === "worker-threads"
          ? "native-worker-ok"
          : observation.id === "child-fork-ipc"
            ? "native-fork-ok"
            : "native-child-ok";
    const successOutput =
      observation.id === "scratch-environment"
        ? payload?.credentialsAbsent === true &&
          payload?.nodeOptionsAbsent === true &&
          payload?.tmpdir === payload?.derived?.TEMP &&
          payload?.homedir === payload?.derived?.USERPROFILE
        : payload?.marker === expectedMarker;
    const actualSuccess =
      observation.code === 0 &&
      observation.signal === null &&
      observation.error === null &&
      observation.errorCode === null &&
      !observation.timedOut &&
      successOutput;
    const actualStatus = actualSuccess
      ? "supported"
      : observation.timedOut
        ? "timed-out"
        : ["EPERM", "EACCES"].includes(observation.errorCode)
          ? "blocked"
          : "failed";
    requireCondition(
      observation.status === actualStatus,
      "probe status contradicts raw result",
    );
  }
  requireCondition(
    JSON.stringify(report.observations) === JSON.stringify(target.observations),
    "report observations differ from raw output",
  );
  requireCondition(
    target.observations[0].status === "supported",
    "scratch environment or credential isolation failed",
  );
  const journal = validateJournal(report, true);
  requireCondition(
    JSON.stringify(
      journal.records
        .filter((row) => row.event === "settled")
        .map((row) => row.observation),
    ) === JSON.stringify(target.observations),
    "journal observations differ from final target report",
  );
  return {
    diagnosticCompleted: true,
    allCapabilitiesSupported: target.observations.every(
      (item) => item.status === "supported",
    ),
    capabilities: Object.fromEntries(
      target.observations.map((item) => [item.id, item.status]),
    ),
    journal,
  };
}

/** Execute only through the existing one-use AppContainer factory.
 * evidenceDirectory, when supplied, must be a new directory. A failed native
 * settlement retains its stage; there is no unsandboxed fallback or provider.
 */
export async function runWindowsNativeEvaluatorCapabilities({
  wallTimeMs = 15000,
  probeTimeoutMs = 1200,
  evidenceDirectory,
} = {}) {
  requireCondition(process.platform === "win32", "Windows host required");
  requireCondition(
    Number.isSafeInteger(probeTimeoutMs) &&
      probeTimeoutMs >= 100 &&
      probeTimeoutMs <= 5000 &&
      Number.isSafeInteger(wallTimeMs) &&
      wallTimeMs >= probeTimeoutMs * 5 + 3000 &&
      wallTimeMs <= 60000,
    "invalid bounded diagnostic deadlines",
  );
  if (evidenceDirectory) {
    requireCondition(
      path.isAbsolute(evidenceDirectory),
      "absolute evidence path required",
    );
    fs.mkdirSync(evidenceDirectory, { mode: 0o700 });
  }
  const sourceRoot = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-native-capability-source-",
    ),
  );
  const sourceIdentity = fs.lstatSync(sourceRoot, { bigint: true });
  let evaluator;
  const report = {
    schema: SCHEMA,
    startedAt: new Date().toISOString(),
    platform: process.platform,
    osRelease: os.release(),
    nodeVersion: process.version,
    architecture: process.arch,
    formalSample: false,
    providerAssessed: false,
    fullReviewPackAssessed: false,
    diagnosticCompleted: false,
    wallTimeMs,
    probeTimeoutMs,
    observations: [],
    stageRetained: false,
    sourceFiles: Object.entries(FIXTURES).map(([name, bytes]) => ({
      name,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes),
    })),
    brokerFiles: [],
  };
  try {
    report.brokerFiles = [
      "windows-native-evaluator-capabilities.js",
      "windows-native-evaluator.js",
      "index.js",
      "platform-sandbox.js",
      "windows-sandbox.cs",
      "windows-sandbox-helper.exe",
      "windows-sandbox-helper.dll",
    ].map((name) => ({
      name,
      sha256: sha256(fs.readFileSync(new URL(name, import.meta.url))),
    }));
    for (const [name, bytes] of Object.entries(FIXTURES))
      fs.writeFileSync(path.join(sourceRoot, name), bytes, { flag: "wx" });
    const source = checkSource(probeTimeoutMs);
    report.checkSourceSha256 = sha256(source);
    evaluator = createWindowsNativeEvaluator({
      sourceRoot,
      files: Object.keys(FIXTURES),
      checkSource: source,
      wallTimeMs,
    });
    report.manifestDigest = `sha256:${evaluator.manifestDigest}`;
    report.stage = {
      root: evaluator.root,
      workspace: evaluator.manifest.workspace,
      scratch: evaluator.manifest.scratch,
    };
    report.manifest = evaluator.manifest;
    const outcome = await evaluator.execute();
    report.settlement = outcome.receipt;
    const { result } = outcome;
    report.execution = {
      status: result.status ?? null,
      signal: result.signal ?? null,
      error: result.error?.message ?? null,
      errorCode: result.error?.code ?? null,
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || ""),
    };
    report.execution.stdoutSha256 = sha256(report.execution.stdout);
    report.execution.stderrSha256 = sha256(report.execution.stderr);
    report.journal = readJournalAfterSettlement(report);
    report.journalReadAfterCleanup = true;
    const line = report.execution.stdout
      .trim()
      .split(/\r?\n/u)
      .find((value) => value.startsWith(PREFIX));
    if (line)
      report.observations = JSON.parse(line.slice(PREFIX.length)).observations;
    report.validation = validateWindowsNativeEvaluatorCapabilitiesReport(
      report,
      { allowPartial: true },
    );
    requireCondition(
      report.brokerFiles.every(
        ({ name, sha256: expected }) =>
          sha256(fs.readFileSync(new URL(name, import.meta.url))) === expected,
      ),
      "broker source or binary changed during probe execution",
    );
    report.diagnosticCompleted = report.validation.diagnosticCompleted;
    if (!report.diagnosticCompleted) {
      report.failureKind = report.validation.failureKind;
      report.error =
        report.failureKind === "execution-timeout"
          ? "Target execution timed out; native cleanup confirmed"
          : "Target execution incomplete; native cleanup confirmed";
    }
  } catch (error) {
    report.error = String(error.stack || error);
    report.errorCode = error.code ?? null;
    report.failureKind = evaluator
      ? report.settlement?.cleanupConfirmed === true
        ? "diagnostic-incomplete"
        : "cleanup-unconfirmed"
      : "preparation-failure";
  } finally {
    if (evaluator) {
      if (!report.diagnosticCompleted) {
        report.stageRetained = true;
        report.retentionReason =
          report.settlement?.cleanupConfirmed === true
            ? "diagnostic-incomplete"
            : "cleanup-unconfirmed";
      } else {
        try {
          evaluator.dispose();
        } catch (error) {
          report.stageRetained = true;
          report.retentionReason = "stage-disposal-failed";
          report.cleanupError = String(error.stack || error);
          report.diagnosticCompleted = false;
        }
      }
    }
    try {
      const current = fs.lstatSync(sourceRoot, { bigint: true });
      requireCondition(
        current.dev === sourceIdentity.dev &&
          current.ino === sourceIdentity.ino &&
          !current.isSymbolicLink() &&
          fs.realpathSync.native(sourceRoot) === sourceRoot,
        "private fixture source identity changed; retained",
      );
      fs.rmSync(sourceRoot, { recursive: true });
    } catch (error) {
      report.sourceRetained = true;
      report.sourceCleanupError = String(error.stack || error);
      report.diagnosticCompleted = false;
    }
    report.finishedAt = new Date().toISOString();
    if (evidenceDirectory) {
      for (const stream of ["stdout", "stderr"])
        fs.writeFileSync(
          path.join(evidenceDirectory, `${stream}.txt`),
          report.execution?.[stream] || "",
          { flag: "wx" },
        );
      if (report.journal)
        fs.writeFileSync(
          path.join(evidenceDirectory, JOURNAL_FILE),
          report.journal.raw,
          { flag: "wx" },
        );
      fs.writeFileSync(
        path.join(evidenceDirectory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        { flag: "wx" },
      );
    }
  }
  return report;
}
