import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {syncBuiltinESMExports} from "node:module";
import {createHash} from "node:crypto";
import {createQueryBundlePlan,readQueryBundle,writeQueryBundle} from "../../packages/cli/src/lib/context-memory-kernel/memory-query-bundle.js";
import {samePathHandleStableFileIdentity,withTrustedFileParentSync} from "../../packages/cli/src/lib/secure-file-identity.js";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.mkdtempSync(path.join(here,"identity-projection-"));
const hash=bytes=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bytes=Buffer.from("one checked frame");
const plan=createQueryBundlePlan({digest:hash("manifest"),shards:{"00":{queryDigest:hash(bytes),queryBytes:bytes.length}}},{maxBundleBytes:100000});
const file=path.join(root,plan.name);
fs.writeFileSync(file,Buffer.concat([plan.header,bytes]));
const original=fs.lstatSync;
const inside=target=>{const rel=path.relative(root,path.resolve(String(target)));return rel===""||(!rel.startsWith("..")&&!path.isAbsolute(rel));};
fs.lstatSync=function(target,...args){
 const stat=original(target,...args);
 if(!inside(target))return stat;
 return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{dev:typeof stat.dev==="bigint"?0n:0});
};
syncBuiltinESMExports();
const affected={platform:"win32",uvVersion:"1.49.1"};
const outcomes=[];
let comparison;
try{
 for(const [name,operation] of [["read",()=>readQueryBundle(file,plan)],["write",()=>writeQueryBundle(file,plan,{getFrame:()=>bytes,checkDirectories:()=>{}})]]){
  try{await operation();outcomes.push({name,ok:true});}
  catch(error){outcomes.push({name,ok:false,code:error.code,message:error.message});}
 }
 comparison=withTrustedFileParentSync(fs,file,({parentDevice})=>{
  const fd=fs.openSync(file,"r");
  try{
   const pathStat=fs.lstatSync(file,{bigint:true}),handleStat=fs.fstatSync(fd,{bigint:true});
   const wrongInode=Object.assign(Object.create(Object.getPrototypeOf(pathStat)),pathStat,{ino:pathStat.ino+1n});
   const result={parentDevice,pathDevice:String(pathStat.dev),handleDevice:String(handleStat.dev),exactInode:String(handleStat.ino),affectedAccepted:samePathHandleStableFileIdentity(pathStat,handleStat,parentDevice,affected),wrongInodeRejected:!samePathHandleStableFileIdentity(wrongInode,handleStat,parentDevice,affected),wrongVolumeRejected:!samePathHandleStableFileIdentity(pathStat,handleStat,`${parentDevice}1`,affected),unaffectedRuntimeRejected:!samePathHandleStableFileIdentity(pathStat,handleStat,parentDevice,{platform:"win32",uvVersion:"1.51.0"})};
   assert.equal(result.affectedAccepted,true);assert.equal(result.wrongInodeRejected,true);assert.equal(result.wrongVolumeRejected,true);assert.equal(result.unaffectedRuntimeRejected,true);return result;
  }finally{fs.closeSync(fd);}
 },{runtime:affected});
 assert.ok(outcomes.every(result=>!result.ok&&result.code==="CONTEXT_MEMORY_STORE_CORRUPT"));
}finally{fs.lstatSync=original;syncBuiltinESMExports();}
const result={scope:"Deterministic injected path-stat device projection; not a reproduction of the OS bug itself",node:process.version,uv:process.versions.uv,root,outcomes,comparison};
fs.writeFileSync(path.join(root,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result,null,2));
