const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const requireProject=createRequire('C:/code/chainlesschain/package.json');
const {_electron}=requireProject('@playwright/test');
const root='C:/code/chainlesschain';
(async()=>{
 const profile=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'dmm-product-smoke-'));
 fs.writeFileSync(path.join(profile,'initial-setup-config.json'),JSON.stringify({setupCompleted:true,completedAt:new Date().toISOString(),edition:'personal'}));
 fs.writeFileSync(path.join(profile,'app-config.json'),JSON.stringify({ui:{useWebShellExperimental:false}}));
 const wrapper=path.join(profile,'main.cjs');
 fs.writeFileSync(wrapper,`const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.disableHardwareAcceleration();app.on('browser-window-created',(_event,window)=>window.hide());require(${JSON.stringify(root+'/desktop-app-vue/dist/main/index.js')});`);
 const env={...process.env,NODE_ENV:'test',CHAINLESSCHAIN_WEB_SHELL:'0',CHAINLESSCHAIN_GRAPH_PROJECT_GOALS:'canonical',CHAINLESSCHAIN_ENABLE_DB_ENCRYPTION:'1',PROJECTS_ROOT_PATH:path.join(profile,'projects'),DEFAULT_USERNAME:'dmm-probe',DEFAULT_PASSWORD:'dmm-isolated-local-probe-20261107'};
 delete env.ELECTRON_RUN_AS_NODE;
 let app;
 const watchdog=setTimeout(()=>{console.error('Bounded full product smoke timed out');process.exitCode=1;app?.process().kill();},300000);
 try {
  app=await _electron.launch({executablePath:'C:/Users/longfa/AppData/Local/Temp/dmm-electron-39.8.10/electron.exe',args:[wrapper,'--no-web-shell',`--user-data-dir=${profile}`],cwd:root+'/desktop-app-vue',env,timeout:30000});
  const log=fs.createWriteStream(path.join(profile,'smoke.log'));
  app.process().stdout?.on('data',bytes=>log.write(bytes));
  app.process().stderr?.on('data',bytes=>log.write(bytes));
  const window=await app.firstWindow({timeout:180000});
  await window.waitForLoadState('domcontentloaded',{timeout:10000});
  console.log(JSON.stringify({profile,url:window.url(),title:await window.title(),versions:await app.evaluate(()=>process.versions)}));
  console.log((await window.locator('body').innerText({timeout:5000})).slice(0,1000));
  if(process.argv.includes('--goals')) {
    await window.locator('[data-testid="username-input"]').waitFor({state:'visible',timeout:20000});
    const did=await window.evaluate(async()=>{const identity=await window.electronAPI.did.createIdentity({name:'DMM isolated GUI identity'},{setAsDefault:true});return identity.did;});
    if(typeof did!=='string'||!did.startsWith('did:'))throw new Error('Real DID setup failed');
    await window.locator('[data-testid="username-input"]').fill(env.DEFAULT_USERNAME);
    await window.locator('[data-testid="password-input"]').fill(env.DEFAULT_PASSWORD);
    await window.locator('[data-testid="login-button"]').click();
    await window.locator('[data-testid="login-container"]').waitFor({state:'hidden',timeout:30000});
    const project=await window.evaluate(async userId=>window.electronAPI.project.createQuick({name:'DMM isolated GUI project',description:'Synthetic local GUI acceptance only',projectType:'document',enable_git:false,userId}),did);
    if(!project.id)throw new Error('Native project creation did not return an ID');
    await window.evaluate(id=>{location.hash='#/projects/'+id;},project.id);
    await window.locator('[data-testid="project-tasks-button"]').click({timeout:30000});
    const panel=window.locator('[data-testid="project-goal-panel"]');
    await panel.locator('[data-testid="goal-objective"]').fill('DMM actual renderer check');
    await panel.locator('form[data-testid="create-goal"] button[type="submit"]').click();
    const article=panel.locator('article').filter({hasText:'DMM actual renderer check'});
    await article.waitFor({state:'visible',timeout:30000});
    await article.locator('[data-testid="check-goal"]').click();
    await article.getByText(/已检查 1 次/).waitFor({state:'visible',timeout:30000});
    const id=await article.getAttribute('data-goal-id');
    const stored=await window.evaluate(async id=>window.electronAPI.project.readGoal({id}),id);
    if(stored.schema!=='chainlesschain.goal/v2')throw new Error('GUI check did not participate in Graph');
    await article.locator('[data-testid="stop-goal"]').click();
    await article.locator('[data-testid="resume-goal"]').waitFor({state:'visible',timeout:15000});
    console.log(JSON.stringify({basicGoalGui:true,projectId:project.id,goalId:id,realDid:true,realPasswordLogin:true,canonical:true,paused:true,fullActionJourney:false}));
  }
  await window.screenshot({path:path.join(profile,'window.png')});
  console.log('Isolated product capture: '+profile);
 } finally {clearTimeout(watchdog);if(app)await app.close().catch(()=>{});}
})().catch(error=>{console.error(error);process.exitCode=1});
