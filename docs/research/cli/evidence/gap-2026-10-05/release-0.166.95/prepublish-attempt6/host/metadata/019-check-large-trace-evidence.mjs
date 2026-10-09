import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {captureHostDiagnostics} from '../../packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs';
import {collectIdeJourneyArtifacts} from '../../scripts/ide-journey-evidence.mjs';
const root=path.resolve('.work/astra-win2025-8e5');const fixture=fs.mkdtempSync(path.join(root,'large-trace-contract-'));
const sandbox=path.join(fixture,'sandbox'),capture=path.join(fixture,'capture'),archive=path.join(fixture,'archive');
fs.mkdirSync(path.join(sandbox,'IC-2024.2','log_runIdeForUiTests'),{recursive:true});fs.mkdirSync(capture);
const idea=Buffer.concat([Buffer.from([255,254]),Buffer.alloc(300000,65),Buffer.from('\r\n')]);
const trace=Buffer.from(Array.from({length:5000},(_,turn)=>JSON.stringify({schema:'chainlesschain.ui-event-diagnostic/v1',stage:'RECEIVED',type:'approval_request',id:'approval-'+turn,session:'session-1',turn})+'\r\n').join(''));
fs.writeFileSync(path.join(sandbox,'IC-2024.2','log_runIdeForUiTests','idea.log'),idea);fs.writeFileSync(path.join(capture,'host-events.jsonl'),trace);
const captured=captureHostDiagnostics(sandbox,capture);const collected=collectIdeJourneyArtifacts([capture],archive);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const verified=[{suffix:'.log.bin',original:idea},{suffix:'host-events.jsonl.bin',original:trace}].map(({suffix,original})=>{
const artifact=collected.records.find(r=>r.path.endsWith(suffix));const archived=fs.readFileSync(path.join(archive,artifact.path));
const metadata=captured.files.find(f=>f.path.endsWith(suffix));
return {suffix,bytes:original.length,archivedBytes:archived.length,sha256:digest(original),archivedSha256:digest(archived),artifact,metadata,pass:original.equals(archived)&&metadata.bytes===original.length&&metadata.sha256===digest(original)&&metadata.originalBytes===true&&!artifact.truncated&&!artifact.redacted};});
const report={scope:'Actual updated driver plus actual artifact collector, synthetic large valid NDJSON and non-UTF8 IDE log; no GUI or real event dispatch',fixture,complete:captured.complete,incidents:collected.incidents,verified,pass:captured.complete&&collected.incidents.length===0&&verified.every(x=>x.pass)};
fs.writeFileSync(path.join(root,'diagnostics-large-trace-contract.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,files:verified.map(({suffix,bytes,sha256})=>({suffix,bytes,sha256}))}));if(!report.pass)process.exitCode=1;
