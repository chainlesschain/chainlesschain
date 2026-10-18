"""Offline release binding and no-clobber regressions. Run with python -B."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent
REPOSITORY = SCRIPTS.parents[2]
PREVIOUS = 'docs/research/cli/verify01-package-sets/2026-10-18-latest.json'
NEW = 'docs/research/cli/verify01-package-sets/readback-test-only.json'
CHECK_OUTPUT = subprocess.check_output


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), SCRIPTS / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class PublicReadbackBindingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='public-readback-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = CHECK_OUTPUT(['git', 'rev-parse', 'HEAD'], cwd=REPOSITORY).decode().strip()
        self.previous = CHECK_OUTPUT(['git', 'show', 'HEAD:' + PREVIOUS], cwd=REPOSITORY)
        previous = self.root / PREVIOUS
        previous.parent.mkdir(parents=True)
        previous.write_bytes(self.previous)
        self.options = SimpleNamespace(source_commit=self.source, new_manifest=NEW,
            previous_manifest=PREVIOUS, cli_readback=str(self.root / 'cli'),
            vscode_readback=str(self.root / 'vscode'), vscode_run_id=101, vscode_artifact_id=202)
        self.cli = module('verify-public-cli')
        self.shared = self.cli.shared
        self.shared.TREE = self.root
        # All Git reads still resolve real immutable objects in this worktree;
        # only manifest writes are redirected into an isolated OS temp directory.
        def git_read(args, **kwargs):
            if kwargs.get('cwd') == self.root:
                kwargs['cwd'] = REPOSITORY
            kwargs.setdefault('stderr', subprocess.PIPE)
            return CHECK_OUTPUT(args, **kwargs)
        self.git = patch.object(subprocess, 'check_output', side_effect=git_read)
        self.git.start()
        self.addCleanup(self.git.stop)
        self.cli.initialize(self.options)

    def cli_bytes(self):
        package = json.loads(self.shared.git_bytes(self.source, 'packages/cli/package.json'))
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            for name in ['package.json', *self.shared.SOURCE_FILES]:
                raw = self.shared.git_bytes(self.source, 'packages/cli/' + name)
                entry = tarfile.TarInfo('package/' + name)
                entry.size = len(raw)
                archive.addfile(entry, io.BytesIO(raw))
        tarball = stream.getvalue()
        metadata = {**package, 'gitHead': self.source, 'dist': {
            'tarball': self.cli.TARBALL_URL,
            'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(tarball).digest()).decode(),
            'shasum': hashlib.sha1(tarball).hexdigest()}}
        return self.shared.encoded(metadata), tarball

    def test_cli_can_verify_first_without_ide_receipts_or_a_new_manifest(self):
        metadata, tarball = self.cli_bytes()
        responses = {self.cli.METADATA_URL: metadata, self.cli.TARBALL_URL: tarball}
        def download(url, target, maximum):
            raw = responses[url]
            self.assertLessEqual(len(raw), maximum)
            return raw, {**self.shared.write_new(target.parent, target.name, raw),
                'url': url, 'finalUrlWithoutQuery': url, 'httpStatus': 200}
        with patch.object(self.shared, 'download', side_effect=download):
            result, code = self.cli.resolve(self.root / 'cli')
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'VERIFIED_PUBLIC_CLI_ONLY')
        self.assertFalse((self.root / NEW).exists())
        self.assertFalse((self.root / 'vscode').exists())
        self.assertEqual((self.root / PREVIOUS).read_bytes(), self.previous)
        receipt_path = self.root / 'cli/readback.json'
        receipt = json.loads(receipt_path.read_bytes())
        for mutate in [lambda r: r.pop('releaseBinding'),
                       lambda r: r['releaseBinding'].update(releaseSourceCommit='f' * 40),
                       lambda r: r['releaseBinding']['versions'].update(cli='0.0.0')]:
            changed = copy.deepcopy(receipt)
            mutate(changed)
            receipt_path.write_bytes(self.shared.encoded(changed))
            with self.assertRaisesRegex(ValueError, 'binding mismatch'):
                self.cli.verify_offline(self.root / 'cli')

    def test_missing_revision_alias_short_or_nonexistent_sha_fails_closed(self):
        for source in [None, 'HEAD', self.source[:12], '0' * 40]:
            with self.subTest(source=source):
                options = copy.copy(self.options)
                options.source_commit = source
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    self.shared.configure(options)

    def test_registry_githead_and_sri_remain_bound_to_source_and_bytes(self):
        metadata, tarball = self.cli_bytes()
        checks = self.cli.inspect(metadata, tarball)
        self.assertTrue(checks['sriVerified'])
        changed = json.loads(metadata)
        changed['gitHead'] = 'f' * 40
        with self.assertRaisesRegex(ValueError, 'gitHead mismatch'):
            self.cli.inspect(self.shared.encoded(changed), tarball)
        changed['gitHead'] = self.source
        changed['dist']['integrity'] = 'sha512-' + base64.b64encode(b'x' * 64).decode()
        with self.assertRaisesRegex(ValueError, 'SRI mismatch'):
            self.cli.inspect(self.shared.encoded(changed), tarball)

    def test_previous_manifest_and_existing_new_manifest_cannot_be_overwritten(self):
        options = copy.copy(self.options)
        options.new_manifest = PREVIOUS
        with self.assertRaisesRegex(ValueError, 'cannot overwrite previous'):
            self.shared.configure(options)
        self.shared.publish_manifest(b'new immutable manifest\n')
        with self.assertRaises(FileExistsError):
            self.shared.publish_manifest(b'replacement\n')
        self.assertEqual((self.root / NEW).read_bytes(), b'new immutable manifest\n')
        self.assertEqual((self.root / PREVIOUS).read_bytes(), self.previous)
        with self.assertRaisesRegex(ValueError, 'new manifest already exists'):
            self.shared.evidence_directory(str(self.root / 'fresh'), fresh=True)
        self.assertFalse((self.root / 'fresh').exists())

    def test_changed_previous_manifest_and_paths_outside_controlled_directory_are_rejected(self):
        for path in ['outside.json', '../previous.json', NEW.replace('readback-test-only.json', '../escape.json')]:
            options = copy.copy(self.options)
            options.new_manifest = path
            with self.assertRaisesRegex(ValueError, 'direct JSON file'):
                self.shared.configure(options)
        (self.root / PREVIOUS).write_bytes(self.previous + b' ')
        with self.assertRaisesRegex(ValueError, 'committed bytes'):
            self.shared.configure(self.options)
        with self.assertRaisesRegex(ValueError, 'previous manifest changed'):
            self.shared.publish_manifest(b'new\n')
        self.assertFalse((self.root / NEW).exists())

    def test_three_package_stage_requires_both_receipts_with_the_same_binding(self):
        with self.assertRaises(FileNotFoundError):
            self.shared.verify_prerequisites()
        for name, status in [('cli', 'VERIFIED_PUBLIC_CLI_ONLY'), ('vscode', 'VERIFIED_PUBLIC_VSCODE_ONLY')]:
            (self.root / name).mkdir()
            binding = copy.deepcopy(self.shared.BINDING)
            if name == 'vscode':
                binding['releaseSourceCommit'] = 'f' * 40
            (self.root / name / 'readback.json').write_bytes(self.shared.encoded(
                {'status': status, 'releaseBinding': binding}))
        with self.assertRaisesRegex(ValueError, 'same full source'):
            self.shared.verify_prerequisites()
        self.assertFalse((self.root / NEW).exists())

    def test_cli_entrypoint_requires_all_binding_inputs_before_io(self):
        result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'verify-public-cli.py'),
                                 '--readback-dir', str(self.root / 'not-created')],
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / 'not-created').exists())


if __name__ == '__main__':
    unittest.main()
