import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const base='.work/windows-private-v4-final-matrix-';
const input=JSON.parse(fs.readFileSync(`${base}input.json`,'utf8'));
const capture=p=>{const b=fs.readFileSync(p);return {path:path.resolve(p),bytes:b.length,digest:`sha256:${crypto.createHash('sha256').update(b).digest('hex')}`};};
const snapshots=r=>[...r.sources,r.driver,r.validatorSource,r.dependencyValidatorSource].map(x=>({name:path.basename(x.path),bytes:x.bytes,digest:x.digest})).sort((a,b)=>a.name.localeCompare(b.name));
const baseline=JSON.parse(fs.readFileSync(input.baseline,'utf8'));
input.producerSnapshots=snapshots(baseline);
input.baselineReport=capture(input.baseline);
input.fullBaselineReport=capture(input.fullBaseline);
for(const rows of [input.completedFinalMutants,input.survivedFinalMutants,input.failedAttempts]) for(const row of rows){
 const file=`${row.output}/report.json`, report=JSON.parse(fs.readFileSync(file,'utf8'));
 const host=JSON.parse(report.execution.stdout);
 row.report=capture(file);row.reviewValidation=report.reviewValidation;
 row.producer12SnapshotsMatchBaseline=JSON.stringify(snapshots(report))===JSON.stringify(input.producerSnapshots);
 row.host={completed:host.completed,stage:host.stage,error:host.error,rootExit:host.rootExit,cleanupConfirmed:host.cleanupConfirmed,jobActiveProcesses:host.jobActiveProcesses,profileDeleted:host.profileDeleted,guardNodeCount:host.guardNodeCount,guardNodeLimit:host.guardNodeLimit};
 const journal=fs.readFileSync(`${row.output}/journal.jsonl`,'utf8').trim().split(/\r?\n/).map(JSON.parse);
 row.moduleErrors=journal.find(e=>e.phase==='module-errors')?.modules?.flatMap(m=>m.errors)||null;
 row.failedAssertions=journal.find(e=>e.phase==='test-results')?.failures?.map(f=>({name:f.name,errors:f.errors.map(e=>({name:e.name,message:e.message}))}))||[];
}
input.allProducer12SnapshotsMatchBaseline=[...input.completedFinalMutants,...input.survivedFinalMutants,...input.failedAttempts].every(r=>r.producer12SnapshotsMatchBaseline);
fs.writeFileSync(`${base}index.json`,JSON.stringify(input,null,2)+'\n');
console.log(JSON.stringify({output:`${base}index.json`,counts:input.counts,sourceCount:input.producerSnapshots.length,allProducer12SnapshotsMatchBaseline:input.allProducer12SnapshotsMatchBaseline}));
