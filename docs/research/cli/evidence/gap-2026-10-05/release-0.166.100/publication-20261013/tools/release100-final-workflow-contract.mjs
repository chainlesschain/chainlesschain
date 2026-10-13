import assert from 'node:assert/strict';
import {jetbrainsRequiredJobs,jetbrainsConditionalSkips,postVerificationJob} from './readback-ide-workflow100-final.mjs';
import {configuredSourceBranch} from './release100-source-config.mjs';

const oses=['ubuntu-latest','windows-latest','macos-latest'];
const cliJobs=[...oses.map(os=>`PDH native release tests (${os})`),
  ...['x64','arm64'].map(arch=>`linux-subreaper / Linux packaged subreaper (${arch})`),
  ...['ubuntu','windows','macos'].flatMap(os=>['unit','integration','e2e'].flatMap(suite=>{
    const count=suite==='unit'?(os==='windows'?16:4):suite==='integration'?8:4;
    return Array.from({length:count},(_,index)=>`test-${os} / ${suite} (${os}-latest, shard ${index+1}/${count})`);
  })),...oses.map(os=>`verify-cli (${os})`),
  'Test-only PM exploration recovery three-OS aggregate','pack-linux-dryrun','dry-run-publish'];
export const preflightPolicies=[
  {name:'CLI CI',workflow:'cli-ci.yml',names:cliJobs},
  {name:'CLI Strict Sandbox',workflow:'cli-strict-sandbox.yml',names:[
    'macOS latest native capability',...['ubuntu-24.04','macos-15','windows-latest','ubuntu-24.04-arm'].map(os=>`strict native boundary (${os})`)]},
  {name:'IDE Extensions',workflow:'ide-extensions.yml',names:[...jetbrainsRequiredJobs,...jetbrainsConditionalSkips,postVerificationJob]},
  {name:'IDE ARM64 Host Validation',workflow:'ide-arm64-validation.yml',names:[
    'VS Code architecture-neutral candidate',...['linux','windows','macos'].map(os=>`VS Code ARM64 (${os})`),
    ...['linux','macos'].flatMap(os=>['2024.2','2025.2'].map(version=>`JetBrains ARM64 (${os}, ${version})`)),
    'JetBrains ARM64 (windows, 2026.2.0.1)','Aggregate 11-cell IDE ARM64 evidence']},
  {name:'Memory Query Index Measurement',workflow:'memory-query-index.yml',allowFeaturePush:true,
    names:oses.map(os=>`measurement (${os})`)},
  {name:'Context Memory Kernel CI',workflow:'context-memory-kernel.yml',allowFeaturePush:true,
    requiredSteps:['Verify exact candidate checkout'],
    names:['linux','windows','macos'].map(os=>`Context/Memory (${os})`)},
  {name:'CLI Background Interaction E2E',workflow:'cli-background-interaction-e2e.yml',
    requiredSteps:['Verify exact candidate checkout'],
    names:oses.map(os=>`disconnect/reconnect same turn (${os})`)},
];
export const releasePreflightBranch=configuredSourceBranch();
export function isReleasePreflightRun(run,policy,sha) {
  if(run.head_sha!==sha||run.name!==policy.name||run.path!==`.github/workflows/${policy.workflow}`) return false;
  // The original four workflows restrict ordinary push validation to main;
  // the two memory gates also validate the current feature branch on push.
  // PR heads and manually dispatched source branches are explicitly scoped to
  // this release task. Neither IDE nor npm tags can enter this candidate set.
  if(run.event==='pull_request') return run.head_branch===releasePreflightBranch;
  if(run.event==='push') return run.head_branch==='main'||(policy.allowFeaturePush===true&&run.head_branch===releasePreflightBranch);
  if(run.event==='workflow_dispatch') return ['main',releasePreflightBranch].includes(run.head_branch);
  return false;
}
export function selectReleasePreflightRun(runs,policy,sha) {
  return runs.filter(run=>isReleasePreflightRun(run,policy,sha)).sort((a,b)=>b.id-a.id)[0];
}
export function exactJobs(run,jobs,names,sha) {
  assert.equal(run.head_sha,sha);
  assert(Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0);
  assert.equal(jobs.length,names.length,'Incomplete or extra job matrix');
  assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length,'Duplicate job id');
  const map=new Map(jobs.map(j=>[j.name,j]));
  assert.equal(map.size,jobs.length,'Duplicate job name');
  for(const job of jobs) {
    assert(names.includes(job.name),`Unexpected job: ${job.name}`);
    assert.equal(job.head_sha,sha); assert.equal(job.run_id,run.id); assert.equal(job.run_attempt,run.run_attempt);
  }
  return map;
}
export function verifyPreflightWorkflowSource(policy,source) {
  if(policy.workflow==='cli-background-interaction-e2e.yml') {
    assert.equal(typeof source,'string','Background exact-checkout workflow source is required');
    const text=source.replaceAll('\r\n','\n');
    assert(text.includes('env:\n  CC_BACKGROUND_CANDIDATE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}\n\n'));
    assert.equal((text.match(/CC_BACKGROUND_CANDIDATE_SHA\s*:/gu)??[]).length,1);
    assert.equal((text.match(/github\.sha/gu)??[]).length,1);
    assert(text.includes('      - uses: actions/checkout@v5\n        with:\n          ref: ${{ env.CC_BACKGROUND_CANDIDATE_SHA }}\n      - name: Verify exact candidate checkout\n        shell: bash\n        run: test "$(git rev-parse HEAD)" = "$CC_BACKGROUND_CANDIDATE_SHA"\n'));
    return;
  }
  if(policy.workflow!=='context-memory-kernel.yml')return;
  assert.equal(typeof source,'string','Kernel exact-checkout workflow source is required');
  const text=source.replaceAll('\r\n','\n');
  const declaration='      CONTEXT_MEMORY_CANDIDATE_SHA: ${{ github.event.pull_request.head.sha || github.sha }}';
  assert(text.includes('    env:\n'+declaration+'\n    steps:\n'),'Kernel candidate must be scoped at job env');
  assert.equal((text.match(/CONTEXT_MEMORY_CANDIDATE_SHA\s*:/gu)??[]).length,1,'Candidate environment override');
  assert.equal((text.match(/github\.sha/gu)??[]).length,1,'Merge SHA outside candidate declaration');
  const steps=text.split(/(?=^      - (?:name|uses):)/mu).slice(1);
  assert.match(steps[0],/^      - uses: actions\/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5\n        with:\n          ref: \$\{\{ env\.CONTEXT_MEMORY_CANDIDATE_SHA \}\}\n\s*$/u);
  assert.equal(steps[1].trim(),' - name: Verify exact candidate checkout\n        shell: bash\n        run: test "$(git rev-parse HEAD)" = "$CONTEXT_MEMORY_CANDIDATE_SHA"'.trim());
  const candidate='--candidate-sha "${{ env.CONTEXT_MEMORY_CANDIDATE_SHA }}"';
  const instrumentSteps=steps.filter(step=>/context-memory-(?:writer-probe|soak|benchmark)\.mjs/u.test(step));
  assert.equal(instrumentSteps.length,4,'Missing or duplicate candidate instrument step');
  for(const step of instrumentSteps){assert(step.includes(candidate),'Instrument candidate differs');assert.equal((step.match(/--candidate-sha/gu)??[]).length,1);}
  assert.equal((text.match(/--candidate-sha/gu)??[]).length,4);
  const artifacts=steps.filter(step=>step.includes('uses: actions/upload-artifact@'));
  assert.equal(artifacts.length,1);
  assert(artifacts[0].includes('          name: context-memory-${{ matrix.platform }}-${{ env.CONTEXT_MEMORY_CANDIDATE_SHA }}-${{ github.run_attempt }}\n'),'Artifact identity differs');
}
export function verifyPreflightGate(run,jobs,policy,sha,workflowSource) {
  verifyPreflightWorkflowSource(policy,workflowSource);
  assert(isReleasePreflightRun(run,policy,sha),'Run is outside this release preflight event/branch/workflow/SHA cohort');
  assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success');
  const map=exactJobs(run,jobs,policy.names,sha);
  for(const [name,job] of map) {
    const skipped=policy.name==='IDE Extensions'&&name===postVerificationJob ||
      policy.name==='CLI CI'&&name==='dry-run-publish'&&run.event!=='pull_request';
    assert.equal(job.status,'completed',name); assert.equal(job.conclusion,skipped?'skipped':'success',name);
    for(const stepName of policy.requiredSteps??[]) {
      const matches=(job.steps??[]).filter(step=>step.name===stepName);
      assert.equal(matches.length,1,`${name}/${stepName}`);
      assert.equal(matches[0].status,'completed',`${name}/${stepName}`);
      assert.equal(matches[0].conclusion,'success',`${name}/${stepName}`);
    }
  }
  return {workflow:policy.workflow,runId:run.id,attempt:run.run_attempt,sha,jobs:jobs.length,status:'VERIFIED'};
}
export const npmSuccessJobs=['exact-sha-gate','linux-subreaper / Linux packaged subreaper (x64)',
  'linux-subreaper / Linux packaged subreaper (arm64)','package-cli','publish'];
export const npmSkippedJobs=['test','dry-run'];
export const npmRequiredSteps={
  'exact-sha-gate':['Verify immutable npm tag identity','Verify CLI CI and CLI Strict Sandbox for exact SHA','Upload exact-SHA gate attestation'],
  'package-cli':['Build CLI package assets before packing','Download tested Linux x64 helper','Download tested Linux ARM64 helper',
    'Resolve and pack immutable CLI tarball','Generate CLI release SBOM from immutable tarball','Upload immutable CLI release artifact'],
  publish:['Enable npm Trusted Publishing support','Download exact verified CLI tarball','Verify immutable CLI tarball before publishing','Set publish command',
    ...['agent-protocol','core-env','core-mtc','core-multisig','core-settlement','shared-logger','core-config','core-db','core-infra',
      'session-core','context-memory-kernel','agent-sdk','personal-data-hub'].map(name=>`Publish @chainlesschain/${name}`),
    'Verify Agent Protocol registry bytes and npm provenance','Verify published Context Memory Kernel registry bytes and npm provenance',
    'Verify published Agent SDK registry bytes and npm provenance','Verify public child bytes and registry-only dependencies before CLI publish',
    'Publish chainlesschain (CLI)','Verify published CLI npm provenance','Upload public npm readback evidence'],
};
export function verifyNpmPublicationJobs(run,jobs,{sha,version,runId},workflowSource) {
  assert.equal(String(run.id),runId); assert.equal(run.path,'.github/workflows/npm-publish.yml');
  assert.equal(run.event,'push'); assert.equal(run.head_branch,`v-npm-${version.replaceAll('.','-')}`);
  assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success');
  const map=exactJobs(run,jobs,[...npmSuccessJobs,...npmSkippedJobs],sha);
  for(const [name,job] of map) {
    assert.equal(job.status,'completed',name); assert.equal(job.conclusion,npmSkippedJobs.includes(name)?'skipped':'success',name);
    for(const step of job.steps??[]) assert(['success','skipped'].includes(step.conclusion),`Failed or incomplete step: ${name}/${step.name}`);
  }
  for(const name of npmSuccessJobs) {
    const steps=map.get(name).steps;
    const required=npmRequiredSteps[name]??['Verify source and native build architecture','Build static helper from canonical source',
      'Verify packaged execution without compiler or network','Upload tested architecture payload','Upload no-compiler cleanup evidence'];
    for(const stepName of required) {
      const matches=steps.filter(s=>s.name===stepName); assert.equal(matches.length,1,`${name}/${stepName}`);
      assert.equal(matches[0].status,'completed',stepName); assert.equal(matches[0].conclusion,'success',stepName);
    }
  }
  const publishSteps=map.get('publish').steps;
  const index=name=>publishSteps.findIndex(step=>step.name===name);
  const registryIndex=index('Verify public child bytes and registry-only dependencies before CLI publish');
  const cliIndex=index('Publish chainlesschain (CLI)');
  assert(registryIndex<cliIndex&&cliIndex<index('Verify published CLI npm provenance'),'CLI publish/readback order differs');
  for(const name of npmRequiredSteps.publish.filter(name=>name.startsWith('Publish @chainlesschain/'))) {
    assert(index('Enable npm Trusted Publishing support')<index(name)&&index(name)<registryIndex,'Child publish must precede registry validation and CLI');
  }
  const publishSource=workflowSource.split(/^  publish:\s*$/mu)[1]; assert(publishSource,'Missing publish job source');
  assert.match(publishSource,/id-token:\s*write/u);
  assert.match(publishSource,/npm install --global npm@11\.18\.0/u);
  assert.match(publishSource,/FLAGS=--provenance --access public/u);
  assert(!/\b(?:NODE_AUTH_TOKEN|NPM_TOKEN)\s*:/u.test(publishSource),'Unexpected token publishing configuration');
  return {status:'VERIFIED',runId:run.id,attempt:run.run_attempt,sha,jobs:jobs.length,
    oidcEvidence:'Exact workflow id-token permission, successful Trusted Publishing step and independently checked signed provenance receipts'};
}

// Matrix names above were checked against these exact candidate Git blobs.
export const workflowSourceHashes={
  ".github/workflows/cli-ci.yml": "09f286254dc7ac3baf72d649e4df9cc00e52a7edca747711731a23ed0faf9299",
  ".github/workflows/_cli-test.yml": "a645c7c93fbbfdbb36ff67564ca6cd23e34cd058a12ec1af10ce5704a2ce60a1",
  ".github/workflows/cli-strict-sandbox.yml": "9e83055cae1e4fa4303af8b2abe913eea682e286f650e1dbc07d2aaf73cf14af",
  ".github/workflows/ide-extensions.yml": "c3aa38214e8853a9adddbe2290bb44e0d8d7fa08cf885ba66695e0c00d8ca712",
  ".github/workflows/ide-arm64-validation.yml": "d31e045d45d5dc0f24222b5bfeeff2de72c4cb54a987c1f4fec0b75014fc3f49",
  ".github/workflows/memory-query-index.yml": "c057ed2d4ccda3508478019e40ed53a8a186581c03771d63640670f776ef5c68",
  ".github/workflows/context-memory-kernel.yml": "400ced2f0249340dce5c498134c32a331eed1b529635f70e1d90a328c25d5a8b",
  ".github/workflows/cli-background-interaction-e2e.yml": "5913b62771b64111c318b13254d41a73e96b3c590598eee7c3b0f166ce9b6f00",
  ".github/workflows/npm-publish.yml": "0ab117daafe75c0de7fdbd562b05f70baf4288dfcaf3b7ba3b0b6aa5ac96c2dc"
};
