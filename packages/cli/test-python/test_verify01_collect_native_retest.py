"""Offline checks for shard identity and preservation of collected evidence."""
import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest

script = Path(__file__).resolve().parents[1] / 'scripts/verify01-collect-native-retest.py'
spec = importlib.util.spec_from_file_location('native_retest_collector', script)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorContractTests(unittest.TestCase):
    def setUp(self):
        self.plan = {
            'groups': [{'group': 'win32-jetbrains', 'sampleIds': ['verify-12', 'verify-30']}],
            'executionShards': [
                {'shardId': 'win32-jetbrains--' + sample, 'group': 'win32-jetbrains', 'sampleIds': [sample]}
                for sample in ['verify-12', 'verify-30']],
        }
        self.bindings = [
            {'shardId': shard['shardId'], 'group': shard['group'], 'runId': str(index + 1),
             'sourceCommit': 'a' * 40}
            for index, shard in enumerate(self.plan['executionShards'])]

    def test_distinct_runs_for_same_native_group(self):
        result = collector.validate_bindings(self.bindings, self.plan)
        self.assertEqual(set(result), {row['shardId'] for row in self.bindings})

    def test_run_cannot_be_reused_by_two_shards(self):
        self.bindings[1]['runId'] = self.bindings[0]['runId']
        with self.assertRaises(AssertionError):
            collector.validate_bindings(self.bindings, self.plan)

    def test_overlapping_or_missing_samples_are_rejected(self):
        self.plan['executionShards'][1]['sampleIds'] = ['verify-12']
        with self.assertRaises(AssertionError):
            collector.validate_bindings(self.bindings, self.plan)

    def test_binding_cannot_change_native_group(self):
        self.bindings[1]['group'] = 'linux-jetbrains'
        with self.assertRaises(AssertionError):
            collector.validate_bindings(self.bindings, self.plan)

    def test_duplicate_shard_identity_is_rejected(self):
        self.plan['executionShards'].append(copy.deepcopy(self.plan['executionShards'][0]))
        with self.assertRaises(AssertionError):
            collector.validate_bindings(self.bindings, self.plan)

    def test_missing_properties_remain_distinct_from_null(self):
        sample = {'generationPassed': True, 'brokerStatus': 'old', 'host': 'old'}
        collector.copy_generation_fields(sample, {'host': None})
        self.assertNotIn('generationPassed', sample)
        self.assertNotIn('brokerStatus', sample)
        self.assertIsNone(sample['host'])

    def test_archive_never_replaces_different_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            collector.immutable(root, 'run/receipt.json', b'original')
            collector.immutable(root, 'run/receipt.json', b'original')
            with self.assertRaises(AssertionError):
                collector.immutable(root, 'run/receipt.json', b'changed')
            self.assertEqual((root / 'run/receipt.json').read_bytes(), b'original')

    def test_archive_paths_cannot_escape_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            for value in ['../receipt.json', '/receipt.json', 'C:receipt.json', 'run\\receipt.json']:
                with self.subTest(value=value), self.assertRaises(AssertionError):
                    collector.safe_file(Path(directory), value, create=True)


if __name__ == '__main__':
    unittest.main()
