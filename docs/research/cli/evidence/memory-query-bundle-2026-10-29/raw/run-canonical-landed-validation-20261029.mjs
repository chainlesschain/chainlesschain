import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync,execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../..");
const artifacts=fs.mkdtempSync(path.join(here,"canonical-landed-validation-"));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const names=["packages/context-memory-kernel/lib/canonical.js","packages/context-memory-kernel/test/canonical-allocation.test.js"];
const binding=()=>Object.fromEntries(names.map(name=>[name,sha(fs.readFileSync(path.join(repo,name)))]));
const before=binding();
const original=execFileSync("git",["show","e7a6f2585d62949794596767869423b0eb670104:packages/context-memory-kernel/lib/canonical.js"],{cwd:repo,encoding:"utf8",windowsHide:true});
const canonicalize=source=>source.slice(source.indexOf("function canonicalize("),source.indexOf("\n}\n",source.indexOf("function canonicalize("))+3).replaceAll("\r\n","\n");
assert.equal(canonicalize(fs.readFileSync(path.join(repo,names[0]),"utf8").replaceAll("\r\n","\n")),canonicalize(original));
console.log(`artifacts=${artifacts}`);
const commands=[
 {label:"npm-test",args:[path.join(path.dirname(process.execPath),"node_modules/npm/bin/npm-cli.js"),"test"],cwd:path.join(repo,"packages/context-memory-kernel")},
 {label:"e7-production-parity",args:[path.join(here,"canonical-landed-parity-20261029.mjs")],cwd:repo},
];
const results=[];
for(const command of commands){
 console.log(`phase=${command.label}`);
 const startedAt=new Date().toISOString();
 const result=spawnSync(process.execPath,command.args,{cwd:command.cwd,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:16*1024*1024});
 fs.writeFileSync(path.join(artifacts,`${command.label}.log`),(result.stdout||"")+(result.stderr||""),{flag:"wx"});
 results.push({...command,startedAt,endedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message??null,logSha256:sha(fs.readFileSync(path.join(artifacts,`${command.label}.log`)))});
 console.log(JSON.stringify({phase:command.label,exitCode:result.status,tail:result.stdout?.slice(-550)}));
 if(result.status!==0) break;
}
const after=binding();
assert.deepEqual(after,before);
fs.writeFileSync(path.join(artifacts,"receipt.json"),JSON.stringify({node:process.version,platform:process.platform,before,after,publicCanonicalizeUnchangedFromE7:true,commands:results},null,2)+"\n",{flag:"wx"});
if(results.length!==commands.length||results.some(result=>result.exitCode!==0)) process.exitCode=1;
