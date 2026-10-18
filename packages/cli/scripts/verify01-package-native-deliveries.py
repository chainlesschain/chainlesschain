"""Offline cumulative export from the explicit, fully verified retest chain.

Default --round-name next-package-N previews only. --pack creates a new exclusive
directory under the shared Git repository's .work/accepted-round-exports.
Never overwrites the original pack or an export from another linked worktree.
No candidate, model, Docker, or network execution is performed.
"""
import argparse
import copy
import gzip
import hashlib
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

TREE = pathlib.Path(__file__).resolve().parents[3]


def shared_work_directory(repository_root):
    result = subprocess.run(
        ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd=repository_root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError('Cannot locate shared export storage; refusing a worktree-local fallback')
    common = pathlib.Path(result.stdout.decode('utf-8').strip())
    if not common.is_absolute() or not common.is_dir():
        raise RuntimeError('Invalid Git common directory; refusing a worktree-local export')
    return common.resolve().parent / '.work'


WORK = shared_work_directory(TREE)
EVIDENCE = 'docs/research/cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18'
# Bind the reviewed original 25-item export, not a subsequently regenerated pack.
BASE_INDEX_DIGEST = 'sha256:1842cf3a19551cbb927d3f1b024f10726c9771da0c36e126138e17b8d5a8ec9c'
MAX_FILE = 64 * 1024 * 1024
MAX_ARCHIVE = 256 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(raw):
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def safe_name(name):
    require(isinstance(name, str) and name and not re.search(r'[\\:\x00-\x1f]', name), 'Unsafe member name')
    require(not name.startswith('/') and all(part and part not in ('.', '..') for part in name.split('/')), 'Unsafe member path')
    return name


def source(root, relative):
    current = root
    for part in safe_name(relative).split('/'):
        current = current / part
        info = current.lstat()
        require(not current.is_symlink() and not (getattr(info, 'st_file_attributes', 0) & 0x400), 'Linked evidence refused')
    require(current.is_file() and current.stat().st_size <= MAX_ARCHIVE, 'Evidence file too large or not regular')
    return current.read_bytes()


def untar(raw):
    members = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        total = 0
        for info in archive:
            name = safe_name(info.name)
            require(info.isfile() and not info.issym() and not info.islnk(), 'Non-regular archive member')
            require(name not in members and 0 <= info.size <= MAX_FILE, 'Duplicate/oversized archive member')
            total += info.size
            require(total <= MAX_ARCHIVE, 'Archive exceeds bounded export size')
            members[name] = archive.extractfile(info).read()
            require(len(members[name]) == info.size, 'Truncated archive member')
    return members


def load_base(root, expected_index_digest=BASE_INDEX_DIGEST):
    index_bytes = source(root, 'accepted-deliverables.json')
    require(sha(index_bytes) == expected_index_digest, 'Original 25-item index changed')
    index = json.loads(index_bytes)
    require(index['archive'] == 'accepted-deliverables.tar.gz', 'Unexpected original archive')
    archive_bytes = source(root, index['archive'])
    require(sha(archive_bytes) == index['digest'] and len(archive_bytes) == index['bytes'], 'Original archive digest differs')
    files = untar(archive_bytes)
    require(sha(files['manifest.json']) == index['manifestDigest'], 'Original manifest digest differs')
    manifest = json.loads(files['manifest.json'])
    ids = [row['sampleId'] for row in manifest['samples']]
    require(len(set(ids)) == len(ids) and sorted(ids) == sorted(index['sampleIds']), 'Original sample set differs')
    require(len(ids) == index['acceptedCandidates'] == manifest['acceptedCandidates'], 'Original accepted count differs')
    selected = set()
    for row in manifest['samples']:
        for entry in row['files']:
            name = safe_name(entry['archivePath'])
            require(name.startswith(row['sampleId'] + '/') and name not in selected, 'Original sample member collision')
            selected.add(name)
            require(sha(files[name]) == entry['digest'] and len(files[name]) == entry['bytes'], 'Original file bytes changed')
    require(set(files) == selected | {'manifest.json', 'README.txt'}, 'Unindexed original archive members')
    return index_bytes, archive_bytes, manifest, files


def verified_state():
    # Existing verifiers only inspect archived evidence. No test runner/candidate.
    script = '''import {pathToFileURL} from "node:url";
const root=process.argv[1];
const m=await import(pathToFileURL(root+"/packages/cli/scripts/verify01-native-retest-plan.mjs"));
const state=m.loadVerifiedNativeAcceptedSamples({repositoryRoot:root});
const base=m.loadVerifiedNativeAcceptedSamples({repositoryRoot:root,priorRounds:[]});
console.log(JSON.stringify({acceptedIds:[...state.acceptedIds].sort(),baseAcceptedIds:[...base.acceptedIds].sort(),priorRounds:state.priorRounds,latest:state.latest,baselineEvidence:state.baselineEvidence}));'''
    result = subprocess.run(['node', '--input-type=module', '-e', script, str(TREE)],
                            cwd=TREE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    require(result.returncode == 0, 'Strict full-chain verification failed; no export permitted')
    return json.loads(result.stdout)


def archived(root, ref):
    stored = source(root, ref['path'])
    require(sha(stored) == ref['storedDigest'], 'Stored evidence digest differs')
    with gzip.GzipFile(fileobj=io.BytesIO(stored)) as stream:
        raw = stream.read(MAX_FILE + 1)
    require(len(raw) <= MAX_FILE and len(raw) == ref['originalBytes'] and sha(raw) == ref['originalDigest'], 'Raw evidence digest/length differs')
    return raw


def add(files, name, raw):
    safe_name(name)
    require(name not in files, 'Export member collision')
    require(len(raw) <= MAX_FILE, 'Export member too large')
    files[name] = raw


def prepare(round_name, state, root=None, base_digest=BASE_INDEX_DIGEST):
    root = root or TREE / EVIDENCE
    require(re.fullmatch(r'next-package-[a-z0-9][a-z0-9-]{0,70}', round_name), 'Explicit round name required')
    chain = state['priorRounds']
    require(chain and pathlib.PurePosixPath(chain[-1]['ledgerPath']).name == round_name + '.json', 'Export name must match completed chain tail')
    index_bytes, archive_bytes, original, original_files = load_base(root, base_digest)
    require(sorted(row['sampleId'] for row in original['samples']) == state['baseAcceptedIds'], 'Original pack differs from strictly verified base acceptance')
    files = {name: raw for name, raw in original_files.items() if name not in ('manifest.json', 'README.txt')}
    add(files, 'base/accepted-deliverables.json', index_bytes)
    add(files, 'base/accepted-deliverables.tar.gz', archive_bytes)
    add(files, 'base/manifest.json', original_files['manifest.json'])
    add(files, 'base/README.txt', original_files['README.txt'])
    items = copy.deepcopy(original['samples'])
    accepted_ids = set(state['baseAcceptedIds'])
    for reference in chain:
        def round_source(file, expected):
            require(file.startswith(EVIDENCE + '/'), 'Round evidence outside fixed root')
            raw = source(root, file[len(EVIDENCE) + 1:])
            require(sha(raw) == expected, 'Verified round changed during export')
            return raw
        plan_raw = round_source(reference['planPath'], reference['planDigest'])
        ledger_raw = round_source(reference['ledgerPath'], reference['ledgerDigest'])
        plan, ledger = json.loads(plan_raw), json.loads(ledger_raw)
        require(ledger['status'] == 'COMPLETED' and ledger['planDigest'] == reference['planDigest'], 'Incomplete or rebound round')
        require(ledger['frozenProjectCommit'] == original['frozenProjectCommit'], 'Frozen project differs')
        stem = pathlib.PurePosixPath(reference['ledgerPath']).stem
        add(files, f'round-evidence/{stem}/plan.json', plan_raw)
        add(files, f'round-evidence/{stem}/ledger.json', ledger_raw)
        for sample in ledger['samples']:
            if sample.get('candidateAcceptancePassed') is not True:
                continue
            sample_id = sample['sampleId']
            require(sample_id not in accepted_ids, 'Accepted sample would be replaced')
            accepted_ids.add(sample_id)
            runs = [run for run in ledger['runs'] if run['runId'] == sample['generationRunId']]
            require(len(runs) == 1 and runs[0]['status'] == 'COMPLETED', 'Accepted run not complete/unique')
            run = runs[0]
            generation_raw = archived(root, run['generation']['rawSummary'])
            acceptance_raw = archived(root, run['acceptance']['rawSummary'])
            generation, acceptance = json.loads(generation_raw), json.loads(acceptance_raw)
            native = next(row for row in generation['samples'] if row['sampleId'] == sample_id)
            checked = next(row for row in acceptance['samples'] if row['sampleId'] == sample_id)
            require(checked['candidateAcceptancePassed'] is True and sample['endToEndPassed'] == checked['passed'], 'Acceptance or native verdict differs')
            require(generation['versions'] == ledger['versions'] == acceptance['versions'], 'Exact package versions differ')
            refs = {(row['stage'], row['originalArtifactPath']): row['archived'] for row in run['evidence']}
            require(len(refs) == len(run['evidence']), 'Duplicate evidence mapping')
            item = {'sampleId': sample_id, 'taskId': sample['taskId'], 'kind': sample['kind'], 'group': sample['group'],
                    'provenance': 'strict-completed-retest-round', 'roundLedger': reference['ledgerPath'], 'roundLedgerDigest': reference['ledgerDigest'],
                    'versions': ledger['versions'], 'packageSetDigest': ledger['packageSetDigest'],
                    'generationRun': run['runId'], 'acceptanceRun': run['runId'], 'sourceCommit': run['sourceCommit'],
                    'generationPassed': sample['generationPassed'], 'candidateAcceptancePassed': True,
                    'endToEndPassed': sample['endToEndPassed'], 'files': []}
            selected = [('generation', row['path'], sample_id + '/files/' + row['file'], row['digest']) for row in native['candidates']]
            for stage in ('setup', 'check'):
                receipt = checked[stage]
                require(receipt['pass'] is True, 'Accepted candidate has failed receipt')
                selected.append(('acceptance', receipt['receiptPath'], sample_id + '/receipts/' + stage + '.json', receipt['receiptDigest']))
            for stage, member, name, expected in selected:
                ref = refs[(stage, member)]
                raw = archived(root, ref)
                require(sha(raw) == expected, 'Candidate or receipt digest differs')
                add(files, name, raw)
                item['files'].append({'archivePath': name, 'digest': sha(raw), 'bytes': len(raw), 'sourceEvidencePath': ref['path']})
            add(files, sample_id + '/evidence/generation-summary.json', generation_raw)
            add(files, sample_id + '/evidence/acceptance-summary.json', acceptance_raw)
            items.append(item)
    require(sorted(accepted_ids) == state['acceptedIds'], 'Export must exactly cover strictly verified accepted IDs')
    manifest = {'schema': 'chainlesschain.accepted-native-deliverable-export/v2', 'roundName': round_name,
                'frozenProjectCommit': original['frozenProjectCommit'], 'priorRounds': chain,
                'baseIndexDigest': sha(index_bytes), 'baseArchiveDigest': sha(archive_bytes),
                'acceptedCandidates': len(items), 'baseAcceptedCandidates': len(original['samples']),
                'newAcceptedCandidates': len(items) - len(original['samples']),
                'latestPackageVersions': state['latest']['versions'], 'latestPackageSetDigest': state['latest']['packageSetDigest'],
                'scope': 'Original accepted bytes and independent acceptance receipts only. Native end-to-end verdicts remain unchanged. Packaging is not task execution or acceptance.',
                'samples': items}
    add(files, 'manifest.json', encode(manifest))
    add(files, 'README.txt', ('Apply each sample/files subtree independently to frozen project ' + original['frozenProjectCommit'] + '.\n'
        'The original 25-item archive/index are preserved byte-for-byte under base/.\n'
        'Acceptance receipts are existing offline checker results. Per-sample exact versions and native endToEndPassed remain in manifest.json.\n'
        'No models, candidates, tests or Docker were run by this export. Packaging does not establish task success.\n').encode())
    return manifest, files


def pack_bytes(round_name, manifest, files):
    require(sum(map(len, files.values())) <= MAX_ARCHIVE, 'Export exceeds bounded size')
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for name, raw in sorted(files.items()):
            info = tarfile.TarInfo(safe_name(name))
            info.size, info.mode, info.mtime = len(raw), 0o644, 0
            archive.addfile(info, io.BytesIO(raw))
    raw = gzip.compress(output.getvalue(), compresslevel=9, mtime=0)
    require(untar(raw) == files, 'Export TAR readback differs')
    index = {'schema': 'chainlesschain.accepted-native-export-index/v2', 'archive': round_name + '-accepted-deliverables.tar.gz',
             'digest': sha(raw), 'bytes': len(raw), 'manifestDigest': sha(files['manifest.json']),
             'acceptedCandidates': manifest['acceptedCandidates'], 'baseAcceptedCandidates': manifest['baseAcceptedCandidates'],
             'newAcceptedCandidates': manifest['newAcceptedCandidates'], 'sampleIds': [row['sampleId'] for row in manifest['samples']],
             'baseIndexDigest': manifest['baseIndexDigest'], 'baseArchiveDigest': manifest['baseArchiveDigest'],
             'priorRounds': manifest['priorRounds']}
    return encode(index), raw


def publish_exclusive(parent, round_name, index, archive):
    require(re.fullmatch(r'next-package-[a-z0-9][a-z0-9-]{0,70}', round_name), 'Unsafe export name')
    # This workspace helper publishes on Windows, where rename refuses an
    # existing destination. Do not silently use POSIX rename's replace behavior.
    require(os.name == 'nt', 'Atomic no-replace publication requires this Windows workspace')
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / round_name
    require(not target.exists(), 'Round export already exists; never overwrite')
    # Exclusive reservation prevents concurrent exporters from publishing the
    # same name. A crash leaves the reservation for manual inspection, not retry.
    reservation = parent / (round_name + '.intent')
    with reservation.open('xb') as marker:
        marker.write(encode({'roundName': round_name, 'indexDigest': sha(index), 'archiveDigest': sha(archive)}))
        marker.flush()
        os.fsync(marker.fileno())
    staging = pathlib.Path(tempfile.mkdtemp(prefix=round_name + '.pending-', dir=parent))
    try:
        for name, raw in [(round_name + '-accepted-deliverables.json', index), (round_name + '-accepted-deliverables.tar.gz', archive)]:
            with (staging / name).open('xb') as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
        require(not target.exists(), 'Output appeared during export')
        staging.rename(target)
    finally:
        # Only our verified staging directory can be cleaned; published paths
        # and original evidence are never removed or replaced.
        if staging.exists():
            require(staging.parent.resolve() == parent.resolve() and staging.name.startswith(round_name + '.pending-'), 'Unexpected staging path')
            shutil.rmtree(staging)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--round-name', required=True)
    parser.add_argument('--pack', action='store_true', help='Explicitly create a new exclusive export; default is preview only')
    args = parser.parse_args()
    state = verified_state()
    manifest, files = prepare(args.round_name, state)
    result = {'mode': 'PREVIEW_ONLY', 'roundName': args.round_name, 'acceptedCandidates': manifest['acceptedCandidates'],
              'baseAcceptedCandidates': manifest['baseAcceptedCandidates'], 'newAcceptedCandidates': manifest['newAcceptedCandidates'],
              'members': len(files), 'bytesBeforeCompression': sum(map(len, files.values()))}
    if args.pack:
        index, archive = pack_bytes(args.round_name, manifest, files)
        target = publish_exclusive(WORK / 'accepted-round-exports', args.round_name, index, archive)
        result.update(mode='PACKAGED_EXISTING_EVIDENCE', directory=str(target), archiveDigest=sha(archive))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if type(error) is RuntimeError else 'Offline export stopped; no acceptance claim changed', file=sys.stderr)
        sys.exit(1)
