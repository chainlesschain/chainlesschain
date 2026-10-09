const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const mode=process.argv[2];
const test=mode==='template';
const command=test?process.execPath:(process.env.ComSpec||'cmd.exe');
const args=test?[path.join(root,'node_modules/vitest/vitest.mjs'),'run','tests/unit/tools/template-manager.test.js','--maxWorkers=1'] : ['/d','/s','/c','npm.cmd audit --json --ignore-scripts'];
const cwd=test?path.join(root,'desktop-app-vue'):root;
const start=new Date().toISOString();
const files=JSON.parse(fs.readFileSync(path.join(__dirname,'changes.json'))).changes.map(c=>c.file);
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
const before=hashes();
const result=spawnSync(command,args,{cwd,env:{...process.env,...(test?{NODE_OPTIONS:'--require='+path.join(__dirname,'preload.cjs')}:{})},windowsHide:true,timeout:180000,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(__dirname,mode+'.stdout.'+(test?'txt':'json')),result.stdout||'');fs.writeFileSync(path.join(__dirname,mode+'.stderr.txt'),result.stderr||'');
const after=hashes();
fs.writeFileSync(path.join(__dirname,mode+'.execution.json'),JSON.stringify({command,args,cwd,start,end:new Date().toISOString(),status:result.status,signal:result.signal,error:result.error?.message||null,before,after,sourceStable:JSON.stringify(before)===JSON.stringify(after),testInjection:test?'Exact SRI-verified 4.7.10 tarball via test-only CJS preload; repository node_modules untouched':null},null,2));
console.log(JSON.stringify({status:result.status,signal:result.signal,error:result.error?.message}));
if(test)console.log(String(result.stdout).slice(-3000),String(result.stderr).slice(-3000));
else {try{const a=JSON.parse(result.stdout);console.log(JSON.stringify({error:a.error,metadata:a.metadata,handlebars:a.vulnerabilities?.handlebars,criticals:Object.entries(a.vulnerabilities||{}).filter(([,v])=>v.severity==='critical').map(([k])=>k)},null,2))}catch(e){console.error(e.message)}}
