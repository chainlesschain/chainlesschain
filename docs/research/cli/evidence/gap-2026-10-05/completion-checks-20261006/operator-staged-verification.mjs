import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root='docs/research/cli/evidence/gap-2026-10-05/completion-checks-20261006';
const hash=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const verification=JSON.parse(fs.readFileSync(root+'/verification.json','utf8'));
const files=new Map(verification.artifacts.map(x=>[x.path,x.digest]));
for(const source of verification.sourceDigests)files.set(source.path,source.digest);
for(const name of fs.readdirSync(root)){const file=root+'/'+name;files.set(file,hash(fs.readFileSync(file)));}
for(const [file,digest]of files){const git=spawnSync('git',['show',':'+file],{encoding:null,timeout:30000,maxBuffer:32*1024*1024,windowsHide:true});assert.equal(git.status,0,'Archive not staged: '+file);assert.equal(hash(git.stdout),digest,'Git changed archived bytes: '+file);}
console.log(JSON.stringify({stagedEvidenceBytesVerified:true,files:files.size}));
