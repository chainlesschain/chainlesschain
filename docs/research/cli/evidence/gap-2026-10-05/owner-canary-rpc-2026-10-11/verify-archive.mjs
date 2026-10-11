import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const directory=path.resolve(process.argv[2]??path.dirname(fileURLToPath(import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=fs.readFileSync(path.join(directory,'manifest.json')),manifest=JSON.parse(manifestBytes);
const saved=new Map(),names=new Set();let originals=0;
for(const row of manifest.entries){
 assert.match(row.artifact,/^objects\/\d{3}\.gz$/);assert(!names.has(row.artifact));names.add(row.artifact);
 const packed=fs.readFileSync(path.join(directory,row.artifact));assert.equal(packed.length,row.gzipBytes);assert.equal(hash(packed),row.gzipSha256);
 const raw=gunzipSync(packed);assert.equal(raw.length,row.rawBytes);assert.equal(hash(raw),row.rawSha256);saved.set(row.source,raw);
 if(fs.existsSync(row.source)){assert(raw.equals(fs.readFileSync(row.source)),row.source);originals++;}
}
assert.equal(fs.readdirSync(path.join(directory,'objects')).length,names.size);
const json=source=>JSON.parse(saved.get(source));
const report=json(manifest.experiment+'/run/report.json'),checked=json(manifest.verification+'/verification.json');
for(const [key,file]of [['host','host.stdout'],['probe','acl-probe.json'],['hostAcl','host-owner-acl-before.json'],['hostAclAfter','host-owner-acl-after.json'],['hostRpc','canary-rpc-host.json']])assert.deepEqual(report[key],json(manifest.experiment+'/run/'+file));
let frozenGitBindings=0;
for(const row of json(manifest.experiment+'/origins.json')){const bytes=execFileSync('git',['show',`${row.commit}:${row.gitPath}`],{maxBuffer:8*1024*1024});assert.equal('sha256:'+hash(bytes),row.digest);const key=manifest.experiment+'/frozen/'+path.basename(row.path);assert(saved.get(key).equals(bytes));frozenGitBindings++;}
for(const binding of report.sourceInputs){const key=manifest.experiment+'/'+path.relative(path.resolve(manifest.experiment),binding.path).replaceAll('\\','/');const bytes=saved.get(key);assert(bytes,key);assert.equal('sha256:'+hash(bytes),binding.digest);assert.equal(bytes.length,binding.bytes);}
const checkedBinaryPaths=[];
for(const binding of manifest.binaryBindings){if(fs.existsSync(binding.path)){const bytes=fs.readFileSync(binding.path);assert.equal(bytes.length,binding.bytes);assert.equal(hash(bytes),binding.sha256);checkedBinaryPaths.push(binding.path);}}
assert.equal(manifest.status,'NOT_ADMITTED');assert.equal(manifest.durable,false);assert.equal(manifest.formalSample,false);assert.equal(manifest.observationsProduced,0);assert.equal(manifest.actualExecution.count,1);assert.equal(report.execution.status,0);assert.equal(report.diagnosticCompleted,true);assert.equal(checked.passed,25);assert.equal(checked.bindingsVerified,51);assert.equal(checked.newNativeRuns,0);assert.equal(checked.newAclMutations,0);
const host=report.host,actor=report.probe,rpc=report.hostRpc;
for(const key of ['completed','rootTokenAndSameJobProven','cleanupConfirmed','profileDeleted','loopbackExemptionAbsent','hostMapUnchanged'])assert.equal(host[key],true);
assert.equal(host.rootWait,0);assert.equal(host.rootExit,0);assert.equal(host.jobActiveProcesses,0);assert.equal(host.creationLedger.length,1);assert.equal(host.creationLedger[0].inheritedHandleCount,9);assert.equal(host.creationLedger[0].wait,0);assert.equal(host.creationLedger[0].exit,0);
assert.equal(rpc.attempts,9);assert.equal(rpc.accepted,1);assert.equal(rpc.rpcReadAttempts,1);assert.equal(rpc.targetHandlesSentToActor,0);assert.equal(rpc.fileHandleInheritable,false);assert.equal(rpc.directoryHandleInheritable,false);assert.equal(rpc.channelsClosed,true);assert.equal(rpc.objectsClosed,true);assert.equal(rpc.postExitDisposition,'channel-closed-no-server-rejection-receipt-fabricated');
assert.equal(actor.value.operations.length,6);for(const row of actor.value.operations){assert.equal(row.ok,false);assert.equal(row.error,5);}
const payload=Buffer.from('owner-only-probe'),errors=[5,5,5,50,87,13,0,13,5023];
for(let i=0;i<9;i++){const response=actor.rpc.responses[i],request=rpc.requests[i];assert.equal(response.error,errors[i]);assert.equal(request.error,errors[i]);assert.equal(request.rpcReadAttempted,i===6);assert.equal(request.count,i===6?16:0);assert.equal(response.count,request.count);assert.equal(response.payloadHex,i===6?payload.toString('hex'):'');assert.equal(request.payloadHex,response.payloadHex);assert.equal(request.originalRootHandleMatched,true);assert.equal(request.jobObserved,true);assert.equal(request.tokenObserved,true);}
assert.equal(rpc.requests[6].digestBefore,hash(payload));assert.equal(rpc.requests[6].digestAfter,hash(payload));assert.deepEqual(rpc.requests[6].fileBefore,rpc.requests[6].fileAfter);assert.deepEqual(rpc.requests[6].securityBefore,rpc.requests[6].securityAfter);
for(let i=0;i<2;i++){const before=report.hostAcl.rows[i],after=report.hostAclAfter.rows[i];assert.equal(before.writeHandleClosed,true);assert.equal(before.setupHandleInheritable,false);assert.equal(before.metadataHandleInheritable,false);assert.deepEqual(before.before,after.identity);assert.deepEqual(before.finalSecurity,after.security);assert.equal(before.sha256,after.sha256);const acl=Buffer.from(before.finalSecurity.rawAclHex,'hex');assert.equal(acl.readUInt16LE(4),1);assert.equal(acl[8],0);assert.equal(acl[9],i?0:3);assert.equal(acl.readUInt32LE(12),0x1f01ff);assert(before.finalSecurity.control&0x1000);}
const result={checkedAt:new Date().toISOString(),directory,manifestSha256:hash(manifestBytes),archiveEntriesVerified:names.size,originalFilesCompared:originals,frozenGitBindings,localBinaryPathsVerified:checkedBinaryPaths,semanticReadbackPassed:true,newNativeRuns:0,newAclMutations:0,command:['node',path.relative(process.cwd(),fileURLToPath(import.meta.url)).replaceAll('\\','/'),path.relative(process.cwd(),directory).replaceAll('\\','/')],verifierSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url)))};
const output=path.join(directory,'archive-validation.json');if(!fs.existsSync(output))fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
