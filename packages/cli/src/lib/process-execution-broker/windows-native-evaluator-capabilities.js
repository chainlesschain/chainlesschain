import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWindowsNativeEvaluator } from "./windows-native-evaluator.js";

const SCHEMA = "chainlesschain.windows-native-evaluator-capabilities/v1";
const PREFIX = "CC_NATIVE_CAPABILITIES:";
const HASH = /^sha256:[a-f0-9]{64}$/u;
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
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url'),{Worker}=require('node:worker_threads');
const workspace=process.argv[2],scratch=process.argv[3],timeout=${probeTimeoutMs};
const observations=[];
const hash=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
function observe(id,operation){
 const start=Date.now();
 return Promise.resolve().then(operation).then(value=>{
  const output=String(value.output??'');
  observations.push({id,status:value.supported?'supported':value.timedOut?'timed-out':['EACCES','EPERM'].includes(value.errorCode)?'blocked':'failed',timedOut:value.timedOut===true,code:value.code??null,signal:value.signal??null,errorCode:value.errorCode??null,error:value.error??null,output,outputSha256:hash(output),details:value.details??{},elapsedMs:Date.now()-start});
 },error=>{
  const output=String(error.stack||error);
  observations.push({id,status:['EACCES','EPERM'].includes(error.code)?'blocked':'failed',timedOut:false,code:null,signal:null,errorCode:error.code??null,error:String(error.message||error),output,outputSha256:hash(output),details:{},elapsedMs:Date.now()-start});
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
 await observe('esm',async()=>{const value=await import(pathToFileURL(path.join(workspace,'esm-probe.mjs')).href);return {supported:value.marker==='native-esm-ok',code:0,output:JSON.stringify({marker:value.marker})};});
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
 process.stdout.write(${JSON.stringify(PREFIX)}+JSON.stringify({version:1,pid:process.pid,workspace,scratch,observations})+'\\n');
})().catch(error=>{console.error(error.stack||error);process.exitCode=74;});
`;
}

/** Re-read actual target output; never promote a rejection or timeout to support. */
export function validateWindowsNativeEvaluatorCapabilitiesReport(report) {
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
      report.settlement.executionFailed === false &&
      report.settlement.targetExitCode === 0 &&
      /^[a-f0-9]{64}$/u.test(report.settlement.supervisorUserSidSha256),
    "native settlement is not confirmed",
  );
  const execution = report.execution;
  requireCondition(
    execution &&
      execution.status === 0 &&
      execution.signal === null &&
      execution.error === null &&
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
  return {
    diagnosticCompleted: true,
    allCapabilitiesSupported: target.observations.every(
      (item) => item.status === "supported",
    ),
    capabilities: Object.fromEntries(
      target.observations.map((item) => [item.id, item.status]),
    ),
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
    const line = report.execution.stdout
      .trim()
      .split(/\r?\n/u)
      .find((value) => value.startsWith(PREFIX));
    if (line)
      report.observations = JSON.parse(line.slice(PREFIX.length)).observations;
    report.validation =
      validateWindowsNativeEvaluatorCapabilitiesReport(report);
    requireCondition(
      report.brokerFiles.every(
        ({ name, sha256: expected }) =>
          sha256(fs.readFileSync(new URL(name, import.meta.url))) === expected,
      ),
      "broker source or binary changed during probe execution",
    );
    report.diagnosticCompleted = report.validation.diagnosticCompleted;
  } catch (error) {
    report.error = String(error.stack || error);
    report.errorCode = error.code ?? null;
  } finally {
    if (evaluator) {
      try {
        evaluator.dispose();
      } catch (error) {
        report.stageRetained = true;
        report.cleanupError = String(error.stack || error);
        report.diagnosticCompleted = false;
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
      fs.writeFileSync(
        path.join(evidenceDirectory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        { flag: "wx" },
      );
    }
  }
  return report;
}
