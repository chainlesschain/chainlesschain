"""Collect only already-dispatched retest runs into the plan's separate ledger.

Usage: python packages/cli/scripts/verify01-collect-native-retest.py --plan <repo-relative-plan.json>
         --runs-file <JSON array of {shardId, group, runId, sourceCommit}>
Legacy plans without executionShards retain {group, runId, sourceCommit}.
Subsequent invocations may omit --runs-file. No dispatch or candidate execution.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import uuid

TREE = pathlib.Path(__file__).resolve().parents[3]
WORK = TREE / '.work'
READER = pathlib.Path(__file__).resolve().with_name('verify01-read-diagnostic-artifact.py')
REPO = 'chainlesschain/chainlesschain'
VERIFIER = 'packages/cli/scripts/verify01-native-retest-round.mjs'
EVIDENCE = 'docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18'


def sha(raw):
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def disk(target):
    # Preserve long Windows archive names without weakening path validation.
    text = str(target.absolute())
    return pathlib.Path('\\\\?\\' + text) if os.name == 'nt' and len(text) >= 240 else target


def safe_file(root, relative, create=False):
    assert isinstance(relative, str) and relative
    assert not re.search(r'[\\:\x00-\x1f]', relative)
    parts = relative.split('/')
    assert all(part and part not in ('.', '..') for part in parts)
    current = root
    for index, part in enumerate(parts):
        current = current / part
        target = disk(current)
        try:
            info = target.lstat()
        except FileNotFoundError:
            if index < len(parts) - 1:
                assert create, 'missing evidence directory'
                target.mkdir()
                info = target.lstat()
            else:
                return current
        assert not stat.S_ISLNK(info.st_mode)
        assert not (getattr(info, 'st_file_attributes', 0) & 0x400), 'reparse path denied'
        assert stat.S_ISREG(info.st_mode) if index == len(parts) - 1 else stat.S_ISDIR(info.st_mode)
    return current


def immutable(root, relative, raw):
    target = safe_file(root, relative, create=True)
    try:
        with disk(target).open('xb') as output:
            output.write(raw)
    except FileExistsError:
        assert disk(target).read_bytes() == raw, 'existing archive bytes differ'
    return target


def verify(plan_file, ledger=None, plan_only=False):
    command = ['node', VERIFIER, '--plan', plan_file]
    if plan_only:
        command.append('--plan-only')
    elif ledger is not None:
        command.append('--stdin')
    result = subprocess.run(command, input=encoded(ledger) if ledger is not None else None,
                            stdout=subprocess.PIPE, cwd=TREE, timeout=180, check=True)
    return json.loads(result.stdout)


def gh(*args):
    return json.loads(subprocess.check_output(['gh', *args], cwd=TREE, timeout=90))


def generation_diagnostic_members(sample_id, listing):
    """Keep bounded diagnostics and broker receipts, excluding request/response bodies."""
    assert isinstance(sample_id, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}', sample_id)
    assert isinstance(listing, list)
    selected = set()
    for member in listing:
        if not isinstance(member, str) or re.search(r'[\\:\x00-\x1f]', member):
            continue
        parts = member.split('/')
        if len(parts) < 3 or parts[0] != sample_id or any(part in ('', '.', '..') for part in parts):
            continue
        receipt = (len(parts) == 3 and parts[1] == 'broker' and
                   re.fullmatch(r'request-[1-9][0-9]*\.receipt\.json', parts[2]))
        stderr = parts[1] == 'cli-stderr-diagnostics' and '.stderr-redacted.' in member
        capture = parts[1] == 'capture' and (parts[-1].startswith('driver-failure-') or
            parts[-1] in ('ui-initial.json', 'restart-state.json', 'terminal.json',
                          'vscode-initial.json', 'vscode-restart.json'))
        if receipt or stderr or capture:
            selected.add(member)
    return sorted(selected)


def validate_bindings(bindings, plan, allow_partial=False):
    assert isinstance(bindings, list)
    shards = plan.get('executionShards', [dict(group, shardId=group['group']) for group in plan['groups']])
    expected = {shard['shardId']: shard for shard in shards}
    assert len(expected) == len(shards), 'duplicate shard IDs'
    ids = [sample for shard in shards for sample in shard['sampleIds']]
    assert len(set(ids)) == len(ids), 'overlapping shards'
    assert sorted(ids) == sorted(sample for group in plan['groups'] for sample in group['sampleIds'])
    actual = [row.get('shardId', row['group']) for row in bindings]
    assert len(set(actual)) == len(actual), 'duplicate bound shard IDs'
    if allow_partial:
        assert 0 < len(bindings) <= len(expected), 'partial collection requires dispatched runs'
        assert set(actual).issubset(expected), 'bound shard outside plan'
    else:
        assert len(bindings) == len(expected)
        assert set(actual) == set(expected)
    assert len(set(row['runId'] for row in bindings)) == len(bindings)
    for row in bindings:
        assert set(row) == ({'shardId', 'group', 'runId', 'sourceCommit'} if 'executionShards' in plan else {'group', 'runId', 'sourceCommit'})
        shard = expected[row.get('shardId', row['group'])]
        assert row['group'] == shard['group']
        assert re.fullmatch(r'[1-9][0-9]*', row['runId'])
        assert re.fullmatch(r'[a-f0-9]{40}', row['sourceCommit'])
    return {row.get('shardId', row['group']): row for row in bindings}


def initialize(plan, plan_file, plan_digest, bindings, allow_partial=False):
    assert plan['plannedNewSamples'] > 0, 'all candidates accepted; no new generation is needed'
    selected = validate_bindings(bindings, plan, allow_partial)
    frozen = json.loads(safe_file(TREE, 'docs/research/cli/verify01-plan-2026-10-13-volcengine/plan.json').read_bytes())
    samples = {row['id']: row for row in frozen['samples']}
    data = {key: plan[key] for key in ['packageSetPath', 'packageSetDigest', 'versions',
        'frozenProjectCommit', 'ledgerPath', 'archivePrefix', 'plannedNewSamples', 'reusedAcceptedSampleIds']}
    data.update(schema='chainlesschain.native-package-retest-round/v1', billingAssessed=False,
                planPath=plan_file, planDigest=plan_digest, status='IN_PROGRESS', runs=[], samples=[])
    if allow_partial:
        data['partialDispatch'] = True
    for group in plan.get('executionShards', [dict(group, shardId=group['group']) for group in plan['groups']]):
        binding = selected.get(group['shardId'])
        if binding:
            data['runs'].append({**binding, 'selectedSampleIds': group['sampleIds'], 'status': 'IN_PROGRESS'})
        for sample_id in group['sampleIds']:
            sample = samples[sample_id]
            data['samples'].append({'sampleId': sample_id, 'taskId': sample['taskId'],
                'kind': sample['kind'], 'group': group['group'],
                'status': 'PENDING_EXECUTION' if binding else 'PENDING_DISPATCH', 'generationObserved': False})
    return data


def counts(data):
    result = {
        'generationRecordsCollected': sum(len(run['generation']['sampleIds']) for run in data['runs'] if run.get('generation')),
        'acceptanceRecordsCollected': sum(len(run['acceptance']['sampleIds']) for run in data['runs'] if run.get('acceptance')),
        'candidateAcceptancePassed': sum(row.get('candidateAcceptancePassed') is True for row in data['samples']),
        'endToEndPassed': sum(row.get('endToEndPassed') is True for row in data['samples']),
        'reusedAcceptedDeliverables': len(data['reusedAcceptedSampleIds']),
    }
    result['cumulativeAcceptedDeliverables'] = result['reusedAcceptedDeliverables'] + result['candidateAcceptancePassed']
    return result


def copy_generation_fields(sample, native):
    # Missing JSON properties must stay absent, distinct from explicit null.
    for key in ('generationPassed', 'brokerStatus', 'host'):
        if key in native:
            sample[key] = native[key]
        else:
            sample.pop(key, None)


class Collector:
    def __init__(self, plan_file, runs_file, allow_partial=False):
        validated = verify(plan_file, plan_only=True)
        self.plan, self.plan_digest = validated['plan'], validated['planDigest']
        self.plan_file = plan_file
        self.file = safe_file(TREE, self.plan['ledgerPath'])
        self.stem = pathlib.PurePosixPath(self.plan['archivePrefix']).name
        assert self.plan['ledgerPath'] == EVIDENCE + '/' + self.stem + '.json'
        assert self.plan['archivePrefix'] == EVIDENCE + '/' + self.stem
        self.cache = safe_file(WORK, 'next-package-artifacts/' + hashlib.sha256(plan_file.encode()).hexdigest()[:16] + '/placeholder', create=True).parent
        self.previous = disk(self.file).read_bytes() if disk(self.file).exists() else None
        bindings = json.loads(pathlib.Path(runs_file).read_bytes()) if runs_file else None
        if self.previous is not None:
            self.data = json.loads(self.previous)
            verify(plan_file, self.data)
            if bindings is not None:
                declared = validate_bindings(bindings, self.plan, allow_partial)
                for run in self.data['runs']:
                    keys = ('shardId', 'group', 'runId', 'sourceCommit') if 'executionShards' in self.plan else ('group', 'runId', 'sourceCommit')
                    assert {key: run[key] for key in keys} == declared[run.get('shardId', run['group'])]
                existing = {run.get('shardId', run['group']) for run in self.data['runs']}
                added = initialize(self.plan, plan_file, self.plan_digest, bindings, allow_partial)
                for run in added['runs']:
                    if run.get('shardId', run['group']) not in existing:
                        self.data['runs'].append(run)
                        for sample in self.data['samples']:
                            if sample['sampleId'] in run['selectedSampleIds']:
                                sample['status'] = 'PENDING_EXECUTION'
                if allow_partial:
                    self.data['partialDispatch'] = True
        else:
            assert bindings is not None, '--runs-file is required for a new ledger'
            self.data = initialize(self.plan, plan_file, self.plan_digest, bindings, allow_partial)

    def archive(self, raw, run_id):
        assert re.fullmatch(r'[1-9][0-9]*', run_id)
        relative = self.stem + '/' + run_id + '/objects/' + hashlib.sha256(raw).hexdigest() + '.gz'
        stored = gzip.compress(raw, mtime=0)
        immutable(TREE, EVIDENCE + '/' + relative, stored)
        return {'path': relative, 'originalDigest': sha(raw), 'storedDigest': sha(stored), 'originalBytes': len(raw)}

    def checkpoint(self):
        self.data['counts'] = counts(self.data)
        shards = self.plan.get('executionShards', self.plan['groups'])
        self.data['status'] = 'COMPLETED' if len(self.data['runs']) == len(shards) and all(run['status'] == 'COMPLETED' for run in self.data['runs']) else 'IN_PROGRESS'
        verify(self.plan_file, self.data)
        raw = encoded(self.data)
        target = safe_file(TREE, self.plan['ledgerPath'])
        if self.previous is not None:
            assert disk(target).read_bytes() == self.previous, 'ledger changed during collection'
        pending_relative = self.plan['ledgerPath'] + '.pending-' + uuid.uuid4().hex
        pending = immutable(TREE, pending_relative, raw)
        try:
            if self.previous is None:
                # Atomic no-clobber creation: never replace an existing ledger.
                os.link(disk(pending), disk(target))
            else:
                disk(pending).replace(disk(target))
        finally:
            if disk(pending).exists():
                disk(pending).unlink()
        self.previous = raw

    def read_members(self, artifact, dest, members):
        for member in members:
            safe_file(dest, member, create=True)
        missing = sorted(set(member for member in members if not disk(safe_file(dest, member)).exists()))
        if missing:
            subprocess.check_call([sys.executable, str(READER),
                str(artifact['id']), str(artifact['size_in_bytes']), str(dest), *missing], timeout=1200)
        for member in members:
            assert disk(safe_file(dest, member)).is_file()

    def metadata(self, run):
        state = gh('run', 'view', run['runId'], '--repo', REPO, '--json', 'databaseId,status,conclusion,headSha,jobs')
        assert str(state['databaseId']) == run['runId']
        assert state['headSha'] == run['sourceCommit']
        artifacts = gh('api', 'repos/' + REPO + '/actions/runs/' + run['runId'] + '/artifacts?per_page=100')['artifacts']
        return run['runId'], state, artifacts

    def collect(self):
        pending = [run for run in self.data['runs'] if run['status'] != 'COMPLETED']
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            remote = {item[0]: item[1:] for item in pool.map(self.metadata, pending)}
        # Give every initial run a verified remote identity before checkpointing.
        for run in pending:
            state, _ = remote[run['runId']]
            run['remoteState'] = self.archive(encoded(state), run['runId'])
            run['remoteStatus'] = state['status']
            run['conclusion'] = state['conclusion'] or None
            run['activeJobs'] = [job['name'] for job in state['jobs'] if job['status'] == 'in_progress']
            run['status'] = 'COMPLETED' if state['status'] == 'completed' and run.get('generation') and run.get('acceptance') else 'IN_PROGRESS'
        for run in pending:
            run_id = run['runId']
            state, artifacts = remote[run_id]
            records = {(item['stage'], item['originalArtifactPath']): item for item in run.get('evidence', [])}
            summaries = {}
            for stage, label in [('generation', 'delivery'), ('acceptance', 'acceptance')]:
                name = 'verify01-native-subset-' + label + '-' + run['group'] + '-' + run['sourceCommit']
                found = [item for item in artifacts if item['name'] == name]
                if not found:
                    continue
                assert len(found) == 1
                artifact = found[0]
                assert str(artifact['workflow_run']['id']) == run_id
                assert artifact['workflow_run']['head_sha'] == run['sourceCommit']
                dest = safe_file(self.cache, run_id + '/' + stage + '-' + str(artifact['id']) + '/placeholder', create=True).parent
                self.read_members(artifact, dest, ['summary.json'])
                raw = disk(safe_file(dest, 'summary.json')).read_bytes()
                summary = json.loads(raw)
                assert summary['executionSourceCommit'] == run['sourceCommit']
                assert summary['group'] == run['group']
                assert summary['versions'] == self.plan['versions']
                assert summary['packageSetDigest'] == self.plan['packageSetDigest']
                assert summary['selectionScope'] == 'operator-subset'
                assert sorted(summary['selectedSampleIds']) == sorted(run['selectedSampleIds'])
                assert sorted(row['sampleId'] for row in summary['samples']) == sorted(run['selectedSampleIds'])
                members = []
                if stage == 'generation':
                    members.append('package-set.json')
                    listing_file = safe_file(dest, 'members.json')
                    if not disk(listing_file).exists():
                        listing = subprocess.check_output([sys.executable, str(READER),
                            str(artifact['id']), str(artifact['size_in_bytes']), str(dest), '--list'], timeout=600).decode().splitlines()
                        immutable(dest, 'members.json', encoded(listing))
                    listing = json.loads(disk(listing_file).read_bytes())
                    for sample in summary['samples']:
                        assert sample['versions'] == self.plan['versions']
                        assert sample['packageSetDigest'] == self.plan['packageSetDigest']
                        members += [item['path'] for item in sample.get('candidates', [])]
                        members += generation_diagnostic_members(sample['sampleId'], listing)
                else:
                    assert 'generation' in run, 'acceptance arrived without bound generation'
                    assert summary['sourceSummaryDigest'] == run['generation']['rawSummary']['originalDigest']
                    assert summary['deliverySourceCommit'] == run['sourceCommit']
                    for sample in summary['samples']:
                        members += [sample[part]['receiptPath'] for part in ['setup', 'check']
                            if isinstance(sample.get(part), dict) and sample[part].get('receiptPath')]
                self.read_members(artifact, dest, members)
                if stage == 'generation':
                    assert sha(disk(safe_file(dest, 'package-set.json')).read_bytes()) == self.plan['packageSetDigest']
                for member in sorted(set(members)):
                    records[(stage, member)] = {'stage': stage, 'originalArtifactPath': member,
                        'archived': self.archive(disk(safe_file(dest, member)).read_bytes(), run_id)}
                run[stage] = {'artifactId': artifact['id'], 'artifactName': name,
                    'artifactMetadata': self.archive(encoded(artifact), run_id),
                    'rawSummary': self.archive(raw, run_id),
                    'sampleIds': [row['sampleId'] for row in summary['samples']]}
                summaries[stage] = summary
            run['evidence'] = [item for _, item in sorted(records.items())]
            if run.get('generation'):
                generated = summaries.get('generation') or json.loads(gzip.decompress(
                    disk(safe_file(TREE, EVIDENCE + '/' + run['generation']['rawSummary']['path'])).read_bytes()))
                accepted = summaries.get('acceptance')
                if accepted is None and run.get('acceptance'):
                    accepted = json.loads(gzip.decompress(disk(safe_file(TREE,
                        EVIDENCE + '/' + run['acceptance']['rawSummary']['path'])).read_bytes()))
                checked = {row['sampleId']: row for row in accepted['samples']} if accepted else {}
                for native in generated['samples']:
                    sample = next(row for row in self.data['samples'] if row['sampleId'] == native['sampleId'])
                    sample.update(generationObserved=True, generationRunId=run_id,
                        sourceSummaryDigest=run['generation']['rawSummary']['originalDigest'],
                        modelFailureCategory=(native.get('model') or {}).get('failureCategory'),
                        status='AWAITING_ACCEPTANCE')
                    copy_generation_fields(sample, native)
                    if native['sampleId'] in checked:
                        row = checked[native['sampleId']]
                        sample.update(candidateAcceptancePassed=row['candidateAcceptancePassed'],
                            endToEndPassed=row['passed'],
                            status='CANDIDATE_ACCEPTED' if row['candidateAcceptancePassed'] else 'ATTEMPT_FAILED')
            run['status'] = 'COMPLETED' if state['status'] == 'completed' and run.get('generation') and run.get('acceptance') else 'IN_PROGRESS'
            self.checkpoint()
        if not pending:
            verify(self.plan_file, self.data)
        print(json.dumps({'status': self.data['status'], 'counts': self.data['counts'],
            'ledgerPath': self.plan['ledgerPath'],
            'pending': [run.get('shardId', run['group']) for run in self.data['runs'] if run['status'] != 'COMPLETED']}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    parser.add_argument('--runs-file')
    parser.add_argument('--allow-partial', action='store_true',
                        help='Collect only dispatched shards while retaining every planned sample as pending; cannot satisfy --require-complete')
    args = parser.parse_args()
    WORK.mkdir(exist_ok=True)
    work_info = WORK.lstat()
    assert stat.S_ISDIR(work_info.st_mode) and not stat.S_ISLNK(work_info.st_mode)
    assert not (getattr(work_info, 'st_file_attributes', 0) & 0x400), 'reparse cache root denied'
    lock_name = 'next-package-artifacts/' + hashlib.sha256(args.plan.encode()).hexdigest()[:16] + '.lock'
    lock = safe_file(WORK, lock_name, create=True)
    with disk(lock).open('x', encoding='utf-8') as output:
        output.write(str(os.getpid()) + '\n')
    try:
        Collector(args.plan, args.runs_file, args.allow_partial).collect()
    finally:
        disk(lock).unlink()


if __name__ == '__main__':
    main()
