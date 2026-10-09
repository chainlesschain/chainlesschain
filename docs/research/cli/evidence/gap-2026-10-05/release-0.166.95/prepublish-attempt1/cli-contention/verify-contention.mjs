import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {withFileLockAsync} from '../../packages/cli/src/lib/with-file-lock.js';
import {ScopedPermissionStore} from '../../packages/cli/src/lib/scoped-permission-store.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-release095-lock-contention-'));
const cwd=path.join(root,'workspace'),file=path.join(root,'authority','rules.json');
fs.mkdirSync(cwd);fs.mkdirSync(path.dirname(file));
const test=fs.readFileSync('packages/cli/__tests__/unit/scoped-permission-mutation-authority.test.js','utf8');
const moduleUrl=pathToFileURL(path.resolve('packages/cli/src/lib/scoped-permission-store.js')).href;
const source=test.split('const source = `')[1].split('`;')[0].replace('${JSON.stringify(moduleUrl)}',JSON.stringify(moduleUrl));
const records=[];const completions=[];
try {
 await withFileLockAsync(file,async()=>{
  const retries=Array.from({length:4},(_,index)=>new Promise((resolve,reject)=>{
   const row={index,stdout:'',stderr:''};records.push(row);
   const child=spawn(process.execPath,['--input-type=module','-e',source,cwd,file],{windowsHide:true});
   const timeout=setTimeout(()=>{child.kill();reject(new Error('child exceeded 15 seconds'));},15000);
   child.stdout.on('data',b=>{row.stdout+=b;});
   child.stderr.on('data',b=>{row.stderr+=b;if(row.stderr.includes('Retrying uncommitted scoped permission contention'))resolve();});
   completions.push(new Promise((done,fail)=>{
    child.once('error',e=>{clearTimeout(timeout);reject(e);fail(e);});
    child.once('close',(code,signal)=>{clearTimeout(timeout);row.code=code;row.signal=signal;if(code!==0)reject(new Error(row.stderr));done(row);});
   }));
  }));
  await Promise.all(retries);
 },{failIfUnavailable:true,timeoutMs:2000});
 await Promise.all(completions);
 for(const r of records){assert.equal(r.code,0,r.stderr);assert.match(r.stderr,/STATE_LOCK_UNAVAILABLE/);assert.match(r.stderr,/not-committed/);}
 const ids=records.map(r=>r.stdout.trim());assert.equal(new Set(ids).size,4);
 const state=new ScopedPermissionStore({cwd,filePath:file}).list();assert.equal(state.generation,4);assert.equal(state.rules.length,4);
 fs.writeFileSync('.work/release095-cli-ci-failure-113759627120/forced-contention-result.json',JSON.stringify({verified:true,children:records,generation:state.generation},null,2)+'\n');
 console.log(JSON.stringify({verified:true,children:records.length,retryObserved:records.length,generation:state.generation,uniqueIds:new Set(ids).size}));
} finally {await Promise.allSettled(completions);fs.rmSync(root,{recursive:true,force:true});}
