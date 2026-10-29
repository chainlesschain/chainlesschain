import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {syncBuiltinESMExports} from "node:module";
const directory=path.dirname(fileURLToPath(import.meta.url));
const workspace=path.resolve(directory,"../..");
const artifacts=fs.mkdtempSync(path.join(directory,"run-"));
process.env.NODE_ENV="test";
process.env.TEMP=path.join(artifacts,"temp");
process.env.TMP=process.env.TEMP;
fs.mkdirSync(process.env.TEMP);
process.env.CHAINLESSCHAIN_HOME=path.join(artifacts,"home");
process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME=path.join(artifacts,"security-anchor");
process.env.CC_BACKGROUND_AGENTS_DIR=path.join(artifacts,"background-agents");
process.env.GIT_CONFIG_NOSYSTEM="1";
process.env.GIT_CONFIG_GLOBAL=path.join(artifacts,"empty-git-config");
process.env.GIT_TERMINAL_PROMPT="0";
process.env.CLAUDE_CODE_DISABLE_BG_SHELL_PRESSURE_REAP="1";
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL,"");
// The real config guard forbids a home nested inside the active Git worktree.
// A separate synthetic bootstrap repo makes the probe home a sibling, while
// retaining every created file under the authorized .work artifact directory.
const bootstrap=path.join(artifacts,"bootstrap-repo");
fs.mkdirSync(bootstrap);
execFileSync("git",["init","-b","main"],{cwd:bootstrap,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]});
process.chdir(bootstrap);
globalThis.fetch=async()=>{throw new Error("Probe forbids network/model egress");};
const removalAttempts=[];
const nativeRm=fs.rmSync;
fs.rmSync=function(target,options){
 const event={path:String(target),options,at:new Date().toISOString()};
 if(path.resolve(String(target)).startsWith(artifacts+path.sep))removalAttempts.push(event);
 try{const result=nativeRm.call(this,target,options);event.ok=true;return result;}
 catch(error){event.ok=false;event.error={code:error.code,message:error.message};throw error;}
};
syncBuiltinESMExports();
const sources=["packages/cli/src/lib/sub-agent-context.js","packages/cli/src/harness/worktree-isolator.js","packages/cli/src/runtime/agent-core.js","packages/cli/src/lib/agent-worktree.js","packages/cli/src/harness/background-task-manager.js","packages/cli/src/lib/background-agent-supervisor.js"];
const hashes=()=>Object.fromEntries(sources.map(name=>[name,createHash("sha256").update(fs.readFileSync(path.join(workspace,name))).digest("hex")]));
const before=hashes();
const head=execFileSync("git",["rev-parse","HEAD"],{cwd:workspace,encoding:"utf8",windowsHide:true}).trim();
const mainWorktreesBefore=execFileSync("git",["worktree","list","--porcelain"],{cwd:workspace,encoding:"utf8",windowsHide:true});
const {SubAgentContext}=await import("../../packages/cli/src/lib/sub-agent-context.js");
const {executeTool,listBackgroundShellTasks,killAllBackgroundShellTasksSync}=await import("../../packages/cli/src/runtime/agent-core.js");
const approvalGate={decide:async()=>({decision:"allow",via:"isolated-probe-policy",policy:"autopilot"})};
const q=value=>{assert.ok(!/["\r\n%&|<>^!]/.test(value));return `"${value}"`;};
const git=(repo,args)=>execFileSync("git",args,{cwd:repo,encoding:"utf8",windowsHide:true,stdio:["ignore","pipe","pipe"]}).trim();
function waitFile(file){
 if(fs.existsSync(file)) return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const watcher=fs.watch(path.dirname(file),()=>{if(fs.existsSync(file)){watcher.close();clearTimeout(timer);resolve();}});
  const timer=setTimeout(()=>{watcher.close();reject(new Error(`Timed out waiting for ${file}`));},15000);
  if(fs.existsSync(file)){watcher.close();clearTimeout(timer);resolve();}
 });
}
const results=[];
let failure;
console.log(`artifacts=${artifacts}`);
try {
 for(const mode of ["hold-cwd","release-cwd","external-cwd"]){
  const caseDir=path.join(artifacts,mode);fs.mkdirSync(caseDir);
  const repo=path.join(caseDir,"synthetic-repo");fs.mkdirSync(repo);
  assert.ok(path.resolve(repo).startsWith(artifacts+path.sep));
  git(repo,["init","-b","main"]);
  assert.equal(path.resolve(repo,git(repo,["rev-parse","--git-common-dir"])),path.join(repo,".git"),"Only the synthetic fixture may own this worktree registry");
  git(repo,["config","user.name","Worktree Lifetime Probe"]);
  git(repo,["config","user.email","probe@example.invalid"]);
  fs.writeFileSync(path.join(repo,"README.md"),"synthetic fixture, still required by background consumer\n");
  git(repo,["add","README.md"]);git(repo,["-c","commit.gpgsign=false","commit","--no-verify","-m","synthetic fixture"]);
  const context=SubAgentContext.create({role:"lifetime-probe",task:"no-model fixture",cwd:repo,useWorktree:true,memoryEnabled:false});
  let launch,ready;
  context._runCore=async function(){
    const command=`${q(process.execPath)} ${q(path.join(directory,"consumer.mjs"))} ${q(caseDir)} ${mode} ${q(this.cwd)}`;
    launch=await executeTool("run_shell",{command,run_in_background:true,...(mode==="external-cwd"?{cwd:caseDir}:{})},{cwd:this.cwd,approvalGate,additionalDirectories:[caseDir]});
    assert.equal(launch.background,true,JSON.stringify(launch));
    assert.equal(launch.status,"running",JSON.stringify({launch,tasks:listBackgroundShellTasks()}));
    await waitFile(path.join(caseDir,"ready.json"));
    ready=JSON.parse(fs.readFileSync(path.join(caseDir,"ready.json"),"utf8"));
    assert.equal(ready.worktree,this.cwd);
    this.status="completed";
    this.completedAt=new Date().toISOString();
    return this.result={summary:"Sub-agent foreground work completed; background consumer remains pending",artifacts:[],toolsUsed:["run_shell"],iterationCount:0,tokenCount:0};
  };
  const completion=await context.run("No model is called: injected foreground fixture");
  if(!ready) {
    const taskOutput=launch?.task_id?await executeTool("check_shell",{task_id:launch.task_id},{cwd:repo,approvalGate}):null;
    throw new Error(JSON.stringify({reason:"foreground fixture failed before READY",completion,launch,taskOutput,registry:listBackgroundShellTasks()}));
  }
  let alive;try{process.kill(ready.pid,0);alive=true;}catch{alive=false;}
  const atCompletion={subAgentStatus:context.status,backgroundConsumerAlive:alive,registry:listBackgroundShellTasks().find(t=>t.id===launch.task_id),worktreeExists:fs.existsSync(ready.worktree),requiredFileExists:fs.existsSync(path.join(ready.worktree,"README.md")),worktreeRegistry:git(repo,["worktree","list","--porcelain"]),completion};
  fs.writeFileSync(path.join(caseDir,"release.json"),"{}",{flag:"wx"});
  await waitFile(path.join(caseDir,"result.json"));
  const afterRelease=JSON.parse(fs.readFileSync(path.join(caseDir,"result.json"),"utf8"));
  const deadline=Date.now()+5000;
  while(listBackgroundShellTasks().find(t=>t.id===launch.task_id)?.status==="running" && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
  const terminal=listBackgroundShellTasks().find(t=>t.id===launch.task_id);
  assert.notEqual(terminal?.status,"running","Probe consumer did not settle");
  results.push({mode,ready,launch,atCompletion,afterRelease,terminal});
  console.log(JSON.stringify({mode,alive,subAgentStatus:context.status,worktreeExists:atCompletion.worktreeExists,requiredFileExists:atCompletion.requiredFileExists,consumerRead:afterRelease.result,terminal:terminal.status}));
 }
}catch(error){failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{killAllBackgroundShellTasksSync();fs.rmSync=nativeRm;syncBuiltinESMExports();}
const after=hashes();
const mainWorktreesAfter=execFileSync("git",["worktree","list","--porcelain"],{cwd:workspace,encoding:"utf8",windowsHide:true});
const worktreePaths=text=>text.split(/\r?\n/).filter(line=>line.startsWith("worktree ")).sort();
const mainWorktreePathsUnchanged=JSON.stringify(worktreePaths(mainWorktreesBefore))===JSON.stringify(worktreePaths(mainWorktreesAfter));
const auditDirectory=path.join(process.env.TEMP,"chainlesschain-process-audit-tests");
const auditFiles=fs.existsSync(auditDirectory)?fs.readdirSync(auditDirectory).map(name=>({path:path.join(auditDirectory,name),bytes:fs.statSync(path.join(auditDirectory,name)).size})):[];
const receipt={head,node:process.version,platform:process.platform,scope:"Actual SubAgentContext.run/_runInWorktree/isolateTask and executeTool(run_shell) over synthetic Git repos; _runCore replaced with no-model deterministic fixture; real child process gated by external file handshake; passive rmSync outcome observation; no user worktree touched",before,after,sourcesStable:JSON.stringify(before)===JSON.stringify(after),mainWorktreesBefore,mainWorktreesAfter,mainWorktreesUnchanged:mainWorktreesBefore===mainWorktreesAfter,mainWorktreePathsUnchanged,auditFiles,removalAttempts,results,failure};
fs.writeFileSync(path.join(artifacts,"receipt.json"),JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});
if(!receipt.sourcesStable || !receipt.mainWorktreePathsUnchanged)process.exitCode=1;
console.log(JSON.stringify({receipt:path.join(artifacts,"receipt.json"),sourcesStable:receipt.sourcesStable,mainWorktreesUnchanged:receipt.mainWorktreesUnchanged,failure}));
