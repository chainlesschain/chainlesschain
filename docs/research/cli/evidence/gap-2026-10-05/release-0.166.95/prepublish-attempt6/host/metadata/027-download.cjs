const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const base=__dirname, sha='8e538362109dbe0bf455d4f72dcab865962e668c',id=11632252463;
function get(ep){return execFileSync('gh',['api',ep],{maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});}
const raw=get(`repos/chainlesschain/chainlesschain/actions/artifacts/${id}`),meta=JSON.parse(raw);
fs.writeFileSync(path.join(base,'artifact-metadata.json'),raw);
if(meta.workflow_run.head_sha!==sha||meta.workflow_run.id!==37958205583||meta.name!=='jetbrains-Windows-2025.2-host-evidence-1')throw Error('Artifact identity mismatch');
const zip=get(`repos/chainlesschain/chainlesschain/actions/artifacts/${id}/zip`);
fs.writeFileSync(path.join(base,'artifact.zip'),zip);
const digest='sha256:'+crypto.createHash('sha256').update(zip).digest('hex');
const report={sha,runId:37958205583,jobId:113925289634,artifactId:id,bytes:zip.length,metadataBytes:meta.size_in_bytes,digest,metadataDigest:meta.digest,verified:zip.length===meta.size_in_bytes&&digest===meta.digest};
fs.writeFileSync(path.join(base,'download-verification.json'),JSON.stringify(report,null,2));
console.log(report);if(!report.verified)throw Error('Artifact integrity mismatch');
