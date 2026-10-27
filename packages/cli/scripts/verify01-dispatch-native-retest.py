"""Prepare/submit native retest shards without ever automatically resending an intent.

Default: --plan <committed repo-relative plan> prints a read-only preview.
--submit explicitly authorizes dispatch of still-unrequested shards.
--submit --max-new-dispatches N submits at most N new shards per invocation.
Resume with the same committed plan and evaluation HEAD; resolved shards are skipped.
This limits batch size, not concurrent runs: wait for the current batch's generation
jobs to finish before submitting another batch when limiting concurrency.
--resolve only reads GitHub, appends local resolutions, and never dispatches.
An unresolved intent always blocks --submit, including after a crashed request.
Journal: shared Git common-directory parent's .work/next-package-dispatch/
<plan digest>/ (keep permanently; all linked worktrees use the same intents).
Collector mappings are written only when every shard is uniquely resolved.
"""
import argparse
import contextlib
import datetime
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import uuid

TREE = pathlib.Path(__file__).resolve().parents[3]


def shared_work_directory(repository_root):
    result = subprocess.run(
        ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd=repository_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError('Cannot locate the shared Git journal; refusing a worktree-local fallback')
    common = pathlib.Path(result.stdout.decode('utf-8').strip())
    if not common.is_absolute() or not common.is_dir():
        raise RuntimeError('Invalid Git common directory; refusing a worktree-local journal')
    return common.resolve().parent / '.work'


WORK = shared_work_directory(TREE)
REPO = 'chainlesschain/chainlesschain'
WORKFLOW = 'verify01-native-task-campaign.yml'
VERIFIER = 'packages/cli/scripts/verify01-native-retest-round.mjs'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def digest(raw):
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def command(args):
    # Never print or persist subprocess stderr, environment, or authentication.
    result = subprocess.run(args, cwd=TREE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=120)
    require(result.returncode == 0, 'Read-only command failed; no dispatch may proceed')
    return result.stdout


def git(*args):
    return command(['git', *args])


def gh(*args):
    return json.loads(command(['gh', *args]))


def safe_relative(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', value), 'Invalid relative path')
    require(not value.startswith('/') and all(p not in ('', '.', '..') for p in value.split('/')), 'Unsafe relative path')
    return value


def committed_bytes(relative, head):
    safe_relative(relative)
    target = TREE
    for part in relative.split('/'):
        target = target / part
        require(not target.is_symlink() and not (getattr(target.lstat(), 'st_file_attributes', 0) & 0x400), 'Linked source refused')
    raw = target.read_bytes()
    require(raw == git('show', head + ':' + relative), 'Plan/manifest must exactly match committed bytes')
    return raw


def validate_shards(plan):
    shards = plan.get('executionShards')
    require(isinstance(shards, list) and shards, 'Explicit executionShards are required for new dispatch')
    groups = {g['group']: g['sampleIds'] for g in plan['groups']}
    all_ids, keys = [], []
    for shard in shards:
        key, group, ids = shard['shardId'], shard['group'], shard['sampleIds']
        require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,159}', key), 'Unsafe shard ID')
        require(group in groups and re.fullmatch(r'(win32|linux|darwin)-(cli|vscode|jetbrains)', group), 'Unknown shard group')
        require(isinstance(ids, list) and ids and len(set(ids)) == len(ids), 'Duplicate/empty sample selection')
        require(all(isinstance(i, str) and re.fullmatch(r'[a-z0-9-]+', i) and i in groups[group] for i in ids), 'Shard sample outside group')
        require(len('-'.join(sorted(ids))) <= 160, 'Canonical sample key too long')
        require(not group.endswith('-jetbrains') or len(ids) == 1, 'JetBrains requires one sample per dispatch')
        all_ids.extend(ids)
        keys.append(key)
    require(len(set(keys)) == len(keys) and len(set(all_ids)) == len(all_ids), 'Overlapping shards')
    require(sorted(all_ids) == sorted(i for g in plan['groups'] for i in g['sampleIds']), 'Incomplete shard coverage')
    require(not set(all_ids).intersection(plan['reusedAcceptedSampleIds']), 'Accepted sample cannot be dispatched')
    require(len(all_ids) == plan['plannedNewSamples'], 'Sample count differs')
    return shards


def load_context(plan_file):
    head = git('rev-parse', 'HEAD').decode().strip()
    branch = git('branch', '--show-current').decode().strip()
    require(re.fullmatch(r'[a-f0-9]{40}', head) and branch, 'Named evaluation branch required')
    require(not git('diff', '--name-only', 'HEAD').strip(), 'Tracked evaluation files must be committed')
    plan_raw = committed_bytes(plan_file, head)
    validated = json.loads(command(['node', VERIFIER, '--plan', plan_file, '--plan-only']))
    plan = validated['plan']
    require(validated['planDigest'] == digest(plan_raw), 'Verifier plan digest differs')
    manifest_raw = committed_bytes(plan['packageSetPath'], head)
    require(digest(manifest_raw) == plan['packageSetDigest'], 'Manifest digest differs')
    manifest = json.loads(manifest_raw)
    require(manifest['versions'] == plan['versions'], 'Manifest versions differ')
    shards = validate_shards(plan)
    context = {'schema': 'chainlesschain.native-dispatch-journal/v1', 'repository': REPO,
               'workflow': WORKFLOW, 'branch': branch, 'sourceCommit': head,
               'planPath': plan_file, 'planDigest': digest(plan_raw),
               'packageSetPath': plan['packageSetPath'], 'packageSetDigest': digest(manifest_raw),
               'versions': plan['versions'], 'executionShards': shards}
    return context, manifest


def assert_remote_head(context):
    # Read the live ref through the authenticated API rather than invoking a
    # Git credential helper, whose descendants can outlive a Windows timeout.
    reference = 'heads/' + context['branch']
    remote = gh('api', f'repos/{REPO}/git/ref/' + urllib.parse.quote(reference, safe='/'))
    require(remote.get('ref') == 'refs/' + reference and
            remote.get('object', {}).get('type') == 'commit' and
            remote['object'].get('sha') == context['sourceCommit'],
            'Remote evaluation branch SHA changed')


def public_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'verify01-public-readback'}), timeout=45) as response:
        return json.load(response)


def verify_public(manifest):
    # Fixed public endpoints: no credentials, token headers, or arbitrary manifest URL requests.
    versions, origin = manifest['versions'], manifest['origin']
    cli = public_json('https://registry.npmjs.org/chainlesschain/latest')
    require(cli['version'] == versions['cli'], 'CLI is not the latest public version')
    require(cli['dist']['integrity'] == origin['cli']['integrity'] and cli['dist']['tarball'] == origin['cli']['tarball'], 'Public npm identity differs')
    vscode = public_json('https://open-vsx.org/api/chainlesschain/chainlesschain-ide/latest')
    require(vscode['version'] == versions['vscode'] and vscode['files']['download'] == origin['vscode']['download'], 'Public VS Code identity differs')
    updates = public_json('https://plugins.jetbrains.com/api/plugins/32208/updates?size=100')
    matches = [row for row in updates if row.get('version') == versions['jetbrains']]
    require(len(matches) == 1, 'JetBrains public update missing or ambiguous')
    row = matches[0]
    require(row.get('id') == origin['jetbrains']['updateId'] and row.get('file') == origin['jetbrains']['file'], 'JetBrains public identity differs')
    require(row.get('approve') is True and row.get('listed') is True and row.get('hidden') is False, 'JetBrains release must be approved, listed and visible')
    # Ensure the current newest visible approved stable version is the pinned one.
    visible = [item for item in updates if item.get('approve') is True and item.get('listed') is True and item.get('hidden') is False
               and re.fullmatch(r'\d+\.\d+\.\d+', item.get('version', ''))]
    require(visible and max(tuple(map(int, item['version'].split('.'))) for item in visible) == tuple(map(int, versions['jetbrains'].split('.'))), 'JetBrains pinned version is no longer current')


def list_runs(context):
    pages = gh('api', '--method', 'GET', '--paginate', '--slurp',
               f'repos/{REPO}/actions/workflows/{WORKFLOW}/runs',
               '-f', 'branch=' + context['branch'], '-f', 'event=workflow_dispatch',
               '-f', 'head_sha=' + context['sourceCommit'], '-f', 'per_page=100')
    runs = [run for page in pages for run in page['workflow_runs']]
    exact = [run for run in runs if run['head_sha'] == context['sourceCommit'] and run['head_branch'] == context['branch'] and run['event'] == 'workflow_dispatch']
    require(len({run['id'] for run in exact}) == len(exact), 'Run pagination changed; resolve again read-only')
    return exact


def atomic_new(file, value):
    raw = encoded(value)
    if file.exists():
        require(file.read_bytes() == raw, 'Existing journal record differs; halt')
        return
    temporary = file.with_name(file.name + '.pending-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, file)  # atomic no-clobber publication
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def journal_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    # Kernel locks release on process death; a crash cannot make an intent retryable.
    with (directory / 'lock').open('a+b') as lock:
        lock.seek(0, 2)
        if lock.tell() == 0:
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            lock.seek(0)
            if os.name == 'nt':
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(lock, fcntl.LOCK_UN)


def unique_run(intent, runs, url=None):
    before = set(intent['beforeRunIds'])
    candidates = [run for run in runs if str(run['id']) not in before]
    if url:
        match = re.fullmatch(r'https://github\.com/chainlesschain/chainlesschain/actions/runs/([1-9][0-9]*)', url)
        require(match is not None, 'Unexpected dispatch response URL')
        candidates = [run for run in candidates if str(run['id']) == match[1]]
    require(len(candidates) == 1, 'Dispatch intent unresolved/ambiguous; never resend, use --resolve')
    require(candidates[0].get('run_attempt', 1) == 1, 'Rerun attempt cannot silently replace the original dispatch')
    return str(candidates[0]['id'])


def dispatch_args(context, shard):
    platform, entry = shard['group'].split('-')
    return ['gh', 'workflow', 'run', WORKFLOW, '--repo', REPO, '--ref', context['branch'],
            '-f', 'confirm_live=true', '-f', 'hosts=' + {'win32': 'windows', 'linux': 'linux', 'darwin': 'macos'}[platform],
            '-f', 'entries=' + entry, '-f', 'package_set=latest', '-f', 'package_set_file=' + context['packageSetPath'],
            '-f', 'sample_ids=' + ','.join(sorted(shard['sampleIds']))]


def resolve_intent(directory, context, shard, runs):
    key = shard['shardId']
    intent = json.loads((directory / (key + '.intent.json')).read_bytes())
    require(intent['binding'] == context and intent['shard'] == shard, 'Intent binding changed')
    request = directory / (key + '.request.json')
    response = json.loads(request.read_bytes()) if request.exists() else {}
    run_id = unique_run(intent, runs, response.get('runUrl'))
    for file in directory.glob('*.resolved.json'):
        previous = json.loads(file.read_bytes())
        require(previous['runId'] != run_id or previous['shardId'] == key, 'Run already bound to another shard')
    binding = {'shardId': key, 'group': shard['group'], 'runId': run_id, 'sourceCommit': context['sourceCommit']}
    atomic_new(directory / (key + '.resolved.json'), binding)
    return binding


def execute(context, directory, submit=False, resolve=False, dispatch=None, max_new_dispatches=None):
    require(submit != resolve, 'Choose submit OR read-only resolve')
    require(max_new_dispatches is None or
            (submit and type(max_new_dispatches) is int and max_new_dispatches > 0),
            'max-new-dispatches requires --submit and a positive integer')
    dispatch = dispatch or (lambda args: subprocess.run(args, cwd=TREE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120))
    new_dispatches = 0
    with journal_lock(directory):
        atomic_new(directory / 'context.json', context)
        if submit:
            require(not any(not file.with_name(file.name.replace('.intent.json', '.resolved.json')).exists()
                            for file in directory.glob('*.intent.json')),
                    'Unresolved intent blocks submit; use --resolve, never resend')
        for shard in context['executionShards']:
            key = shard['shardId']
            intent_file = directory / (key + '.intent.json')
            resolved = directory / (key + '.resolved.json')
            if resolved.exists():
                require(intent_file.exists(), 'Resolution without an intent')
                continue
            if intent_file.exists():
                require(resolve, 'Unresolved intent blocks submit; use --resolve, never resend')
                assert_remote_head(context)
                resolve_intent(directory, context, shard, list_runs(context))
                continue
            if resolve:
                continue
            # Stop before creating an intent for an unsubmitted shard. The cap
            # is invocation-local; it must not change the bound plan/context.
            if max_new_dispatches is not None and new_dispatches >= max_new_dispatches:
                break
            assert_remote_head(context)
            before = list_runs(context)
            intent = {'binding': context, 'shard': shard, 'beforeRunIds': sorted(str(run['id']) for run in before),
                      'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
            atomic_new(intent_file, intent)
            # From this point ANY failure leaves an intent. Never resend it.
            assert_remote_head(context)
            try:
                response = dispatch(dispatch_args(context, shard))
            except Exception:
                atomic_new(directory / (key + '.request.json'), {'outcome': 'uncertain'})
                raise RuntimeError('Dispatch response unavailable; intent retained, use --resolve') from None
            urls = re.findall(r'https://github\.com/chainlesschain/chainlesschain/actions/runs/[1-9][0-9]*',
                              (response.stdout + response.stderr).decode('utf-8', 'replace'))
            request = {'outcome': 'returned-success' if response.returncode == 0 else 'uncertain'}
            if len(set(urls)) == 1:
                request['runUrl'] = urls[0]
            atomic_new(directory / (key + '.request.json'), request)
            require(response.returncode == 0, 'Dispatch returned failure; intent retained, use --resolve')
            assert_remote_head(context)
            resolve_intent(directory, context, shard, list_runs(context))
            new_dispatches += 1
        bindings = []
        for shard in context['executionShards']:
            file = directory / (shard['shardId'] + '.resolved.json')
            if not file.exists():
                return {'status': 'INCOMPLETE', 'journal': str(directory)}
            row = json.loads(file.read_bytes())
            require(row['shardId'] == shard['shardId'] and row['group'] == shard['group'] and row['sourceCommit'] == context['sourceCommit'], 'Resolved binding changed')
            bindings.append(row)
        require(len({row['runId'] for row in bindings}) == len(bindings), 'Duplicate resolved run ID')
        atomic_new(directory / 'runs.json', bindings)
        return {'status': 'RESOLVED', 'runsFile': str(directory / 'runs.json'), 'runs': bindings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--submit', action='store_true')
    mode.add_argument('--resolve', action='store_true')
    parser.add_argument('--max-new-dispatches', type=int, metavar='N',
                        help='Submit at most N new shards (positive integer, --submit only; default: unlimited). Wait for this batch generation to finish before the next batch to limit concurrency.')
    args = parser.parse_args()
    if args.max_new_dispatches is not None and (not args.submit or args.max_new_dispatches <= 0):
        parser.error('--max-new-dispatches requires --submit and a positive integer')
    context, manifest = load_context(args.plan)
    directory = WORK / 'next-package-dispatch' / context['planDigest'].split(':')[1]
    if directory.exists() and (directory / 'context.json').exists():
        require(json.loads((directory / 'context.json').read_bytes()) == context, 'Existing journal belongs to another evaluation HEAD/context')
    assert_remote_head(context)
    if not args.submit and not args.resolve:
        print(json.dumps({'mode': 'PREVIEW_ONLY', **context, 'journal': str(directory),
                          'unresolvedIntents': [file.stem for file in directory.glob('*.intent.json') if not file.with_name(file.name.replace('.intent.json', '.resolved.json')).exists()]}, indent=2))
        return
    if args.submit:
        verify_public(manifest)
    print(json.dumps(execute(context, directory, submit=args.submit, resolve=args.resolve,
                             max_new_dispatches=args.max_new_dispatches), indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Network/subprocess exception messages can embed request details. Show
        # only our own controlled RuntimeError text, never captured output/env.
        print(str(error) if type(error) is RuntimeError else 'Operation stopped; inspect local intent state before read-only resolution', file=sys.stderr)
        sys.exit(1)
