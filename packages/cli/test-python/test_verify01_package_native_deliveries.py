"""Offline synthetic export tests; never creates an actual campaign package."""
import contextlib
import copy
import gzip
import importlib.util
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('packer', pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'verify01-package-native-deliveries.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def tar_bytes(files):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz') as archive:
        for name, raw in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(raw)
            archive.addfile(info, io.BytesIO(raw))
    return buf.getvalue()


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.versions = {'cli': '0.166.105', 'vscode': '0.37.150', 'jetbrains': '0.4.167'}
        candidate = b'original accepted bytes\n'
        entry = {'archivePath': 'verify-01/files/task.js', 'digest': m.sha(candidate), 'bytes': len(candidate)}
        self.original = {'frozenProjectCommit': 'a' * 40, 'acceptedCandidates': 1,
                         'samples': [{'sampleId': 'verify-01', 'endToEndPassed': False, 'versions': {'cli': '0.166.99'}, 'files': [entry]}]}
        files = {'verify-01/files/task.js': candidate, 'manifest.json': m.encode(self.original), 'README.txt': b'original notes'}
        self.archive = tar_bytes(files)
        index = {'archive': 'accepted-deliverables.tar.gz', 'digest': m.sha(self.archive), 'bytes': len(self.archive),
                 'manifestDigest': m.sha(files['manifest.json']), 'sampleIds': ['verify-01'], 'acceptedCandidates': 1}
        self.index = m.encode(index)
        (self.root / 'accepted-deliverables.json').write_bytes(self.index)
        (self.root / 'accepted-deliverables.tar.gz').write_bytes(self.archive)
        self.plan = {'ledgerPath': m.EVIDENCE + '/next-package-105.json'}
        plan_raw = m.encode(self.plan)
        (self.root / 'next-package-105-plan.json').write_bytes(plan_raw)
        self.reference = {'planPath': m.EVIDENCE + '/next-package-105-plan.json', 'planDigest': m.sha(plan_raw),
                          'ledgerPath': self.plan['ledgerPath'], 'ledgerDigest': ''}
        def archived(raw):
            stored = gzip.compress(raw, mtime=0)
            path = m.sha(raw)[7:] + '.gz'
            (self.root / path).write_bytes(stored)
            return {'path': path, 'originalDigest': m.sha(raw), 'storedDigest': m.sha(stored), 'originalBytes': len(raw)}
        self.new_candidate = b'new independently accepted bytes\n'
        setup, check = b'{"pass":true,"stage":"setup"}', b'{"pass":true,"stage":"check"}'
        native = {'sampleId': 'verify-02', 'candidates': [{'path': 'verify-02/candidate/task.js', 'file': 'task.js', 'digest': m.sha(self.new_candidate)}]}
        checked = {'sampleId': 'verify-02', 'candidateAcceptancePassed': True, 'passed': False,
                   'setup': {'pass': True, 'receiptPath': 'setup.json', 'receiptDigest': m.sha(setup)},
                   'check': {'pass': True, 'receiptPath': 'check.json', 'receiptDigest': m.sha(check)}}
        run = {'runId': '123', 'status': 'COMPLETED', 'sourceCommit': 'b' * 40,
               'generation': {'rawSummary': archived(m.encode({'versions': self.versions, 'samples': [native]}))},
               'acceptance': {'rawSummary': archived(m.encode({'versions': self.versions, 'samples': [checked]}))},
               'evidence': [{'stage': stage, 'originalArtifactPath': name, 'archived': archived(raw)} for stage, name, raw in
                            [('generation', native['candidates'][0]['path'], self.new_candidate), ('acceptance', 'setup.json', setup), ('acceptance', 'check.json', check)]]}
        self.ledger = {'status': 'COMPLETED', 'planDigest': m.sha(plan_raw), 'frozenProjectCommit': 'a' * 40,
                       'versions': self.versions, 'packageSetDigest': 'sha256:' + 'c' * 64, 'runs': [run],
                       'samples': [{'sampleId': 'verify-02', 'taskId': 'verify-02', 'kind': 'task', 'group': 'win32-jetbrains',
                                    'generationRunId': '123', 'candidateAcceptancePassed': True, 'endToEndPassed': False, 'generationPassed': False}]}
        self.state = {'priorRounds': [self.reference], 'baseAcceptedIds': ['verify-01'], 'acceptedIds': ['verify-01', 'verify-02'], 'latest': self.ledger}
        self.refresh()

    def refresh(self):
        raw = m.encode(self.ledger)
        self.reference['ledgerDigest'] = m.sha(raw)
        (self.root / 'next-package-105.json').write_bytes(raw)

    def prepare(self):
        return m.prepare('next-package-105', self.state, self.root, m.sha(self.index))

    def test_exact_old_bytes_new_receipts_and_native_failure_preserved(self):
        manifest, files = self.prepare()
        self.assertEqual(manifest['samples'][0], self.original['samples'][0])
        self.assertEqual(files['base/accepted-deliverables.tar.gz'], self.archive)
        self.assertEqual(files['base/accepted-deliverables.json'], self.index)
        self.assertEqual(files['verify-02/files/task.js'], self.new_candidate)
        self.assertFalse(manifest['samples'][1]['endToEndPassed'])
        self.assertFalse(manifest['samples'][1]['generationPassed'])
        self.assertEqual(manifest['samples'][1]['versions'], self.versions)
        index, archive = m.pack_bytes('next-package-105', manifest, files)
        self.assertEqual(m.untar(archive), files)
        self.assertEqual(json.loads(index)['newAcceptedCandidates'], 1)

    def test_changed_digest_incomplete_and_missing_acceptance_are_refused(self):
        saved = copy.deepcopy(self.ledger)
        for mutate in [lambda: self.ledger.update(status='IN_PROGRESS'),
                       lambda: self.ledger['samples'][0].update(candidateAcceptancePassed=False),
                       lambda: self.ledger['runs'][0]['evidence'][0]['archived'].update(storedDigest='bad')]:
            self.ledger = copy.deepcopy(saved)
            mutate()
            self.refresh()
            with self.assertRaises(RuntimeError):
                self.prepare()
        self.ledger = copy.deepcopy(saved)
        self.refresh()
        self.reference['ledgerDigest'] = 'sha256:' + '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'changed during export'):
            self.prepare()

    def test_original_index_and_archive_are_not_replaceable(self):
        (self.root / 'accepted-deliverables.json').write_bytes(self.index + b' ')
        with self.assertRaisesRegex(RuntimeError, 'index changed'):
            self.prepare()
        (self.root / 'accepted-deliverables.json').write_bytes(self.index)
        (self.root / 'accepted-deliverables.tar.gz').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'digest differs'):
            self.prepare()

    def test_wrong_tail_and_duplicate_accepted_sample_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'tail'):
            m.prepare('next-package-other', self.state, self.root, m.sha(self.index))
        self.ledger['samples'][0]['sampleId'] = 'verify-01'
        self.refresh()
        with self.assertRaisesRegex(RuntimeError, 'replaced'):
            self.prepare()

    def test_default_preview_does_not_pack_or_write(self):
        manifest, files = self.prepare()
        with patch.object(m, 'verified_state', return_value=self.state), \
             patch.object(m, 'prepare', return_value=(manifest, files)), \
             patch.object(m, 'pack_bytes', side_effect=AssertionError('preview packed')), \
             patch.object(m.sys, 'argv', ['helper', '--round-name', 'next-package-105']), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            m.main()
        self.assertEqual(json.loads(out.getvalue())['mode'], 'PREVIEW_ONLY')

    @unittest.skipUnless(m.os.name == 'nt', 'Windows no-replace directory publication')
    def test_atomic_exclusive_output_preserves_existing_directory(self):
        manifest, files = self.prepare()
        index, archive = m.pack_bytes('next-package-105', manifest, files)
        parent = self.root / 'synthetic-exports'
        target = m.publish_exclusive(parent, 'next-package-105', index, archive)
        before = {p.name: p.read_bytes() for p in target.iterdir()}
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            m.publish_exclusive(parent, 'next-package-105', b'overwrite', b'overwrite')
        self.assertEqual(before, {p.name: p.read_bytes() for p in target.iterdir()})
        self.assertFalse(list(parent.glob('*.pending-*')))

    def test_tar_links_and_traversal_are_rejected(self):
        with self.assertRaises(RuntimeError):
            m.untar(tar_bytes({'../escape': b'bad'}))
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as archive:
            info = tarfile.TarInfo('link')
            info.type, info.linkname = tarfile.SYMTYPE, 'elsewhere'
            archive.addfile(info)
        with self.assertRaises(RuntimeError):
            m.untar(buf.getvalue())

    def test_clone_and_linked_worktree_preserve_shared_export_namespace(self):
        common = self.root / 'repo' / '.git'
        common.mkdir(parents=True)
        response = subprocess.CompletedProcess([], 0, (str(common) + '\n').encode(), b'')
        with patch.object(m.subprocess, 'run', return_value=response):
            primary = m.shared_work_directory(common.parent)
            linked = m.shared_work_directory(common.parent / '.worktrees' / 'other')
        self.assertEqual(primary, linked)
        self.assertEqual(primary, common.parent / '.work')
        self.assertEqual(m.TREE, pathlib.Path(__file__).resolve().parents[3])
        with patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'', b'private stderr')):
            with self.assertRaises(RuntimeError):
                m.shared_work_directory(self.root)


if __name__ == '__main__':
    unittest.main()
