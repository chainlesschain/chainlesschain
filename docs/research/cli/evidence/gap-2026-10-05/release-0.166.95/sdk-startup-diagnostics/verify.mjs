import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import ts from '../../node_modules/typescript/lib/typescript.js';

const base=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(base,'run2');
fs.mkdirSync(output);
const repo=path.resolve(base,'../..');
const fixtureFile=path.join(repo,'packages/agent-sdk/__tests__/e2e-agent-session.test.ts');
const fixtureBytes=fs.readFileSync(fixtureFile);
const hash=b=>createHash('sha256').update(b).digest('hex');
const source=fixtureBytes.toString('utf8');
const parsed=ts.createSourceFile(fixtureFile,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const names=['waitForInit','withDiagnostics'];
const helpers=names.map(name=>{
 const matches=parsed.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert.equal(matches.length,1,name);
 return matches[0].getText(parsed);
}).join('\n\n');
const compilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022};
const helperTs=helpers+'\nexport { waitForInit, withDiagnostics };\n';
fs.writeFileSync(path.join(output,'fixture-helpers.ts'),helperTs,{flag:'wx'});
fs.writeFileSync(path.join(output,'fixture-helpers.mjs'),ts.transpileModule(helperTs,{compilerOptions}).outputText,{flag:'wx'});
const sdkSource=path.join(repo,'packages/agent-sdk/src');
const sdkOutput=path.join(output,'sdk');
const bindings=[];
function compile(directory){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const input=path.join(directory,entry.name);
  if(entry.isDirectory()){compile(input);continue;}
  if(!entry.name.endsWith('.ts'))continue;
  const bytes=fs.readFileSync(input),relative=path.relative(sdkSource,input);
  const dest=path.join(sdkOutput,relative.replace(/\.ts$/u,'.js'));
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,ts.transpileModule(bytes.toString('utf8'),{compilerOptions,fileName:input}).outputText,{flag:'wx'});
  bindings.push({path:path.relative(repo,input),bytes:bytes.length,sha256:hash(bytes)});
 }
}
compile(sdkSource);
fs.writeFileSync(path.join(sdkOutput,'package.json'),'{"type":"module"}\n',{flag:'wx'});
const {AgentSession}=await import(pathToFileURL(path.join(sdkOutput,'agent-session.js')));
const {waitForInit,withDiagnostics}=await import(pathToFileURL(path.join(output,'fixture-helpers.mjs')));
const childFile=path.join(output,'diagnostic-child.mjs');
fs.writeFileSync(childFile,`const phase=process.env.SDK_DIAGNOSTIC_PHASE;
process.stdin.once('data',()=>{process.exitCode=1;process.stdin.destroy();});
process.stdout.write(JSON.stringify({type:'diagnostic_fixture',phase,detail:phase+' event'})+'\\n');
process.stderr.write(phase+' diagnostic stderr\\n');
`,{flag:'wx'});
const rows=[];
const listenerCounts=session=>Object.fromEntries(['init','exit','error'].map(name=>[name,session.listeners.get(name)?.size||0]));
const assertClean=session=>assert.deepEqual(listenerCounts(session),{init:0,exit:0,error:0});
async function runFailure(phase,{spawnError=false,resume=false}={}){
 let child,closed,realError;
 let commandUsed,argsUsed;
 const stderr=[],events=[];
 const session=new AgentSession({
  cliPath:spawnError?path.join(output,'nonexistent-diagnostic-executable.exe'):childFile,
  ...(resume?{resume:'diagnostic-session'}:{sessionId:'diagnostic-session'}),
  env:{SDK_DIAGNOSTIC_PHASE:phase},
  spawn(command,args,options){
   // On Windows SDK wraps non-JS CLI paths with cmd.exe. Use the existing
   // spawn DI seam to request a genuinely missing OS executable for this case.
   commandUsed=spawnError?path.join(output,'missing-os-executable.exe'):command;argsUsed=args;
   child=spawn(commandUsed,args,options);
   closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
   child.once('error',error=>{realError=error;});
   return child;
  },
 });
 let sent=false;
 const release=()=>{if(!sent&&stderr.length&&events.length){sent=true;child.stdin.end('diagnostic-exit\n');}};
 session.on('stderr',chunk=>{stderr.push(chunk);release();});
 session.on('event',event=>{events.push(event);release();});
 let original;
 const pending=waitForInit(session).catch(error=>{original=error;throw error;});
 const observed=withDiagnostics(pending,phase+' init',stderr,events).then(()=>({unexpectedSuccess:true}),error=>({error}));
 assert.deepEqual(listenerCounts(session),{init:1,exit:1,error:1});
 session.start();
 const watchdog=setTimeout(()=>{child.kill();},10000);
 try{
  const {error,unexpectedSuccess}=await observed;
  assert.equal(unexpectedSuccess,undefined);assert.ok(error instanceof Error);assert.equal(error.cause,original);
  assert.match(error.message,new RegExp('cc phase: '+phase+' init'));
  assertClean(session);
  const close=await closed;
  if(spawnError){assert.equal(original,realError);assert.equal(original.code,'ENOENT');assert.match(error.message,/ENOENT/u);}
  else{
   assert.equal(close.code,1);assert.match(error.message,/agent exited \(code 1\) before init/u);
   assert.ok(error.message.includes(phase+' diagnostic stderr'));assert.ok(error.message.includes(phase+' event'));
   assert.equal(events.length,1);assert.equal(events[0].phase,phase);
   const other=phase==='first'?'resume':'first';assert.ok(!error.message.includes(other+' diagnostic stderr'));
   if(resume){assert.ok(argsUsed.includes('--resume'));assert.ok(argsUsed.includes('diagnostic-session'));}
  }
  rows.push({phase,spawnError,resume,commandUsed,argsUsed,close,stderr:stderr.join(''),events,message:error.message,cause:{sameObject:true,name:original.name,message:original.message,code:original.code},listenersAfter:listenerCounts(session)});
 }finally{clearTimeout(watchdog);if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;}
}
await runFailure('first');
await runFailure('resume',{resume:true});
await runFailure('spawn-error',{spawnError:true});
assert.equal(hash(fs.readFileSync(fixtureFile)),hash(fixtureBytes));
for(const b of bindings)assert.equal(hash(fs.readFileSync(path.join(repo,b.path))),b.sha256);
const report={schema:'chainlesschain.sdk-startup-diagnostic-contract/v1',verified:true,originalCiFailureReproduced:false,usesRealDiagnosticNodeChildren:true,usesActualFixtureHelpers:true,productionSdkChanged:false,timeLimitsChanged:false,node:process.version,platform:process.platform,typescript:ts.version,fixture:{path:path.relative(repo,fixtureFile),bytes:fixtureBytes.length,sha256:hash(fixtureBytes)},helperNames:names,helperSourceSha256:hash(helperTs),sdkSources:bindings,checks:rows};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verified:report.verified,originalCiFailureReproduced:false,scenarios:rows.length,fixtureSha256:report.fixture.sha256,output:path.join(output,'report.json')}));
