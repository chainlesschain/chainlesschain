import pathlib,json,hashlib,tarfile,re,collections,datetime,shutil
p=pathlib.Path(__file__).parent;s=pathlib.Path('.work/s100').resolve();r=s/'.work/20261013-docs-d898d4e04d03-023354'
read=lambda f:json.loads(f.read_text(encoding='utf-8-sig')); h=lambda b:hashlib.sha256(b).hexdigest()
pre=read(r/'predeploy.json');remote=read(r/'remote-deployment.json');pub=read(r/'public-deployment.json');sha='d898d4e04d036bc51909d24f24e58842af568ce6'
assert all(x['sourceCommit']==sha for x in [pre,remote,pub]) and pub['status']=='verified'
assert pre['artifacts']==remote['artifacts']==pub['artifacts'];assert h((r/'deploy.sh').read_bytes())==remote['remoteScriptSha256']
assert remote['preservedFiles']==[] and remote['preservedOperational']==[dict(site='www',path='.well-known',source='Existing server operational content; not a source-build artifact')]
stdout=(r/'remote-deployment.stdout').read_text(encoding='utf-8-sig');assert 'DEPLOYMENT_COMPLETE' in stdout and 'PRESERVED_OPERATIONAL www .well-known' in stdout and not re.search(r'^PRESERVED_FILE ',stdout,re.M)
inventories={};tarchecks=[]
for site,row in pre['artifacts'].items():
 data=(s/row['local']).read_bytes();assert len(data)==row['bytes'] and h(data)==row['sha256'];assert row['remote']+': OK' in stdout
 dist=pathlib.Path(pre['builds'][site]['dist']);mbytes=(dist/'deployment-source.json').read_bytes();assert h(mbytes)==row['sourceManifestSha256']
 m=json.loads(mbytes);assert m['sourceCommit']==sha and m['jetbrains']['state']=='PENDING_NOT_PUBLIC';inventories[site]={f['path']:f for f in m['files']}
 with tarfile.open(s/row['local'],'r:gz') as t:
  files=[x for x in t.getmembers() if x.isfile()];assert len(files)==row['files'];assert len([x for x in files if x.name.endswith('.html')])==row['htmlPages']
  member=next(x for x in files if x.name.lstrip('./')=='deployment-source.json');assert t.extractfile(member).read()==mbytes
 tarchecks.append(dict(site=site,sha256=row['sha256'],files=row['files'],html=row['htmlPages']))
checks=pub['checks'];assert len(checks)==56;counts=collections.Counter()
for row in checks:
 data=(r/pub['publicReadbackDirectory']/row['saved']).read_bytes();assert len(data)==row['bytes'] and h(data)==row['sha256'] and row['status']==200;counts[row['type']]+=1
 if row['type']=='server-runtime-asset':
  assert row['url']=='https://www.chainlesschain.com/u/script.js' and 'availability only' in row['source'];continue
 assert data==(pathlib.Path(pre['builds'][row['site']]['dist'])/row['local']).read_bytes()
 if row['type']!='manifest':
  inv=inventories[row['site']][row['local']];assert inv['sha256']==row['sha256'] and inv['bytes']==row['bytes']
 else:assert row['sha256']==pre['artifacts'][row['site']]['sourceManifestSha256']
assert counts==dict(html=17,asset=35,manifest=3,**{'server-runtime-asset':1}),counts
run=read(next(r.glob('gate-run-*.stdout')));jobs=read(next(r.glob('gate-jobs-*.stdout')))
assert run['id']==38336873726 and run['head_sha']==sha and run['event']=='workflow_dispatch' and run['status']=='completed' and run['conclusion']=='success'
gate=next(x for x in jobs['jobs'] if x['id']==115098840423);assert gate['conclusion']=='success'
lines=next(r.glob('gate-job-log-*.stdout')).read_text(encoding='utf-8-sig').splitlines();actual=[]
for i,l in enumerate(lines):
 if 'log -1 --format=%H' in l:actual.append(re.search(r'\b[a-f0-9]{40}\b',lines[i+1]).group())
assert actual==[sha]==pub['githubDocsBuildGate']['actualCheckouts']
first=list((r/'public-readback').glob('*.html'));assert len(first)==12
summary=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),status='OFFLINE_LIVE_DEPLOYMENT_EVIDENCE_VERIFIED',sourceCommit=sha,ciRun=38336873726,actualCheckout=actual,checks=dict(counts),cachedResponsesVerified=56,sourceBoundResponses=55,artifacts=tarchecks,remoteScriptSha256=remote['remoteScriptSha256'],preservedFiles=[],preservedOperational=['www/.well-known'],analytics='availability200 only; separate from static source',firstAttemptRetainedHtml=12,jetbrains='0.4.162 uploaded/PENDING_NOT_PUBLIC',formal='NOT_RUN 0/36 0/9',limitation='Offline retained HTTP/deployment evidence audit, no live query/SSH/browser test.')
(p/'summary.json').write_text(json.dumps(summary,indent=2))
for f in ['predeploy.json','remote-deployment.json','public-deployment.json','remote-deployment.stdout']:shutil.copyfile(r/f,p/f)
print(json.dumps(summary,indent=2))
