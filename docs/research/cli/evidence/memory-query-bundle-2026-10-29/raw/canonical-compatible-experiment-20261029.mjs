import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createDurableMemoryFixture } from "../../packages/cli/scripts/persistent-capacity-benchmark.mjs";
import { createCompatiblePrototype } from "./canonical-compatible-prototype-20261029.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../..");
const commit="e7a6f2585d62949794596767869423b0eb670104";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+"\n",{flag:"wx"});
const benchmark=process.argv[2]==="--benchmark";
const directory=benchmark ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(here,"canonical-allocation-"));
assert.equal(path.dirname(directory),here);
assert.ok(path.basename(directory).startsWith("canonical-allocation-"));
console.log(`artifacts=${directory}`);
const provenance=[];
if (!benchmark) {
  fs.mkdirSync(path.join(directory,"oracle"));
  save(path.join(directory,"oracle/package.json"),{type:"commonjs"});
  for (const name of ["canonical.js","errors.js","constants.js"]) {
    const sourcePath=`packages/context-memory-kernel/lib/${name}`;
    const bytes=execFileSync("git",["show",`${commit}:${sourcePath}`],{cwd:repo,windowsHide:true});
    const blob=execFileSync("git",["rev-parse",`${commit}:${sourcePath}`],{cwd:repo,encoding:"utf8",windowsHide:true}).trim();
    fs.writeFileSync(path.join(directory,"oracle",name),bytes,{flag:"wx"});
    provenance.push({sourcePath,commit,blob,sha256:sha(bytes)});
  }
}
const require=createRequire(import.meta.url);
const oracle=require(path.join(directory,"oracle/canonical.js"));
const {invalidArgument}=require(path.join(directory,"oracle/errors.js"));
const apis={oracle,compatible:createCompatiblePrototype(oracle,invalidArgument)};
const methods=["canonicalJson","canonicalDigest","cloneCanonical"];
const domains=[undefined,"chainlesschain.memory-event/v1","unicode-域\0😀"];
let checks=0;
function compare(value,label) {
  for (const [name,api] of Object.entries(apis)) {
    if (name==="oracle") continue;
    assert.equal(api.canonicalJson(value),oracle.canonicalJson(value),`${label} ${name} JSON`); checks++;
    for (const domain of domains) { assert.equal(api.canonicalDigest(value,domain),oracle.canonicalDigest(value,domain),`${label} ${name} digest`); checks++; }
    assert.deepEqual(api.cloneCanonical(value),oracle.cloneCanonical(value),`${label} ${name} clone`); checks++;
    assert.deepEqual(api.canonicalize(value),oracle.canonicalize(value),`${label} ${name} canonicalize`); checks++;
  }
}
let state;
if (!benchmark) {
  const numeric=Object.fromEntries(["10","2","0","1","4294967294","4294967295","4294967296","-0","01","00","1e0","1.0","-1","","a"].map((key,index)=>[key,index]));
  const nullProto=Object.assign(Object.create(null),numeric,{unicode:"\ud800\udfff"});
  nullProto.__proto__={safe:true};
  const holes=new Array(4); holes[1]="present";
  const unicode1=Object.fromEntries(["é","e\u0301","É","E\u0301","ä","a","A","😀","\ud800","\udfff","中","__proto__","constructor","toString"].map((key,index)=>[key,index]));
  const unicode2=Object.fromEntries(Object.entries(unicode1).reverse());
  assert.equal("é".localeCompare("e\u0301","en"),0);
  const valid=[null,true,false,0,-0,1e-7,1e21,Number.MIN_VALUE,Number.MAX_VALUE,"", "\ud800", "\udfff", "\ud800\udfff", "\u0000\b\n\r\t\"\\",numeric,nullProto,holes,[holes,{omit:undefined,keep:null}],unicode1,unicode2,JSON.parse('{"__proto__":{"polluted":true},"constructor":5}')];
  let seed=0x5eed1234;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  const keys=["2","10","4294967294","4294967295","-0","01","é","e\u0301","__proto__","", "\ud800", "a", "z", "中"];
  function fuzz(depth=0) {
    if (depth>3 || random()<0.4) return [null,false,true,0,-0,1e25,"hello","\ud800","é"][Math.floor(random()*9)];
    if (random()<0.35) {const result=new Array(Math.floor(random()*6)); for(let i=0;i<result.length;i++) if(random()>0.2) result[i]=fuzz(depth+1); return result;}
    const result=Object.create(random()<0.3?null:Object.prototype);
    for(let i=0,n=Math.floor(random()*9);i<n;i++) Object.defineProperty(result,keys[Math.floor(random()*keys.length)],{value:random()<0.15?undefined:fuzz(depth+1),enumerable:true,configurable:true,writable:true});
    return result;
  }
  for(let i=0;i<1200;i++) valid.push(fuzz());
  valid.forEach((value,index)=>compare(value,`edge-${index}`));
  const invalid=[undefined,NaN,Infinity,-Infinity,1n,Symbol("x"),()=>{},new Date(),new Map(),new Set(),new Number(1),Object.create({custom:true}),[undefined],[,undefined],{nested:NaN},{nested:[Infinity]},{nested:1n},{nested:()=>{}},{nested:new Date()}];
  let invalidChecks=0;
  for(const value of invalid) for(const method of methods) {
    if(value===undefined && method==="cloneCanonical") {for(const api of Object.values(apis)) assert.equal(api[method](value),undefined);continue;}
    let expected; try{oracle[method](value);}catch(error){expected=error;}
    assert.ok(expected);
    for(const name of ["compatible"]) {assert.throws(()=>apis[name][method](value),error=>error.code===expected.code && error.message===expected.message && JSON.stringify(error.details)===JSON.stringify(expected.details));invalidChecks++;}
  }
  console.log("phase=fixture-and-parity");
  state=createDurableMemoryFixture(3000);
  Object.values(state.records).forEach((record,index)=>compare(record,`record-${index}`));
  state.events.forEach((event,index)=>compare(event,`event-${index}`));
  compare(state,"whole-state");
  const fixtureBytes=JSON.stringify(state);
  fs.writeFileSync(path.join(directory,"fixture.json"),fixtureBytes,{flag:"wx"});
  save(path.join(directory,"validation.json"),{
    status:"passed",node:process.version,platform:process.platform,provenance,
    fixtureRecords:3000,fixtureEvents:3000,validEdgeCases:valid.length,checks,invalidChecks,
    fixtureSha256:sha(fixtureBytes),prototypeSha256:sha(fs.readFileSync(path.join(here,"canonical-compatible-prototype-20261029.mjs"))),
    harnessSha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    note:"Exact e7 source oracle; pure JSON parity including holes, integer-key reordering, Unicode ties, null prototypes, __proto__, negative zero and unpaired surrogates. Public canonicalize is the original oracle function. No production edits.",
  });
  console.log(JSON.stringify({status:"parity-passed",checks,invalidChecks}));
} else {
  const validation=JSON.parse(fs.readFileSync(path.join(directory,"validation.json")));
  const fixtureBytes=fs.readFileSync(path.join(directory,"fixture.json"));
  assert.equal(sha(fixtureBytes),validation.fixtureSha256);
  assert.equal(sha(fs.readFileSync(path.join(here,"canonical-compatible-prototype-20261029.mjs"))),validation.prototypeSha256);
  state=JSON.parse(fixtureBytes);
  const values=[...Object.values(state.records),...state.events,state];
  let sink=0;
  function run(api,method) {
    for(const value of values) {
      const result=api[method](value);
      sink^=typeof result==="string"?result.length:Object.keys(result).length;
    }
  }
  console.log("phase=warmup");
  for(const method of methods) for(const api of Object.values(apis)) run(api,method);
  const samples=[];
  for(let round=0;round<7;round++) {
    for(const method of methods) {
      const names=Object.keys(apis);
      for(let j=0;j<names.length;j++) {
        const name=names[(j+round)%names.length];
        global.gc?.();
        const cpu=process.cpuUsage(),start=performance.now();
        run(apis[name],method);
        const elapsedMs=performance.now()-start,usage=process.cpuUsage(cpu);
        samples.push({round,method,variant:name,elapsedMs,cpuUserMs:usage.user/1000,cpuSystemMs:usage.system/1000});
      }
    }
    console.log(`phase=round-${round+1}-complete`);
  }
  const summaries=[];
  for(const method of methods) for(const name of Object.keys(apis)) {
    const selected=samples.filter(s=>s.method===method&&s.variant===name);
    const median=key=>selected.map(s=>s[key]).sort((a,b)=>a-b)[3];
    summaries.push({method,variant:name,medianElapsedMs:median("elapsedMs"),medianCpuUserMs:median("cpuUserMs"),medianCpuSystemMs:median("cpuSystemMs"),minElapsedMs:Math.min(...selected.map(s=>s.elapsedMs)),maxElapsedMs:Math.max(...selected.map(s=>s.elapsedMs))});
  }
  save(path.join(directory,"benchmark.json"),{scope:"Single-process warm microbenchmark; 3000 records + 3000 events + whole state per invocation; 7 rotated rounds; GC outside measured sections. Not an SLO or release result.",node:process.version,sink,validationSha256:sha(fs.readFileSync(path.join(directory,"validation.json"))),summaries,samples});
  console.log(JSON.stringify(summaries,null,2));
}
