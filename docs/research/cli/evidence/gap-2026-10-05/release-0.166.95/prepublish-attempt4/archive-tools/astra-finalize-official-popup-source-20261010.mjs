import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve('.work/astra-popup-official-source-20261010');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const commit='15645ead6f20019cc2537dbbd43df4eb344423a8';
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'tag-ref.json'))).object.sha,commit);
const captures=[];
for(const name of ['PopupChooserBuilder.java','AbstractPopup.java','PopupFactoryImpl.java','PopupListAdapter.java']){
 const bytes=fs.readFileSync(path.join(root,name));
 const metadata=JSON.parse(fs.readFileSync(path.join(root,name+'.metadata.json')));
 assert.ok(bytes.equals(Buffer.from(metadata.content.replaceAll('\n',''),'base64')));
 captures.push({path:name,repositoryPath:metadata.path,commit,gitBlobSha:metadata.sha,bytes:bytes.length,sha256:sha(bytes),rawMatchesContentsApiBase64:true,url:'https://github.com/JetBrains/intellij-community/blob/'+commit+'/'+metadata.path});
}
const vendor=fs.readFileSync(path.join(root,'vendor-releases.original.json'));
const releases=JSON.parse(vendor).IIU.filter(r=>r.version==='2026.2.0.1');
assert.equal(releases.length,1);assert.equal(releases[0].build,'262.8665.337');
fs.writeFileSync(path.join(root,'vendor-selected-release.json'),JSON.stringify(releases[0],null,2)+'\n',{flag:'wx'});
const provenance={capturedAt:new Date().toISOString(),version:'2026.2.0.1',build:'262.8665.337',tag:'idea/262.8665.337',commit,captures,vendor:{url:'https://data.services.jetbrains.com/products/releases?code=IIU&version=2026.2.0.1&type=release',selection:'IIU entries where version exactly equals 2026.2.0.1',sourcePayloadBytes:vendor.length,sourcePayloadSha256:sha(vendor),selectedEntry:'vendor-selected-release.json',fullPayloadRetainedAt:'.work/astra-popup-official-source-20261010/vendor-releases.original.json',fullPayloadIncludedInCommittedArchive:false},captureNote:'Official source files preserved as raw gh API bytes and checked against contents API base64. Vendor curl inside sandbox initially failed with SEC_E_NO_CREDENTIALS; approved host curl succeeded.'};
fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({version:provenance.version,build:provenance.build,commit,rawSourcesVerified:captures.length}));
