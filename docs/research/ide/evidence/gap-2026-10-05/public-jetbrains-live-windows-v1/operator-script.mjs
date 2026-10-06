// One explicitly authorized public-artifact live diagnostic; never resubmit after failure.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadConfig} from '../packages/cli/src/lib/config-manager.js';
import {applyConfigLlmDefaults} from '../packages/cli/src/lib/llm-config-defaults.js';
import {launchLogged,requireSuccess,stopOwned} from '../scripts/lib/verify01-diagnostic-process.mjs';
const repo=process.cwd();
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const digest=p=>hash(fs.readFileSync(p));
const inventory=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?inventory(path.join(dir,e.name)):[path.join(dir,e.name)]);
const manifestPath=path.resolve('.work/public-jetbrains-current-driver-v2/manifest.json');
const driver=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(driver.result.status!==0||driver.result.exceptionOutput!==false||driver.classes.length===0)throw Error('Current source driver compile not successful');
for(const entry of [...driver.sources,...driver.classes,...driver.dependencies,driver.compiler])if(digest(entry.path)!==entry.sha256)throw Error('Driver bound byte identity changed: '+entry.path);
const sourceDir=path.resolve('docs/research/ide/evidence/gap-2026-10-05/public-jetbrains-market-source');
const source=JSON.parse(fs.readFileSync(path.join(sourceDir,'readback.json'),'utf8'));
const zip=path.join(sourceDir,source.file);
if(source.version!=='0.4.153'||digest(zip)!==source.sha256)throw Error('Public Marketplace archive identity changed');
const idea=String.raw`C:\Users\longfa\.gradle\caches\transforms-4\dbb682d26f44c694592b06df4c7b2971\transformed\ideaIC-2024.2-win`;
const exe=path.join(idea,'bin/idea64.exe');
const product=JSON.parse(fs.readFileSync(path.join(idea,'product-info.json'),'utf8'));
if(product.version!=='2024.2'||product.buildNumber!=='242.20224.300')throw Error('Cached official host identity mismatch');
const installScope=JSON.parse(fs.readFileSync('docs/research/cli/evidence/gap-2026-10-05/public-cli-first-run-windows-v3/scope.json','utf8'));
const install=path.join(installScope.root,'install'),cli=path.join(install,'node_modules/chainlesschain/bin/chainlesschain.js'),command=path.join(install,'node_modules/.bin/cc.cmd');
const cliPackage=JSON.parse(fs.readFileSync(path.join(install,'node_modules/chainlesschain/package.json'),'utf8'));
if(cliPackage.version!=='0.166.90')throw Error('Public CLI version mismatch');
const llm={provider:'volcengine'};applyConfigLlmDefaults(llm,loadConfig().llm||{});llm.apiKey||=process.env.VOLCENGINE_API_KEY;
if(!llm.apiKey||llm.model!=='deepseek-v4-flash-ga-260731')throw Error('Authorized Volcengine profile missing');
const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'cc-public-jetbrains-live-'));
const archive=path.resolve('docs/research/ide/evidence/gap-2026-10-05/public-jetbrains-live-windows-v1');fs.mkdirSync(archive);
const dirs=Object.fromEntries(['workspace','capture','home','config','system','plugins','logs','security'].map(n=>[n,path.join(root,n)]));for(const dir of Object.values(dirs))fs.mkdirSync(dir);
const save=(name,value)=>fs.writeFileSync(path.join(archive,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const safeCopy=(p,d)=>{const data=fs.readFileSync(p);if(data.includes(Buffer.from(llm.apiKey)))throw Error('Credential found; artifact quarantined: '+path.basename(p));fs.mkdirSync(path.dirname(d),{recursive:true});fs.writeFileSync(d,data,{flag:'wx'});};
save('preparation-interruption.json',{schema:'chainlesschain.operator-preparation-interruption/v1',action:'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .work/prepare-public-jetbrains-driver.ps1',requestedCommand:'gradlew.bat compileUiTestJava --offline --no-daemon --no-configuration-cache --console=plain',waitSecondsApproximately:493,toolResult:'aborted by user',interruptedBy:'root agent after pending approval/tool wait',stdoutObserved:false,sessionIdObserved:false,compileSuccessClaimed:false,liveRootCreated:false,guiStarted:false,modelInputCount:0,automaticReviewRejectionReasonReceived:false,subsequentPreparation:'Direct javac current-source compilation, recorded separately'});
save('driver-build-manifest.json',driver);
safeCopy(path.resolve('.work/public-jetbrains-current-driver/manifest.json'),path.join(archive,'prior-sandbox-compile-manifest.json'));
safeCopy(path.resolve('.work/public-jetbrains-current-driver/compile.log'),path.join(archive,'prior-sandbox-compile.log'));
safeCopy(new URL(import.meta.url),path.join(archive,'operator-script.mjs'));
safeCopy(path.resolve('.work/prepare-public-jetbrains-driver.mjs'),path.join(archive,'prepare-driver.mjs'));
for(const entry of driver.sources)safeCopy(entry.path,path.join(archive,'driver-source',path.basename(entry.path)));
for(const entry of driver.classes)safeCopy(entry.path,path.join(archive,'driver-classes',path.relative(path.join(driver.output,'classes'),entry.path)));
safeCopy(path.join(driver.output,'compile.log'),path.join(archive,'driver-compile.log'));
const system=process.env.SystemRoot||'C:\\Windows';
const env={PATH:[path.join(install,'node_modules/.bin'),path.dirname(fs.realpathSync.native(process.execPath)),path.join(system,'System32'),path.join(system,'System32/WindowsPowerShell/v1.0')].join(path.delimiter),SystemRoot:system,WINDIR:system,ComSpec:path.join(system,'System32/cmd.exe'),TEMP:root,TMP:root,HOME:dirs.home,USERPROFILE:dirs.home,APPDATA:path.join(dirs.home,'AppData/Roaming'),LOCALAPPDATA:path.join(dirs.home,'AppData/Local'),CHAINLESSCHAIN_HOME:path.join(dirs.home,'.chainlesschain'),CHAINLESSCHAIN_SECURITY_ANCHOR_HOME:dirs.security,VOLCENGINE_API_KEY:llm.apiKey,CC_ITERATION_BUDGET:'4',CC_IDE_REQUIRED_HOST_ARCH:'amd64',CC_IDE_REQUIRED_HOST_VERSION:'2024.2',NO_COLOR:'1',CI:'1'};
save('scope.json',{schema:'chainlesschain.public-jetbrains-live-scope/v1',root,...dirs,publicCliVersion:cliPackage.version,publicPluginVersion:source.version,publicPluginDigest:source.sha256,hostVersion:product.version,hostBuild:product.buildNumber,hostExecutableDigest:digest(exe),osRelease:os.release(),node:process.version,driverManifestDigest:digest(manifestPath),formalSample:false,observationsCreated:false,sourceCommitVerified:false,provider:'volcengine',model:llm.model,permissionMode:'acceptEdits',maximumModelTurns:4,turnBudgetMechanism:'CC_ITERATION_BUDGET=4',taskDeadlineMs:600000,initialThenRestartWithoutResubmission:true,automaticCompletionEnabled:false});
const state={schema:'chainlesschain.public-jetbrains-live-diagnostic/v1',startedAt:new Date().toISOString(),passed:false,formalSample:false,observationsCreated:false,publicArtifactsUsed:true,provider:'volcengine',model:llm.model,sourceCommitVerified:false,phases:[],root,billedCost:'unknown'};
let host=null,guiDriver=null;
const robotUrl='http://127.0.0.1:8082';
async function portFree(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8082,'127.0.0.1',resolve);});await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
async function robotJs(script,signal=AbortSignal.timeout(10000)){const response=await fetch(robotUrl+'/js/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runInEdt:false,script}),signal});if(!response.ok)throw Error('Robot HTTP '+response.status);const body=await response.json();if(body.exception)throw Error('Robot exception: '+body.message);return body;}
async function stopHost(){if(!host)return;await stopOwned(host,{requireRunningOwner:true,gracefulDeadline:Date.now()+45000,gracefulStop:({signal})=>robotJs("importClass(com.intellij.openapi.application.ApplicationManager); importClass(java.lang.Runnable); var app=ApplicationManager.getApplication(); app.invokeLater(new Runnable({run:function(){app.exit(Packages.com.intellij.openapi.application.ex.ApplicationEx.EXIT_CONFIRMED | Packages.com.intellij.openapi.application.ex.ApplicationEx.SAVE);}}));",signal)});host=null;await portFree();}
const quotePs=v=>"'"+v.replaceAll("'","''")+"'";
try{
 await portFree();
 const extract=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${quotePs(zip)} -DestinationPath ${quotePs(dirs.plugins)}`],{windowsHide:true,encoding:'utf8',timeout:120000});
 save('extract-result.json',{status:extract.status,signal:extract.signal,error:extract.error?.message||null,stdout:extract.stdout,stderr:extract.stderr});if(extract.status!==0)throw Error('Public ZIP extraction failed');
 const pluginEntries=fs.readdirSync(dirs.plugins,{withFileTypes:true}).filter(e=>e.isDirectory());if(pluginEntries.length!==1)throw Error('Expected one public plugin');
 const pluginRoot=path.join(dirs.plugins,pluginEntries[0].name);
 save('installed-public-plugin-inventory.json',{archiveDigest:digest(zip),root:pluginRoot,files:inventory(pluginRoot).map(p=>({relative:path.relative(pluginRoot,p),sha256:digest(p),bytes:fs.statSync(p).size}))});
 fs.cpSync(driver.robot,path.join(dirs.plugins,'robot-server-plugin'),{recursive:true,errorOnExist:true,force:false});
 for(const [key,value]of[['llm.provider','volcengine'],['llm.model',llm.model],['llm.baseUrl','https://ark.cn-beijing.volces.com/api/v3']]){const result=spawnSync(process.execPath,[cli,'config','set',key,value],{cwd:dirs.workspace,env,windowsHide:true,encoding:'utf8',timeout:120000});save('configure-'+key.split('.')[1]+'.json',{status:result.status,signal:result.signal,error:result.error?.code||null,stdout:(result.stdout||'').replaceAll(llm.apiKey,'[REDACTED]'),stderr:(result.stderr||'').replaceAll(llm.apiKey,'[REDACTED]')});if(result.status!==0)throw Error('Isolated public CLI config failed');}
 const xmlEscape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');fs.mkdirSync(path.join(dirs.config,'options'));
 fs.writeFileSync(path.join(dirs.config,'options/chainlesschain-ide.xml'),`<application><component name="ChainlessChainIdeSettings"><option name="ccPath" value="${xmlEscape(command)}"/><option name="managedCliEnabled" value="false"/><option name="automaticCompletionEnabled" value="false"/></component></application>`,{flag:'wx'});
 const vmFile=path.join(root,'idea.vmoptions'),base=fs.readFileSync(path.join(idea,'bin/idea64.exe.vmoptions'),'utf8');
 const props={'idea.config.path':dirs.config,'idea.system.path':dirs.system,'idea.plugins.path':dirs.plugins,'idea.log.path':dirs.logs,'user.home':dirs.home,'chainlesschain.verify01.captureRoot':dirs.capture,'robot-server.port':'8082','robot-server.host.public':'false','ide.mac.message.dialogs.as.sheets':'false','jb.privacy.policy.text':'<!--999.999-->','jb.consents.confirmation.enabled':'false','ide.show.tips.on.startup.default.value':'false','idea.trust.all.projects':'true'};
 fs.writeFileSync(vmFile,base.trim()+'\n'+Object.entries(props).map(([k,v])=>`-D${k}=${v}`).join('\n')+'\n',{flag:'wx'});env.IDEA_VM_OPTIONS=vmFile;
 const promptFile=path.join(root,'prompt.txt');fs.writeFileSync(promptFile,'Create onboarding-proof.txt in this workspace with exactly CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1 followed by a newline. Read it back to verify. Use only file write and read tools. Do not run shell commands. Reply DONE.',{flag:'wx'});safeCopy(promptFile,path.join(archive,'prompt.txt'));
 let taskDeadline=null;
 for(const phase of ['initial','restart']){
  if(phase==='restart'&&!fs.existsSync(path.join(dirs.capture,'restart-state.json')))throw Error('No successful initial restart receipt; no restart or resend attempted');
  await portFree();host=launchLogged(exe,[dirs.workspace],{cwd:dirs.workspace,env,logFile:path.join(root,'ide-'+phase+'.log')});
  const startupDeadline=taskDeadline||Date.now()+300000;let ready=false;
  while(Date.now()<startupDeadline){if(host.closed)throw Error('IDE exited before Robot readiness');try{const r=await fetch(robotUrl,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await delay(500);}
  if(!ready)throw Error('IDE Robot readiness deadline exceeded');
  const identityPath=path.join(dirs.capture,'host-identity-'+phase+'.json');
  const identityScript=`var p=Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')); if(p===null)throw new Error('Public plugin absent'); var o={pluginVersion:String(p.getVersion()),pluginPath:String(p.getPluginPath()),hostVersion:String(Packages.com.intellij.openapi.application.ApplicationInfo.getInstance().getFullVersion()),hostBuild:String(Packages.com.intellij.openapi.application.ApplicationInfo.getInstance().getBuild()),configPath:String(Packages.com.intellij.openapi.application.PathManager.getConfigPath()),processId:String(java.lang.ProcessHandle.current().pid()),javaVersion:String(java.lang.System.getProperty('java.version')),arch:String(java.lang.System.getProperty('os.arch')),iterationBudget:String(java.lang.System.getenv('CC_ITERATION_BUDGET'))}; java.nio.file.Files.writeString(java.nio.file.Path.of(${JSON.stringify(identityPath)}),JSON.stringify(o),java.nio.file.StandardOpenOption.CREATE_NEW);`;
  await robotJs(identityScript);const identity=JSON.parse(fs.readFileSync(identityPath,'utf8'));
  if(identity.pluginVersion!=='0.4.153'||path.resolve(identity.pluginPath)!==path.resolve(pluginRoot)||path.resolve(identity.configPath)!==path.resolve(dirs.config)||identity.iterationBudget!=='4')throw Error('Actual host public plugin/profile/budget mismatch');
  if(taskDeadline===null)taskDeadline=Date.now()+600000;
  const args=['--add-opens','java.base/java.lang=ALL-UNNAMED','-Dfile.encoding=UTF-8',`-Dui.verify01.captureRoot=${dirs.capture}`,`-Dui.verify01.workspace=${dirs.workspace}`,'-Dui.verify01.sampleId=first-run-public-windows-jetbrains',`-Dui.verify01.promptFile=${promptFile}`,`-Dui.verify01.deadlineMs=${taskDeadline}`,'-Dui.verify01.permissionMode=acceptEdits',`-Dui.journey.phase=${phase}`,`-Dui.robot.url=${robotUrl}`,'-cp',path.join(driver.output,'classes')+path.delimiter+driver.classpath,'com.chainlesschain.ide.uitest.PublicJetBrainsDriver'];
  guiDriver=launchLogged(driver.java,args,{cwd:repo,env,logFile:path.join(root,'driver-'+phase+'.log')});
  const exit=await requireSuccess(guiDriver,taskDeadline,'Public JetBrains '+phase+' driver');guiDriver=null;state.phases.push({phase,exit,completedAt:new Date().toISOString()});await stopHost();
 }
 state.passed=true;
}catch(error){state.error=String(error.stack||error);}
finally{
 if(guiDriver)try{await stopOwned(guiDriver);}catch(error){state.driverCleanupError=String(error);state.passed=false;}
 if(host)try{await stopHost();}catch(error){state.hostCleanupError=String(error);state.passed=false;}
 state.finishedAt=new Date().toISOString();
 for(const file of inventory(dirs.capture))safeCopy(file,path.join(archive,'capture',path.relative(dirs.capture,file)));
 for(const file of fs.readdirSync(root).filter(n=>/^(?:ide|driver)-(?:initial|restart)\.log(?:\.cleanup\.json)?$/.test(n)))safeCopy(path.join(root,file),path.join(archive,file));
 for(const file of inventory(dirs.logs).filter(p=>/idea\.log(?:\.\d+)?$/.test(p)))safeCopy(file,path.join(archive,'host-logs',path.relative(dirs.logs,file)));
 const proof=path.join(dirs.workspace,'onboarding-proof.txt');if(fs.existsSync(proof)){state.artifactExact=fs.readFileSync(proof,'utf8')==='CHAINLESSCHAIN_PUBLIC_IDE_FIRST_RUN_V1\n';state.artifactDigest=digest(proof);safeCopy(proof,path.join(archive,'onboarding-proof.txt'));}
 save('diagnostic-result.json',state);console.log(JSON.stringify(state));if(!state.passed)process.exitCode=1;
}
