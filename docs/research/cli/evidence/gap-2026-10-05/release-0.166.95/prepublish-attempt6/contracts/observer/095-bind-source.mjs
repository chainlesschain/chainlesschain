import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const root=path.resolve('.work/astra-ui-failure-script-20261010'),run=path.join(root,'corrected'),binding=path.join(run,'source-binding');fs.mkdirSync(binding,{recursive:true});
const runtime=fs.readFileSync('.work/astra-popup-dispatch-contract-20261009/runtime-classpath.txt','utf8').trim();const bin=path.resolve('.work/jdk21-release-validation/jdk-21.0.12.1+1/bin');
fs.copyFileSync(path.join(run,'UiFailureDiagnostics.source.java'),path.join(binding,'UiFailureDiagnostics.java'));
function command(name,args,label){const r=spawnSync(path.join(bin,name+'.exe'),args,{windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});fs.writeFileSync(path.join(binding,label+'.stdout.log'),r.stdout||'');fs.writeFileSync(path.join(binding,label+'.stderr.log'),r.stderr||'');if(r.status!==0)throw Error(label+' failed '+r.status+' '+r.stderr);}
command('javac',['-cp',runtime,'-d',binding,path.join(binding,'UiFailureDiagnostics.java'),path.join(root,'src/ExportSnapshot.java')],'compile-source');
command('java',['-cp',[binding,runtime].join(path.delimiter),'ExportSnapshot',path.join(binding,'source-generated-script.js')],'export-source');
const expected=fs.readFileSync(path.join(run,'actual-script.js')),actual=fs.readFileSync(path.join(binding,'source-generated-script.js'));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={scope:'Independent javac of preserved source; equality of returned generated JS versus actual Gradle class. This does not launch IDE or validate live owner reflection.',match:actual.equals(expected),actualGradleScriptSha256:digest(expected),sourceGeneratedScriptSha256:digest(actual)};
fs.writeFileSync(path.join(run,'source-binding.json'),JSON.stringify(report,null,2));
const before=path.join(root,'before-root-recompile/metadata.json');const previous=JSON.parse(fs.readFileSync(before));previous.sourceClassBinding='Not matched: source snapshot already contains root correction, while preserved old class still exhibits truncation bug. Actual old script was exported from that preserved class.';fs.writeFileSync(before,JSON.stringify(previous,null,2));
for(const name of ['ConversationView','ApprovalSettlementRegistry','ConversationManager$Conversation']){
 const classFile=path.resolve('packages/jetbrains-plugin/build/classes/java/main/com/chainlesschain/ide',name==='ConversationView'?'intellij/ConversationView.class':name+'.class');
 command('javap',['-private',classFile],name.replaceAll('$','-')+'-actual-fields');
}
console.log(JSON.stringify(report));if(!report.match)process.exitCode=1;
