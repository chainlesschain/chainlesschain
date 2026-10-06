import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadConfig} from '../packages/cli/src/lib/config-manager.js';
import {applyConfigLlmDefaults} from '../packages/cli/src/lib/llm-config-defaults.js';
import {verifyCliRegistryInstall} from '../packages/cli/scripts/verify-cli-registry-install.mjs';
import {stopOwned,withinDeadline} from '../scripts/lib/verify01-diagnostic-process.mjs';
const prior='docs/research/cli/evidence/gap-2026-10-05/public-cli-first-run-windows-v3';
const archive=path.resolve('docs/research/cli/evidence/gap-2026-10-05/public-cli-tool-resume-windows');
const read=name=>JSON.parse(fs.readFileSync(path.join(prior,name),'utf8'));
const initial=read('diagnostic-result.json'),root=initial.root;
if(path.dirname(fs.realpathSync.native(root))!==fs.realpathSync.native(os.tmpdir())||!/^cc-public-first-run-/.test(path.basename(root)))throw Error('Unexpected private prefix');
if(initial.stages.map(s=>s.stage).join(',')!=='install,configure,authenticate'||initial.passed!==false)throw Error('Unexpected initial attempt');
fs.mkdirSync(archive);
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const save=(file,obj)=>fs.writeFileSync(path.join(archive,file),JSON.stringify(obj,null,2)+'\n',{flag:'wx'});
const install=path.join(root,'install'),workspace=path.join(root,'workspace');
const identity=verifyCliRegistryInstall(install,read('registry-manifest.json'));
save('registry-readback.json',identity);
if(fs.readdirSync(workspace).length!==0)throw Error('Original task workspace is no longer empty');
const config=loadConfig(),llm={provider:'volcengine'};applyConfigLlmDefaults(llm,config.llm||{});llm.apiKey||=process.env.VOLCENGINE_API_KEY;
if(!llm.apiKey||llm.model!=='deepseek-v4-flash-ga-260731')throw Error('Volcengine target unavailable');
const system=process.env.SystemRoot||'C:\\Windows',home=path.join(root,'home'),nodeHome=path.dirname(fs.realpathSync.native(process.execPath));
const env={PATH:[nodeHome,path.join(system,'System32'),path.join(system,'System32/WindowsPowerShell/v1.0')].join(path.delimiter),SystemRoot:system,WINDIR:system,TEMP:root,TMP:root,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'AppData/Roaming'),LOCALAPPDATA:path.join(home,'AppData/Local'),CHAINLESSCHAIN_HOME:path.join(root,'cli-home'),CHAINLESSCHAIN_SECURITY_ANCHOR_HOME:path.join(root,'security'),VOLCENGINE_API_KEY:llm.apiKey,CI:'1',NO_COLOR:'1'};
const cli=path.join(install,'node_modules/chainlesschain/bin/chainlesschain.js');
const prompt='Use write_file to create onboarding-proof.txt in the current workspace containing exactly CHAINLESSCHAIN_PUBLIC_FIRST_RUN_V1 followed by a newline. Then use read_file to verify it. Do not execute shell commands or access any other file. Reply DONE.';
const args=[cli,'agent','-p',prompt,'--output-format','stream-json','--permission-mode','auto','--allowed-tools','write_file,read_file','--max-turns','4','--max-budget-usd','0.10','--no-file-refs','--no-slash-macros'];
const report={schema:'chainlesschain.public-cli-first-run-continuation/v1',startedAt:new Date().toISOString(),priorInitialAttempt:prior,priorDigest:hash(fs.readFileSync(path.join(prior,'diagnostic-result.json'))),root,version:identity.version,platform:process.platform,node:process.version,args,manualRepairs:1,retriedAfterRejectedInvocation:true,formalSample:false,observationsCreated:false,billingVerified:false,ownerExitConfirmed:false,processTreeAssessed:false};
fs.copyFileSync(new URL(import.meta.url),path.join(archive,'operator-script.mjs'),fs.constants.COPYFILE_EXCL);
const stdoutFile=path.join(root,'tool-resume.stdout'),stderrFile=path.join(root,'tool-resume.stderr');
const out=fs.openSync(stdoutFile,'wx'),err=fs.openSync(stderrFile,'wx');let child;
try{child=spawn(process.execPath,args,{cwd:workspace,env,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
const handle={child,closed:false,logFile:stderrFile};handle.done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{handle.closed=true;resolve({code,signal});});});handle.done.catch(()=>{});
try {
  report.exit=await withinDeadline(handle.done,Date.now()+180000,'installed public CLI tool');
  report.ownerExitConfirmed=handle.closed;
  if(report.exit.code!==0||report.exit.signal)throw Error('Actual CLI task exited unsuccessfully');
  const lines=fs.readFileSync(stdoutFile,'utf8').trim().split(/\r?\n/u).map(line=>JSON.parse(line));
  const init=lines.filter(r=>r.type==='system'&&r.subtype==='init'),terminal=lines.filter(r=>r.type==='result');
  if(init.length!==1||init[0].provider!=='volcengine'||init[0].model!==llm.model||terminal.length!==1||terminal[0].is_error===true)throw Error('Stream initialization or terminal mismatch');
  report.initialization=init[0];report.terminal=terminal[0];report.eventCount=lines.length;
  const file=path.join(workspace,'onboarding-proof.txt'),stat=fs.lstatSync(file),bytes=fs.readFileSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||bytes.toString('utf8')!=='CHAINLESSCHAIN_PUBLIC_FIRST_RUN_V1\n')throw Error('Actual deliverable mismatch');
  fs.writeFileSync(path.join(archive,'onboarding-proof.txt'),bytes,{flag:'wx'});report.artifact={path:'onboarding-proof.txt',digest:hash(bytes)};report.passed=true;
}catch(e){report.passed=false;report.failure=e.message.replaceAll(llm.apiKey,'[REDACTED]');process.exitCode=1;}
finally {
  try{await stopOwned(handle);if(handle.cleanupEvidence)report.cleanup=handle.cleanupEvidence;}catch(e){report.cleanupUnconfirmed=true;report.cleanupFailure=e.code||'CLEANUP_FAILED';report.passed=false;process.exitCode=1;}
  for(const [name,file]of[['tool.stdout',stdoutFile],['tool.stderr',stderrFile]])fs.writeFileSync(path.join(archive,name),fs.readFileSync(file,'utf8').replaceAll(llm.apiKey,'[REDACTED]'),{flag:'wx'});
  report.finishedAt=new Date().toISOString();save('diagnostic-result.json',report);
  console.log(JSON.stringify({passed:report.passed,failure:report.failure||null,ownerExitConfirmed:report.ownerExitConfirmed,formalSample:false,artifactDir:archive}));
}
