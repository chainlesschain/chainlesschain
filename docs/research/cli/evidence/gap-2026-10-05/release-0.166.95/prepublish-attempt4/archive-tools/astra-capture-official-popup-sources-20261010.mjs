import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=path.resolve('.work/astra-popup-official-source-20261010');
fs.mkdirSync(root);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const commit='15645ead6f20019cc2537dbbd43df4eb344423a8';
const prefix='repos/JetBrains/intellij-community/';
const api=(endpoint,raw=false)=>execFileSync('gh',['api',prefix+endpoint,...(raw?['-H','Accept: application/vnd.github.raw+json']:[])],{windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
const tag=api('git/ref/tags/idea/262.8665.337');
fs.writeFileSync(path.join(root,'tag-ref.json'),tag,{flag:'wx'});
if(JSON.parse(tag).object.sha!==commit)throw new Error('Tag changed');
const files=[
 ['PopupChooserBuilder.java','platform/platform-api/src/com/intellij/openapi/ui/popup/PopupChooserBuilder.java'],
 ['AbstractPopup.java','platform/platform-impl/src/com/intellij/ui/popup/AbstractPopup.java'],
 ['PopupFactoryImpl.java','platform/platform-impl/src/com/intellij/ui/popup/PopupFactoryImpl.java'],
 ['PopupListAdapter.java','platform/platform-impl/src/com/intellij/ui/popup/PopupListAdapter.java']
];
const captures=[];
for(const [name,repoPath] of files){
 const endpoint='contents/'+repoPath+'?ref='+commit;
 const metadata=api(endpoint);
 const raw=api(endpoint,true);
 const parsed=JSON.parse(metadata);
 if(!Buffer.from(parsed.content.replaceAll('\n',''),'base64').equals(raw))throw new Error('Raw/metadata mismatch '+name);
 fs.writeFileSync(path.join(root,name),raw,{flag:'wx'});
 fs.writeFileSync(path.join(root,name+'.metadata.json'),metadata,{flag:'wx'});
 captures.push({path:name,repositoryPath:repoPath,commit,gitBlobSha:parsed.sha,bytes:raw.length,sha256:sha(raw),rawMatchesContentsApiBase64:true,url:'https://github.com/JetBrains/intellij-community/blob/'+commit+'/'+repoPath});
}
const vendorUrl='https://data.services.jetbrains.com/products/releases?code=IIU&version=2026.2.0.1&type=release';
const vendorBytes=execFileSync('curl.exe',['-fsSL',vendorUrl],{windowsHide:true,timeout:60000,maxBuffer:16*1024*1024});
const releases=JSON.parse(vendorBytes).IIU.filter(row=>row.version==='2026.2.0.1');
if(releases.length!==1||releases[0].build!=='262.8665.337')throw new Error('Vendor release mismatch');
fs.writeFileSync(path.join(root,'vendor-selected-release.json'),JSON.stringify(releases[0],null,2)+'\n',{flag:'wx'});
const report={capturedAt:new Date().toISOString(),version:'2026.2.0.1',build:'262.8665.337',tag:'idea/262.8665.337',commit,captures,vendor:{url:vendorUrl,selection:'IIU entries where version exactly equals 2026.2.0.1',sourcePayloadBytes:vendorBytes.length,sourcePayloadSha256:sha(vendorBytes),selectedEntry:'vendor-selected-release.json',fullPayloadArchived:false}};
fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({root,version:report.version,build:report.build,commit,files:captures.length}));
