import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
import {capture,digest} from '../packages/cli/scripts/windows-rollup-gnu-forwarder.mjs';
const output=path.resolve('.work/windows-private-v4-20261009-c');fs.mkdirSync(output);
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
const fs=require('node:fs');const cp=require('node:child_process');process.chdir('X:\\workspace');
let child,closed;const original=cp.spawn;cp.spawn=(...args)=>{child=original(...args);closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}))});return child};
const api=require('X:\\workspace\\tree\\node_modules\\esbuild\\lib\\main.js');
(async()=>{const build=await api.build({absWorkingDir:'X:\\workspace',entryPoints:['entry.js'],bundle:true,platform:'node',outfile:'X:\\scratch\\bundle.js',logLevel:'silent'});const transform=await api.transform('const answer: number = 42',{loader:'ts'});child.stdin.end();child.ref();const exit=await closed;fs.writeFileSync('X:\\scratch\\service.json',JSON.stringify({build,transform,exit})+'\n');if(exit.code!==0||exit.signal)process.exitCode=2;})().catch(error=>{console.error(error.stack);process.exitCode=1;if(child)child.stdin.end()});
`;
fs.writeFileSync(path.join(root,'control/check.cjs'),check);report.checker=capture(path.join(root,'control/check.cjs'));
const run=spawnSync(path.join(output,'broker.exe'),[root],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:1024*1024});report.execution={status:run.status,signal:run.signal,error:run.error?.message??null,stdout:run.stdout,stderr:run.stderr};
for(const file of ['stdout','stderr','service.json','esbuild-trace.jsonl','bundle.js']){const source=path.join(root,'scratch',file);if(fs.existsSync(source)){const bytes=fs.readFileSync(source);fs.writeFileSync(path.join(output,file),bytes);report[file]={digest:digest(bytes),text:bytes.toString('utf8')}}}
const receipts=path.join(root,'scratch/adapter-receipts');report.receipts=fs.readdirSync(receipts).map(file=>JSON.parse(fs.readFileSync(path.join(receipts,file),'utf8')));
const manifest=path.join(root,'control/windows-node-private-v4.manifest.json');if(fs.existsSync(manifest)){report.manifestRaw=fs.readFileSync(manifest,'utf8');fs.writeFileSync(path.join(output,'manifest.json'),report.manifestRaw)}
}catch(error){report.error=error.stack}save();console.log(JSON.stringify({output,error:report.error??null,execution:report.execution,stderr:report.stderr}));
