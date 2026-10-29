import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const directory=path.dirname(fileURLToPath(import.meta.url));
const workspace=path.resolve(directory,"../..");
const output=fs.mkdtempSync(path.join(directory,"diagnostics-"));
const script=path.join(workspace,"packages/cli/scripts/memory-file-identity-diagnostic.mjs");
const results=[];
for(const [name,node] of [["node2212","C:/Users/longfa/AppData/Local/nvm/v22.12.0/node.exe"],["node2222",process.execPath]]) {
 const run=spawnSync(node,[script,"--output",path.join(output,`${name}.json`)],{cwd:workspace,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:1024*1024});
 fs.writeFileSync(path.join(output,`${name}.log`),(run.stdout||"")+(run.stderr||""),{flag:"wx"});
 results.push({name,node,exitCode:run.status,signal:run.signal,error:run.error?.message??null});
}
fs.writeFileSync(path.join(output,"process.json"),JSON.stringify(results,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({output,results}));
if(results.some(result=>result.exitCode!==0))process.exitCode=1;
