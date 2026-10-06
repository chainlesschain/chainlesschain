import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadConfig} from '../packages/cli/src/lib/config-manager.js';
import {applyConfigLlmDefaults} from '../packages/cli/src/lib/llm-config-defaults.js';
const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'cc-public-vscode-live-'));
const archive='docs/research/ide/evidence/gap-2026-10-05/public-vscode-live-windows-first';fs.mkdirSync(archive);
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(archive,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const installScope=JSON.parse(fs.readFileSync('docs/research/cli/evidence/gap-2026-10-05/public-cli-first-run-windows-v3/scope.json','utf8'));
const install=path.join(installScope.root,'install'),cli=path.join(install,'node_modules/chainlesschain/bin/chainlesschain.js'),command=path.join(install,'node_modules/.bin/cc.cmd');
if(!fs.statSync(cli).isFile()||!fs.statSync(command).isFile())throw Error('Public installed CLI missing');
const dirs=Object.fromEntries(['workspace','captureDir','profileHome','userDataDir','extensionsDir'].map(name=>[name,path.join(root,name)]));for(const dir of Object.values(dirs))fs.mkdirSync(dir);
const security=path.join(root,'security');fs.mkdirSync(security);
const llm={provider:'volcengine'};applyConfigLlmDefaults(llm,loadConfig().llm||{});llm.apiKey||=process.env.VOLCENGINE_API_KEY;if(!llm.apiKey||llm.model!=='deepseek-v4-flash-ga-260731')throw Error('Authorized Volcengine profile missing');
const system=process.env.SystemRoot||'C:\\Windows',nodeHome=path.dirname(fs.realpathSync.native(process.execPath));
const env={PATH:[path.join(install,'node_modules/.bin'),nodeHome,path.join(system,'System32'),path.join(system,'System32/WindowsPowerShell/v1.0')].join(path.delimiter),SystemRoot:system,WINDIR:system,ComSpec:path.join(system,'System32/cmd.exe'),TEMP:root,TMP:root,HOME:dirs.profileHome,USERPROFILE:dirs.profileHome,APPDATA:path.join(dirs.profileHome,'AppData/Roaming'),LOCALAPPDATA:path.join(dirs.profileHome,'AppData/Local'),CHAINLESSCHAIN_HOME:path.join(dirs.profileHome,'.chainlesschain'),CHAINLESSCHAIN_SECURITY_ANCHOR_HOME:security,VOLCENGINE_API_KEY:llm.apiKey,NO_COLOR:'1',CI:'1'};
save('scope.json',{scope:'public-open-vsx-and-npm-real-vscode-volcengine-diagnostic',root,...dirs,publicCliVersion:'0.166.90',publicExtensionVersion:'0.37.135',hostVersion:'1.132.0',osRelease:os.release(),node:process.version,formalSample:false,observationsCreated:false,operatorDeadlineMs:600000,maximumModelTurns:4,sourceCommitVerified:false});
fs.copyFileSync(new URL(import.meta.url),path.join(archive,'operator-script.mjs'),fs.constants.COPYFILE_EXCL);
for(const [key,value]of[['llm.provider','volcengine'],['llm.model',llm.model],['llm.baseUrl','https://ark.cn-beijing.volces.com/api/v3']]){
 const startedAt=new Date().toISOString(),result=spawnSync(process.execPath,[cli,'config','set',key,value],{cwd:dirs.workspace,env,windowsHide:true,shell:false,timeout:120000,encoding:'utf8'});
 save('configure-'+key.split('.')[1]+'.json',{startedAt,finishedAt:new Date().toISOString(),status:result.status,signal:result.signal,error:result.error?.code||null,stdout:(result.stdout||'').replaceAll(llm.apiKey,'[REDACTED]'),stderr:(result.stderr||'').replaceAll(llm.apiKey,'[REDACTED]')});if(result.status!==0||result.signal||result.error)throw Error('Isolated CLI configuration failed');
}
fs.mkdirSync(path.join(dirs.userDataDir,'User'));
fs.writeFileSync(path.join(dirs.userDataDir,'User/settings.json'),JSON.stringify({'chainlesschain.ide.enabled':true,'chainlesschain.cli.managed.enabled':false,'chainlesschain.cli.path':command,'chainlesschain.chat.maxTurns':4,'extensions.autoCheckUpdates':false,'extensions.autoUpdate':false,'telemetry.telemetryLevel':'off','update.mode':'none'},null,2));
const config={sampleId:'first-run-public-windows-vscode',prompt:'Create onboarding-proof.txt in this workspace with exactly CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1 followed by a newline. Read it back to verify. Use only file write and read tools. Do not run shell commands. Reply DONE.',provider:'volcengine',model:llm.model,permissionMode:'auto',hostVersion:'1.132.0',extensionVersion:'0.37.135',deadline:Date.now()+600000,...dirs};
const configFile=path.join(root,'config.json'),bytes=Buffer.from(JSON.stringify(config,null,2)+'\n');fs.writeFileSync(configFile,bytes,{flag:'wx'});save('launcher-config.json',config);
const vsix=path.resolve('docs/research/ide/evidence/gap-2026-10-05/public-vscode-market-source-v2/chainlesschain-ide-0.37.135.vsix');
const log=path.join(root,'launcher.log'),fd=fs.openSync(log,'wx');let child;
try{child=spawn(process.execPath,['packages/vscode-extension/test/extension-host/verify01-run.cjs','--config',configFile,'--config-digest',hash(bytes),'--vsix',vsix,'--vsix-digest',hash(fs.readFileSync(vsix)),'--confirm-live'],{cwd:process.cwd(),env,windowsHide:true,shell:false,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
for(const entry of fs.readdirSync(dirs.captureDir)){const source=path.join(dirs.captureDir,entry);if(fs.statSync(source).isFile()){const data=fs.readFileSync(source);if(data.includes(Buffer.from(llm.apiKey)))throw Error('Credential exposed by host capture');fs.copyFileSync(source,path.join(archive,entry),fs.constants.COPYFILE_EXCL);}}
const text=fs.readFileSync(log,'utf8').replaceAll(llm.apiKey,'[REDACTED]');fs.writeFileSync(path.join(archive,'launcher.log'),text,{flag:'wx'});
const result={schema:'chainlesschain.public-vscode-live-diagnostic/v1',finishedAt:new Date().toISOString(),passed:exit.code===0&&!exit.signal,exit,root,formalSample:false,observationsCreated:false,publicArtifactsUsed:true,provider:'volcengine',model:llm.model,sourceCommitVerified:false};
const proof=path.join(dirs.workspace,'onboarding-proof.txt');if(fs.existsSync(proof)){const data=fs.readFileSync(proof);result.artifactExact=data.toString('utf8')==='CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1\n';result.artifactDigest=hash(data);fs.writeFileSync(path.join(archive,'onboarding-proof.txt'),data,{flag:'wx'});}
save('diagnostic-result.json',result);console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
