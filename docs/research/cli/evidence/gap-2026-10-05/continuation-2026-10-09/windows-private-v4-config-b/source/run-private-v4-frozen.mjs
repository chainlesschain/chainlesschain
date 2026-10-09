import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {capture,digest} from '../packages/cli/scripts/windows-rollup-gnu-forwarder.mjs';
const output=path.resolve('.work/windows-private-v4-frozen-20261009-b-native-loader');fs.mkdirSync(output);
const compiler=path.resolve('.work/toolchains/llvm-mingw-20261006/llvm-mingw-20261006-ucrt-x86_64/bin/x86_64-w64-mingw32-clang++.exe');
const headers=path.dirname(JSON.parse(fs.readFileSync('.work/esbuild-api-trace-20261008-apc-detached-final/report.json')).headers[0].path);
const sources=['windows-node-private-v4-broker.cpp','windows-node-private-v4-adapter.cpp','windows-node-private-v4-adapter.h','windows-node-private-v4-paired.h','windows-node-private-v4-protocol.h','windows-esbuild-private-map-supervisor.cpp','windows-esbuild-private-map-shim.cpp'].map(file=>capture(path.resolve('packages/cli/scripts/diagnostics',file)));
const report={schema:'chainlesschain.windows-private-v4-diagnostic/v1',status:'NOT_ADMITTED',experimental:true,admissionEligible:false,formalSample:false,fullFrozenReviewCompleted:false,sources,commands:[],driver:capture(import.meta.filename)};
function save(){fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')}
try{
for(const [source,name,addon] of [[sources[0].path,'broker.exe',false],[sources[1].path,'windows-node-private-v4.node',true],[sources[6].path,'esbuild-private-shim.dll',true]]){
 const args=['-std=c++17','-O2','-Wall','-Wextra','-Werror','-static',...(addon?['-shared','-I',headers]:['-municode']),source,'-ladvapi32','-lbcrypt','-lshell32',...(!addon?['-luserenv']:[]),'-Wl,--no-insert-timestamp','-o',path.join(output,name)];
 const run=spawnSync(compiler,args,{encoding:'utf8',timeout:60000,windowsHide:true});report.commands.push({args,status:run.status,stdout:run.stdout,stderr:run.stderr});if(run.status!==0)throw Error('compile failed '+name);
}
report.outputs=['broker.exe','windows-node-private-v4.node','esbuild-private-shim.dll'].map(file=>capture(path.join(output,file)));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cc-private-v4-'));report.root=root;
for(const dir of ['control','workspace/adapter','scratch/adapter-receipts'])fs.mkdirSync(path.join(root,dir),{recursive:true});
fs.copyFileSync(process.execPath,path.join(root,'control/node.exe'));
fs.cpSync('.work/native-toolchain-prepare-2026-10-08-canonical-pairs/tree',path.join(root,'workspace/tree'),{recursive:true,errorOnExist:true,force:false});
for(const name of ['windows-node-private-v4.node','esbuild-private-shim.dll'])fs.copyFileSync(path.join(output,name),path.join(root,'workspace/adapter',name));
for(const name of ['windows-node-private-v4-preload.cjs','windows-node-private-v4-identity.cjs'])fs.copyFileSync(path.join('packages/cli/scripts/diagnostics',name),path.join(root,'workspace/adapter',name));
fs.writeFileSync(path.join(root,'workspace/entry.js'),'export const answer = 42;\n');
const check=String.raw`require('X:\\workspace\\adapter\\windows-node-private-v4-preload.cjs');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{pathToFileURL}=require('node:url');
const workspace='X:\\workspace\\tree',scratch='X:\\scratch';process.chdir(path.join(workspace,'packages/cli'));process.env.CI='1';process.env.NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main --require X:\\workspace\\adapter\\windows-node-private-v4-preload.cjs';
const journal=fs.openSync(path.join(scratch,'journal.jsonl'),'wx');let sequence=0;const record=(phase,data={})=>{fs.writeSync(journal,JSON.stringify({sequence:++sequence,pid:process.pid,phase,...data})+'\n');fs.fsyncSync(journal)};
let service,closed;const original=cp.spawn;cp.spawn=(...args)=>{record('spawn',{application:args[0],args:args[1]});const child=original(...args);if(String(args[0]).endsWith('esbuild.exe')){service=child;closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))})}return child};
(async()=>{record('started');const testFile=path.join(scratch,'probe.test.mjs');fs.writeFileSync(testFile,'import {it,expect} from "'+pathToFileURL(path.join(workspace,'node_modules/vitest/dist/index.js')).href+'";it("frozen forks smoke",()=>expect(2+3).toBe(5));\n');record('vitest-import-started');const {startVitest}=await import(pathToFileURL(path.join(workspace,'node_modules/vitest/dist/node.js')).href);record('vitest-import-completed');const context=await startVitest('test',[testFile],{root:path.join(workspace,'packages/cli'),config:path.join(workspace,'packages/cli/vitest.config.js'),configLoader:'native',watch:false,reporters:['json'],include:[testFile],cache:false});if(!context)throw Error('no Vitest context');try{record('config-loaded',{pool:context.config.pool,maxWorkers:context.config.maxWorkers});if(context.config.pool!=='forks'||context.config.maxWorkers!==2)throw Error('frozen configuration differs');const tests=context.state.getTestModules().flatMap(module=>Array.from(module.children.allTests()));if(tests.length!==1||tests[0].result().state!=='passed'||process.exitCode)throw Error('smoke did not pass');record('completed',{tests:1});}finally{await context.close();}})().catch(error=>{record('failed',{message:error.message,code:error.code??null});console.error(error.stack);process.exitCode=1}).finally(async()=>{if(service){service.stdin.end();service.ref();await closed;}fs.closeSync(journal)});
`;
fs.writeFileSync(path.join(root,'control/check.cjs'),check);report.checker=capture(path.join(root,'control/check.cjs'));
const run=spawnSync(path.join(output,'broker.exe'),[root],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:1024*1024});report.execution={status:run.status,signal:run.signal,error:run.error?.message??null,stdout:run.stdout,stderr:run.stderr};
for(const file of ['stdout','stderr','service.json','esbuild-trace.jsonl','bundle.js','journal.jsonl']){const source=path.join(root,'scratch',file);if(fs.existsSync(source)){const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(output,file),bytes);report[file]={digest:digest(bytes),text:bytes.toString('utf8')}}}
const receipts=path.join(root,'scratch/adapter-receipts');report.receipts=fs.readdirSync(receipts).map(file=>JSON.parse(fs.readFileSync(path.join(receipts,file),'utf8')));
const manifest=path.join(root,'control/windows-node-private-v4.manifest.json');if(fs.existsSync(manifest)){report.manifestRaw=fs.readFileSync(manifest,'utf8');fs.writeFileSync(path.join(output,'manifest.json'),report.manifestRaw)}
}catch(error){report.error=error.stack}save();console.log(JSON.stringify({output,error:report.error??null,execution:report.execution,stderr:report.stderr}));
