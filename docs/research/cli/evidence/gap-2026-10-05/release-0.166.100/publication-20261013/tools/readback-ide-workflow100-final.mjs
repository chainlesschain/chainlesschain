import assert from 'node:assert/strict';

export const jetbrainsRequiredJobs = [
  'Public IDE capability manifest (drift gate)',
  'Browser evidence (linux)', 'Browser evidence (windows)', 'Browser evidence (macos)',
  'Browser evidence (three-OS required aggregate)',
  ...['windows-latest', 'ubuntu-latest', 'macos-latest'].flatMap(os =>
    ['2024.2', '2025.2'].map(version => `JetBrains real host (${os}, ${version})`)),
  'JetBrains plugin (build + publish)',
];
export const jetbrainsConditionalSkips = [
  'VS Code extension (immutable candidate)',
  'VS Code extension (Windows host gate)',
  'VS Code extension (macOS host gate)',
  'VS Code Remote-SSH container (scoped trusted cell)',
  'IDE roadmap evidence (trusted scoped aggregate)',
  'VS Code extension (Linux host gate + publish)',
];
export const postVerificationJob = 'JetBrains Marketplace (post-publish verification)';
export const vscodeRequiredJobs = [...jetbrainsRequiredJobs.slice(0,5), ...jetbrainsConditionalSkips];
export const vscodeConditionalSkips = [
  'JetBrains real host (${{ matrix.os }}, ${{ matrix.ide.version }})',
  'JetBrains plugin (build + publish)', postVerificationJob,
];

// Observation only: never authorizes release, ignores failed jobs, or calls an API.
// The only allowed incomplete job is the separate JetBrains post-publish check.
export function verifyIdeWorkflowObservation(run, listing, expected) {
  const {kind,sha,version,runId} = expected;
  assert(['jetbrains','vscode'].includes(kind));
  assert.equal(String(run.id),runId);
  assert.equal(run.head_sha,sha);
  assert.equal(run.event,'push');
  assert.equal(run.head_branch,`ide-${kind}-v${version}`);
  assert.equal(run.path,'.github/workflows/ide-extensions.yml');
  assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
  assert.equal(listing.jobs.length,listing.total_count,'Incomplete job listing');
  assert(listing.total_count > 0);
  for (const job of listing.jobs) {
    assert.equal(String(job.run_id),runId);
    assert.equal(job.run_attempt,run.run_attempt);
    assert.equal(job.head_sha,sha);
  }
  if (kind === 'vscode') {
    assert.equal(run.status,'completed'); assert.equal(run.conclusion,'success');
    const jobs=new Map(listing.jobs.map(job=>[job.name,job]));
    const allowed=new Set([...vscodeRequiredJobs,...vscodeConditionalSkips]);
    assert.equal(jobs.size,listing.jobs.length,'Duplicate VS Code job');
    assert.equal(jobs.size,allowed.size,'VS Code tag requires exactly 14 jobs');
    for(const name of jobs.keys()) assert(allowed.has(name),`Unexpected VS Code job: ${name}`);
    for(const name of allowed) {
      const job=jobs.get(name); assert(job,`Missing VS Code job: ${name}`);
      assert.equal(job.status,'completed',name);
      assert.equal(job.conclusion,vscodeConditionalSkips.includes(name)?'skipped':'success',name);
    }
    const publisher=jobs.get('VS Code extension (Linux host gate + publish)');
    for(const name of ['Verify immutable candidate manifest before publishing',
      'Require published CLI before VS Code release','Preflight Open VSX credential',
      'Publish to Open VSX','Verify Open VSX listing']) {
      const steps=publisher.steps.filter(step=>step.name===name);
      assert.equal(steps.length,1,name); assert.equal(steps[0].status,'completed',name);
      assert.equal(steps[0].conclusion,'success',name);
    }
    for(const name of ['Preflight VS Code Marketplace credential','Publish to VS Code Marketplace',
      'Verify VS Code Marketplace listing and exact VSIX']) {
      const steps=publisher.steps.filter(step=>step.name===name);
      assert.equal(steps.length,1,name); assert.equal(steps[0].status,'completed',name);
      assert.equal(steps[0].conclusion,'skipped',name);
    }
    return {state:'COMPLETED_SUCCESS',workflowComplete:true};
  }
  const allowed = new Set([...jetbrainsRequiredJobs,...jetbrainsConditionalSkips,postVerificationJob]);
  const jobs = new Map(listing.jobs.map(job=>[job.name,job]));
  assert.equal(jobs.size,listing.jobs.length,'Duplicate job name');
  assert.equal(jobs.size,allowed.size,'Missing or extra release jobs');
  for (const name of jobs.keys()) assert(allowed.has(name),`Unexpected job: ${name}`);
  for (const name of jetbrainsRequiredJobs) {
    const job=jobs.get(name); assert(job,`Missing required job: ${name}`);
    assert.equal(job.status,'completed',name); assert.equal(job.conclusion,'success',name);
  }
  for (const name of jetbrainsConditionalSkips) {
    const job=jobs.get(name); assert(job,`Missing conditional job: ${name}`);
    assert.equal(job.status,'completed',name); assert.equal(job.conclusion,'skipped',name);
  }
  const publisher=jobs.get('JetBrains plugin (build + publish)');
  for (const name of ['Require published CLI before JetBrains release','Publish to JetBrains Marketplace']) {
    const steps=publisher.steps.filter(step=>step.name===name);
    assert.equal(steps.length,1,`Missing/duplicate publisher step: ${name}`);
    assert.equal(steps[0].status,'completed'); assert.equal(steps[0].conclusion,'success');
  }
  const post=jobs.get(postVerificationJob);
  if (run.status==='completed') {
    assert.equal(run.conclusion,'success');
    assert.equal(post.status,'completed'); assert.equal(post.conclusion,'success');
    return {state:'COMPLETED_SUCCESS',workflowComplete:true};
  }
  assert(['queued','in_progress'].includes(run.status),'Unexpected incomplete run state');
  assert.equal(run.conclusion,null);
  assert(['queued','in_progress','waiting'].includes(post.status),'Post verification did not remain pending');
  assert.equal(post.conclusion,null);
  assert((post.steps??[]).every(step=>step.conclusion==null||['success','skipped'].includes(step.conclusion)),
    'Post verification already contains a failed step');
  return {state:'PUBLISHER_SUCCEEDED_POST_VERIFICATION_PENDING',workflowComplete:false,
    postVerificationJobId:post.id,publicationState:'PENDING_NOT_PUBLIC'};
}
