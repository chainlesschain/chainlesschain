const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'extracted/ide-journey/Windows-2025.2');
const raw=fs.readFileSync(path.join(root,'journey-evidence.json')),m=JSON.parse(raw);
const digest=b=>'sha256:'+crypto.createHash('sha256').update(b).digest('hex');
function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;}
const canon=v=>JSON.stringify(stable(v));
const entries=m.artifacts.map(a=>{const p=path.resolve(root,a.path);if(!p.startsWith(root+path.sep))throw Error('Path escape');const b=fs.readFileSync(p);return {path:a.path,expectedBytes:a.bytes,bytes:b.length,expectedDigest:a.sha256,digest:digest(b),pass:b.length===a.bytes&&digest(b)===a.sha256};});
const bundle=digest(canon(m.artifacts.filter(a=>a.path).map(({kind,name=null,path,sha256,bytes})=>({kind,name,path,sha256,bytes})).sort((a,b)=>a.path.localeCompare(b.path))));
const core={...m};delete core.evidenceDigest;
const report={manifestSchema:m.schema,schemaVersion:m.schemaVersion,manifestVersion:m.manifestVersion,releaseCommit:m.releaseCommit,host:m.host,result:m.result,evidenceComplete:m.evidenceComplete,manifestBytes:raw.length,manifestDigest:digest(raw),entries,artifactBundleDigest:{actual:bundle,expected:m.artifactBundleDigest,pass:bundle===m.artifactBundleDigest},evidenceDigest:{actual:digest(canon(core)),expected:m.evidenceDigest,pass:digest(canon(core))===m.evidenceDigest}};
const extractionRoot=path.join(__dirname,'extracted');
function inventory(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);if(e.isDirectory())return inventory(p);const b=fs.readFileSync(p);return [{path:path.relative(extractionRoot,p).replaceAll('\\','/'),bytes:b.length,digest:digest(b)}];});}
report.fullExtractionInventory=inventory(extractionRoot);
report.fullExtractionFiles=report.fullExtractionInventory.length;
report.fullExtractionBytes=report.fullExtractionInventory.reduce((n,e)=>n+e.bytes,0);
fs.writeFileSync(path.join(__dirname,'manifest-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,fullExtractionInventory:undefined,entries:entries.length,entryPass:entries.every(e=>e.pass)},null,2));
