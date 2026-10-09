import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const root=path.resolve('.work/astra-popup-dispatch-contract-20261009');
const java=path.resolve('.work/jdk21-release-validation/jdk-21.0.12.1+1/bin/java.exe');
const rhino=path.resolve('packages/jetbrains-plugin/build/idea-sandbox/zip-isolation-check/IC-2024.2/plugins_runIdeForUiTests/robot-server-plugin/lib/rhino-1.7.15.jar');
const cp=[path.join(root,'classes'),rhino,fs.readFileSync(path.join(root,'runtime-classpath.txt'),'utf8').trim()].join(path.delimiter);
const result=spawnSync(java,['-Djava.awt.headless=true','-cp',cp,'PopupDispatchContract',root],{windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(root,'run2.stdout.log'),result.stdout ?? Buffer.alloc(0),{flag:'wx'});
fs.writeFileSync(path.join(root,'run2.stderr.log'),result.stderr ?? Buffer.alloc(0),{flag:'wx'});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const metadata={capturedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,error:result.error?.message,rhinoSha256:sha(rhino),runtimeClasspathSha256:sha(path.join(root,'runtime-classpath.txt')),priorAttempt:{files:['run.stdout.log','run.stderr.log'],reason:'PowerShell ErrorActionPreference=Stop terminated the first harness invocation upon its expected stderr diagnostic; incomplete attempt retained.'}};
fs.writeFileSync(path.join(root,'run2-metadata.json'),JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(metadata));
if(result.status!==0){process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exitCode=1;}
else console.log(fs.readFileSync(path.join(root,'report.json'),'utf8'));
