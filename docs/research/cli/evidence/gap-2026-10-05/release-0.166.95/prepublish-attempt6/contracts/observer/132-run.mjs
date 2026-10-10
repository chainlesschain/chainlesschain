import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=path.resolve('.work/astra-ui-failure-script-20261010');const label=process.argv[2]||'initial';const run=path.join(root,label);fs.mkdirSync(run,{recursive:true});
const classRelative='com/chainlesschain/ide/uitest/UiFailureDiagnostics.class';const isolated=path.join(run,'classes');fs.mkdirSync(path.dirname(path.join(isolated,classRelative)),{recursive:true});
const source='packages/jetbrains-plugin/src/uiTest/java/com/chainlesschain/ide/uitest/UiFailureDiagnostics.java';const compiled='packages/jetbrains-plugin/build/classes/java/uiTest/'+classRelative;
fs.copyFileSync(source,path.join(run,'UiFailureDiagnostics.source.java'));fs.copyFileSync(compiled,path.join(isolated,classRelative));
const runtime=fs.readFileSync('.work/astra-popup-dispatch-contract-20261009/runtime-classpath.txt','utf8').trim();
const rhino=path.resolve('packages/jetbrains-plugin/build/idea-sandbox/zip-isolation-check/IC-2024.2/plugins_runIdeForUiTests/robot-server-plugin/lib/rhino-1.7.15.jar');
const javaRoot=path.resolve('.work/jdk21-release-validation/jdk-21.0.12.1+1/bin');
const cp=[isolated,rhino,runtime].join(path.delimiter);
function command(name,args,stem){const r=spawnSync(path.join(javaRoot,name+'.exe'),args,{windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});fs.writeFileSync(path.join(run,stem+'.stdout.log'),r.stdout||'');fs.writeFileSync(path.join(run,stem+'.stderr.log'),r.stderr||'');if(r.status!==0)throw Error(stem+' exit '+r.status+' '+r.error+' '+r.stderr);return r;}
command('javac',['-cp',cp,'-d',isolated,path.join(root,'src/SnapshotContract.java')],'compile');
command('java',['-Djava.awt.headless=true','-cp',cp,'SnapshotContract',run],'run');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const metadata={sourceSha256:sha(path.join(run,'UiFailureDiagnostics.source.java')),classSha256:sha(path.join(isolated,classRelative)),classModified:fs.statSync(compiled).mtime.toISOString(),actualScriptSha256:sha(path.join(run,'actual-script.js')),rhinoSha256:sha(rhino),label};
fs.writeFileSync(path.join(run,'metadata.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata));console.log(fs.readFileSync(path.join(run,'report.json'),'utf8'));
