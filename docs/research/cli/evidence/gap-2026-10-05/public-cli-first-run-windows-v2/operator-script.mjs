import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadConfig} from '../packages/cli/src/lib/config-manager.js';
import {applyConfigLlmDefaults} from '../packages/cli/src/lib/llm-config-defaults.js';
import {verifyCliRegistryInstall} from '../packages/cli/scripts/verify-cli-registry-install.mjs';
import {stopOwned, withinDeadline} from '../scripts/lib/verify01-diagnostic-process.mjs';

const version='0.166.90';
const archive=path.resolve(process.argv[2]||'docs/research/cli/evidence/gap-2026-10-05/public-cli-first-run-windows');
if(fs.existsSync(archive)) throw Error('Refusing to replace an earlier attempt');
fs.mkdirSync(archive,{recursive:true});
const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'cc-public-first-run-'));
const digest=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(archive,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const config=loadConfig();const llm={provider:'volcengine'};applyConfigLlmDefaults(llm,config.llm||{});llm.apiKey||=process.env.VOLCENGINE_API_KEY;
if(llm.provider!=='volcengine'||llm.model!=='deepseek-v4-flash-ga-260731'||llm.baseUrl!=='https://ark.cn-beijing.volces.com/api/v3'||!llm.apiKey) throw Error('Configured Volcengine identity unavailable');
const install=path.join(root,'install'),workspace=path.join(root,'workspace'),home=path.join(root,'home');
for(const d of [install,workspace,home,path.join(root,'cli-home'),path.join(root,'security'),path.join(root,'cache')]) fs.mkdirSync(d);
const npmrc=path.join(root,'npmrc'),globalrc=path.join(root,'global-npmrc');fs.writeFileSync(npmrc,'registry=https://registry.npmjs.org/\naudit=false\nfund=false\n');fs.writeFileSync(globalrc,'');
const system=process.env.SystemRoot||'C:\\Windows';
const nodeHome=path.dirname(fs.realpathSync.native(process.execPath));
const environment={PATH:[nodeHome,path.join(system,'System32'),path.join(system,'System32/WindowsPowerShell/v1.0')].join(path.delimiter),SystemRoot:system,WINDIR:system,ComSpec:path.join(system,'System32/cmd.exe'),TEMP:root,TMP:root,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),CHAINLESSCHAIN_HOME:path.join(root,'cli-home'),CHAINLESSCHAIN_SECURITY_ANCHOR_HOME:path.join(root,'security'),CI:'1',NO_COLOR:'1',npm_config_userconfig:npmrc,npm_config_globalconfig:globalrc,npm_config_cache:path.join(root,'cache')};
const report={schema:'chainlesschain.public-cli-first-run-diagnostic/v1',startedAt:new Date().toISOString(),root,version,platform:process.platform,arch:process.arch,node:process.version,osRelease:os.release(),isolatedProfile:true,formalSample:false,publicInstallationAssessed:false,billingVerified:false,observationsCreated:false,stages:[],credentialForwardedToInstaller:false};
save('scope.json',report);
fs.copyFileSync(new URL(import.meta.url),path.join(archive,'operator-script.mjs'),fs.constants.COPYFILE_EXCL);
let active=null;
async function command(label,args,{credential=false,timeoutMs=120000,cwd=workspace}={}) {
  const start=Date.now(),out=path.join(root,label+'.stdout'),err=path.join(root,label+'.stderr');
  const stdout=fs.openSync(out,'wx'),stderr=fs.openSync(err,'wx');
  let child;
  try {child=spawn(process.execPath,args,{cwd,env:{...environment,...(credential?{VOLCENGINE_API_KEY:llm.apiKey}:{})},stdio:['ignore',stdout,stderr],detached:process.platform!=='win32',windowsHide:true,shell:false});}
  finally {fs.closeSync(stdout);fs.closeSync(stderr);}
  const handle={child,closed:false,logFile:err};active=handle;
  handle.done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{handle.closed=true;resolve({code,signal});});});handle.done.catch(()=>{});
  let exit,error=null;
  try {exit=await withinDeadline(handle.done,Date.now()+timeoutMs,label);}
  catch(e) {error=e.code||'COMMAND_FAILED';}
  let cleanup=null;
  try {await stopOwned(handle);cleanup=handle.cleanupEvidence||{confirmed:true,naturalExit:true};} catch(e) {cleanup=handle.cleanupEvidence||{confirmed:false,error:e.code||'CLEANUP_FAILED'};}
  active=null;
  const sanitize=bytes=>bytes.toString('utf8').replaceAll(llm.apiKey,'[REDACTED]');
  for(const [suffix,file] of [['stdout',out],['stderr',err]]) fs.writeFileSync(path.join(archive,label+'.'+suffix),sanitize(fs.readFileSync(file)),{flag:'wx'});
  const receipt={label,args,startedAt:new Date(start).toISOString(),finishedAt:new Date().toISOString(),elapsedMs:Date.now()-start,exit:exit||null,error,cleanup,credentialAvailable:credential,stdoutDigest:digest(fs.readFileSync(path.join(archive,label+'.stdout'))),stderrDigest:digest(fs.readFileSync(path.join(archive,label+'.stderr')))};
  save(label+'.json',receipt);
  if(error||exit?.code!==0||exit?.signal||cleanup?.confirmed!==true) throw Error(label+' failed');
  return {receipt,stdout:fs.readFileSync(out,'utf8')};
}
try {
  console.log('Public first-run: reading immutable npm version metadata');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let metadata;
  try {const response=await fetch(`https://registry.npmjs.org/chainlesschain/${version}`,{signal:controller.signal,redirect:'error'});if(!response.ok)throw Error('Registry HTTP '+response.status);metadata=await response.json();}finally{clearTimeout(timer);}
  if(metadata.name!=='chainlesschain'||metadata.version!==version)throw Error('Registry identity mismatch');
  save('registry-manifest.json',metadata);
  console.log('Public first-run: installing CLI and child packages into a new private prefix');
  const npmCli=path.join(nodeHome,'node_modules/npm/bin/npm-cli.js');
  const installed=await command('install',[npmCli,'install',`chainlesschain@${version}`,'--prefix',install,'--registry','https://registry.npmjs.org/','--no-audit','--no-fund','--loglevel','warn'],{timeoutMs:600000,cwd:install});
  const lockReport=verifyCliRegistryInstall(install,metadata);save('registry-install.json',lockReport);
  fs.copyFileSync(path.join(install,'package-lock.json'),path.join(archive,'package-lock.json'),fs.constants.COPYFILE_EXCL);
  const cli=path.join(install,'node_modules/chainlesschain/bin/chainlesschain.js');
  const identity=await command('identity',[cli,'--version']);
  if(!identity.stdout.includes(version)||!/^chainlesschain|^cc\b/m.test(identity.stdout))throw Error('Installed CLI version banner mismatch');
  report.publicInstallationAssessed=true;report.stages.push({stage:'install',passed:true,receipt:'install.json',identity:'identity.json',registry:'registry-install.json'});
  console.log('Public first-run: configuring isolated provider/model');
  for(const [key,value] of [['llm.provider','volcengine'],['llm.model',llm.model],['llm.baseUrl',llm.baseUrl]]) await command('configure-'+key.split('.')[1],[cli,'config','set',key,value]);
  report.stages.push({stage:'configure',passed:true});
  console.log('Public first-run: testing the configured Volcengine connection');
  await command('authenticate',[cli,'llm','test'],{credential:true,timeoutMs:90000});
  report.stages.push({stage:'authenticate',passed:true,cost:null});
  const expected='CHAINLESSCHAIN_PUBLIC_FIRST_RUN_V1\n';
  const prompt='Use write_file to create onboarding-proof.txt in the current workspace containing exactly CHAINLESSCHAIN_PUBLIC_FIRST_RUN_V1 followed by a newline. Then use read_file to verify it. Do not execute shell commands or access any other file. Reply DONE.';
  console.log('Public first-run: executing one bounded write/read task');
  const run=await command('tool',[cli,'agent','-p',prompt,'--output-format','stream-json','--permission-mode','auto','--allowed-tools','write_file,read_file','--max-turns','4','--max-budget-usd','0.10','--no-file-refs','--no-commands'],{credential:true,timeoutMs:180000});
  const rows=run.stdout.trim().split(/\r?\n/u).map(line=>JSON.parse(line));
  const init=rows.filter(r=>r.type==='system'&&r.subtype==='init'),terminal=rows.filter(r=>r.type==='result');
  if(init.length!==1||init[0].provider!=='volcengine'||init[0].model!==llm.model||terminal.length!==1||terminal[0].is_error===true)throw Error('Real CLI stream terminal identity mismatch');
  save('stream-summary.json',{initialization:init[0],terminal:terminal[0],eventCount:rows.length});
  report.stages.push({stage:'tool',passed:true,receipt:'tool.json',cost:terminal[0].total_cost_usd??null});
  const file=path.join(workspace,'onboarding-proof.txt'),stat=fs.lstatSync(file),bytes=fs.readFileSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||bytes.toString('utf8')!==expected)throw Error('Actual deliverable differs from the expected bytes');
  fs.writeFileSync(path.join(archive,'onboarding-proof.txt'),bytes,{flag:'wx'});
  report.stages.push({stage:'artifact',passed:true,path:'onboarding-proof.txt',digest:digest(bytes)});
  report.passed=true;
} catch(error) {
  report.passed=false;report.failure=error.message.replaceAll(llm.apiKey,'[REDACTED]');process.exitCode=1;
  if(active)try{await stopOwned(active);}catch{report.cleanupUnconfirmed=true;}
} finally {
  report.finishedAt=new Date().toISOString();
  for(const secret of [llm.apiKey]) if(JSON.stringify(report).includes(secret))throw Error('Unsafe receipt');
  save('diagnostic-result.json',report);
  console.log(JSON.stringify({passed:report.passed,completedStages:report.stages.map(s=>s.stage),failure:report.failure||null,formalSample:false,artifactDir:archive}));
}
