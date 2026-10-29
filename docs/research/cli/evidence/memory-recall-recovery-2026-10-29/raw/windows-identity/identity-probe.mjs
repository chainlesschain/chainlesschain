import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import os from "node:os";
import {createQueryBundlePlan,readQueryBundle,writeQueryBundle} from "../../packages/cli/src/lib/context-memory-kernel/memory-query-bundle.js";
import {samePathHandleStableFileIdentity,withTrustedFileParentSync} from "../../packages/cli/src/lib/secure-file-identity.js";
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.mkdtempSync(path.join(here,"identity-"));
const hash=bytes=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const selected=stats=>Object.fromEntries(["dev","ino","nlink","mode","size","mtimeMs","ctimeMs","mtimeNs","ctimeNs"].map(key=>[key,stats[key]]));
const observations=[];
const file=path.join(root,"ordinary.bin");
fs.writeFileSync(file,"ordinary identity bytes");
for(const flags of ["r",fs.constants.O_RDONLY,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0)]){
 const fd=fs.openSync(file,flags);
 try{observations.push({kind:"read",flags,pathNumber:selected(fs.lstatSync(file)),handleNumber:selected(fs.fstatSync(fd)),pathBigInt:selected(fs.lstatSync(file,{bigint:true})),handleBigInt:selected(fs.fstatSync(fd,{bigint:true})),secureParent:withTrustedFileParentSync(fs,file,({parentDevice})=>({parentDevice,matches:samePathHandleStableFileIdentity(fs.lstatSync(file,{bigint:true}),fs.fstatSync(fd,{bigint:true}),parentDevice)}))});}
 finally{fs.closeSync(fd);}
}
const writable=path.join(root,"temporary.bin");
const fd=fs.openSync(writable,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
fs.writeSync(fd,Buffer.from("temporary identity bytes"));
const opened=fs.fstatSync(fd,{bigint:true});
observations.push({kind:"write-before-close",pathNumber:selected(fs.lstatSync(writable)),handleNumber:selected(fs.fstatSync(fd)),pathBigInt:selected(fs.lstatSync(writable,{bigint:true})),handleBigInt:selected(opened)});
fs.fsyncSync(fd);fs.closeSync(fd);
observations.push({kind:"write-after-close",pathNumber:selected(fs.lstatSync(writable)),pathBigInt:selected(fs.lstatSync(writable,{bigint:true})),previousHandleBigInt:selected(opened)});
const bytes=Buffer.from("one test frame");
const manifest={digest:hash("manifest"),shards:{"00":{queryDigest:hash(bytes),queryBytes:bytes.length}}};
const plan=createQueryBundlePlan(manifest,{maxBundleBytes:100000});
const target=path.join(root,plan.name);
fs.writeFileSync(target,Buffer.concat([plan.header,bytes]));
const operations=[];
for(const [name,operation] of [
 ["read",()=>readQueryBundle(target,plan)],
 ["write",()=>writeQueryBundle(target,plan,{getFrame:()=>bytes,checkDirectories:()=>{}})],
]){
 try{await operation();operations.push({name,ok:true});}
 catch(error){operations.push({name,ok:false,code:error.code,message:error.message,stack:error.stack});}
}
const result={node:process.version,uv:process.versions.uv,platform:process.platform,osRelease:os.release(),root,flags:{O_NOFOLLOW:fs.constants.O_NOFOLLOW??null,O_NONBLOCK:fs.constants.O_NONBLOCK??null},observations,operations};
const json=JSON.stringify(result,(_,value)=>typeof value==="bigint"?`${value}n`:value,2);
fs.writeFileSync(path.join(root,"result.json"),json+"\n",{flag:"wx"});
console.log(json);
