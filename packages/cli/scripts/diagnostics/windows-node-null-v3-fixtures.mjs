// Fixed experimental checkers; frozen packages are never changed.
export const NULL_CHILD_SOURCE = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const scratch=process.argv[2],mode=process.argv[3];
try {
const adapter=require('./adapter/windows-node-null-v3-preload.cjs');
const trap=JSON.parse(require('./adapter/windows-node-null-v3.node').unlistedEventProbe());
if(trap.inherited!==false)throw Error('Unlisted parent Event leaked into child');
const data=Buffer.alloc(97,71),read=fs.readFileSync(0);
if(read.length!==0||fs.writeSync(1,data)!==97||fs.writeSync(2,data)!==97)throw Error('Null EOF/write differs');
let nested=null;
if(mode==='nested'){
 const contract=adapter.childContract();
 const result=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',__filename,scratch,'grandchild'],{stdio:'ignore',windowsHide:true,cwd:scratch,env:{...process.env,...contract.environment},timeout:3000});
 if(result.error||result.signal||result.status!==0)throw Error('Grandchild failed: '+result.error?.message+' '+result.status);
 nested=result.pid;
}
fs.writeFileSync(path.join(scratch,'null-observation-'+process.pid+'.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,mode,read:read.length,written:97,nested,trap,native:adapter.snapshot()}),{flag:'wx'});
}catch(error){fs.writeFileSync(path.join(scratch,'null-child-error-'+process.pid+'.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,mode,error:error.stack,code:error.code??null}),{flag:'wx'});throw error;}
`;
export const NULL_CHECK_SOURCE = String.raw`
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const workspace=process.argv[2],scratch=process.argv[3];
fs.mkdirSync(path.join(scratch,'adapter-receipts'));
const journal=fs.openSync(path.join(scratch,'journal.jsonl'),'wx');let seq=0;
function record(stage,detail={}){fs.writeSync(journal,JSON.stringify({seq:seq++,stage,pid:process.pid,...detail})+'\n');fs.fsyncSync(journal);}
record('started');
(async()=>{
 const adapter=require(path.join(workspace,'adapter/windows-node-null-v3-preload.cjs'));record('installed',{native:adapter.snapshot()});
 const nativeAddon=require(path.join(workspace,'adapter/windows-node-null-v3.node'));
 const trap=JSON.parse(nativeAddon.unlistedEventBegin());record('unlisted-event-started',{trap});
 const contract=adapter.childContract(),env={...process.env,...contract.environment,CC_WINDOWS_UNLISTED_EVENT_HANDLE_V3:trap.handle,CC_WINDOWS_UNLISTED_EVENT_NAME_V3:trap.objectName,CC_WINDOWS_UNLISTED_EVENT_TYPE_V3:String(trap.expectedTypeIndex)},child=path.join(workspace,'child.cjs');
 const sync=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',child,scratch,'nested'],{stdio:'ignore',windowsHide:true,cwd:scratch,env,timeout:6000});
 record('nested-result',{childPid:sync.pid,status:sync.status,signal:sync.signal,error:sync.error?.message,native:adapter.snapshot()});
 if(sync.error||sync.signal||sync.status!==0)throw Error('Nested child failed');
 const concurrent=await Promise.all([0,1,2].map(index=>new Promise((resolve,reject)=>{
  const c=cp.spawn(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',child,scratch,'concurrent-'+index],{stdio:'ignore',windowsHide:true,cwd:scratch,env});
  const timer=setTimeout(()=>reject(Error('Child deadline')),4000);c.once('error',e=>{clearTimeout(timer);reject(e);});
  c.once('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)reject(Error('Child exit '+code));else resolve(c.pid);});
 })));
 record('concurrent-completed',{pids:concurrent,native:adapter.snapshot()});
 const trapEnd=JSON.parse(nativeAddon.unlistedEventEnd());record('unlisted-event-closed',{trapEnd});
 const detached=cp.spawnSync(process.execPath,[child,scratch,'unexpected-detached'],{stdio:'ignore',windowsHide:true,cwd:scratch,env,detached:true,timeout:1000});
 if(!detached.error||detached.pid)throw Error('Unsupported detached launch was not rejected');
 const missing=cp.spawnSync(process.execPath,[child,scratch,'unexpected-no-preload'],{stdio:'ignore',windowsHide:true,cwd:scratch,env:{...env,NODE_OPTIONS:''},timeout:1000});
 if(!missing.error||missing.pid)throw Error('Missing preload launch was not rejected');
 record('negatives-completed',{detachedError:detached.error.code,missingPreloadError:missing.error.code,native:adapter.snapshot()});
 const unknown=JSON.parse(require(path.join(workspace,'adapter/windows-node-null-v3.node')).unknownHandleNegative());
 if(unknown.launchStage!=='launch-stdio'||unknown.launchRejected!==3||unknown.launched!==4)throw Error('Unknown inherited event handle was not rejected');
 record('unknown-handle-rejected',{native:unknown});
 record('completed',{native:adapter.snapshot()});
 process.stdout.write('CC_NULL_V3:'+JSON.stringify({pid:process.pid,nested:sync.pid,concurrent,native:adapter.snapshot()})+'\n');
})().catch(error=>{let native=null;try{native=JSON.parse(require(path.join(workspace,'adapter/windows-node-null-v3.node')).snapshot());}catch{}record('failed',{error:error.stack,native});process.stderr.write(error.stack+'\n');process.exitCode=1;}).finally(()=>fs.closeSync(journal));
`;
