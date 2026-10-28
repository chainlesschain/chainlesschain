"""Offline dispatcher regressions. No GitHub, public registry, or model calls."""
import copy
import importlib.util
import contextlib
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dispatcher', pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'verify01-dispatch-native-retest.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.shards = [{'shardId': 'win32-jetbrains--verify-' + str(i), 'group': 'win32-jetbrains', 'sampleIds': ['verify-' + str(i)]} for i in (1, 2)]
        self.context = {'sourceCommit': 'a' * 40, 'branch': 'feature/evaluation',
                        'packageSetPath': 'docs/next.json', 'executionShards': self.shards,
                        'planDigest': 'sha256:' + 'b' * 64, 'packageSetDigest': 'sha256:' + 'c' * 64}
        self.old_head, self.old_runs = m.assert_remote_head, m.list_runs
        self.addCleanup(setattr, m, 'assert_remote_head', self.old_head)
        self.addCleanup(setattr, m, 'list_runs', self.old_runs)
        m.assert_remote_head = lambda context: None
        self.runs, self.calls = [], []
        m.list_runs = lambda context: list(self.runs)

    def dispatch(self, args):
        self.assertTrue((self.directory / (self.shards[len(self.calls)]['shardId'] + '.intent.json')).exists())
        self.calls.append(args)
        run = {'id': len(self.calls) + 100}
        self.runs.append(run)
        return subprocess.CompletedProcess(args, 0, f'https://github.com/chainlesschain/chainlesschain/actions/runs/{run["id"]}\n'.encode(), b'')

    def test_two_shards_same_group_exactly_once_and_mapping(self):
        result = m.execute(self.context, self.directory, submit=True, dispatch=self.dispatch)
        self.assertEqual(result['status'], 'RESOLVED')
        self.assertEqual([row['runId'] for row in result['runs']], ['101', '102'])
        self.assertEqual(len(self.calls), 2)
        self.assertIn('sample_ids=verify-1', self.calls[0])
        self.assertIn('sample_ids=verify-2', self.calls[1])
        m.execute(self.context, self.directory, submit=True, dispatch=self.dispatch)
        self.assertEqual(len(self.calls), 2)

    def test_uncertain_request_never_resent_and_readonly_resolve(self):
        def timeout(args):
            self.calls.append(args)
            self.runs.append({'id': 99})
            raise subprocess.TimeoutExpired(args, 120)
        with self.assertRaisesRegex(RuntimeError, 'intent retained'):
            m.execute(self.context, self.directory, submit=True, dispatch=timeout)
        with self.assertRaisesRegex(RuntimeError, 'Unresolved intent'):
            m.execute(self.context, self.directory, submit=True, dispatch=timeout)
        self.assertEqual(len(self.calls), 1)
        result = m.execute(self.context, self.directory, resolve=True, dispatch=lambda args: self.fail('resolve must not dispatch'))
        self.assertEqual(result['status'], 'INCOMPLETE')
        resolved = json.loads((self.directory / (self.shards[0]['shardId'] + '.resolved.json')).read_bytes())
        self.assertEqual(resolved['runId'], '99')

    def test_limited_batches_resume_without_changing_context_or_replaying(self):
        self.shards.append({'shardId': 'win32-jetbrains--verify-3',
                            'group': 'win32-jetbrains', 'sampleIds': ['verify-3']})
        original = copy.deepcopy(self.context)
        first = m.execute(self.context, self.directory, submit=True,
                          dispatch=self.dispatch, max_new_dispatches=1)
        self.assertEqual(first['status'], 'INCOMPLETE')
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.directory / 'runs.json').exists())
        for shard in self.shards[1:]:
            self.assertFalse((self.directory / (shard['shardId'] + '.intent.json')).exists())
        first_intent = self.directory / (self.shards[0]['shardId'] + '.intent.json')
        before = first_intent.read_bytes()

        # Read-only resolution does not fill the remaining unrequested shards.
        result = m.execute(self.context, self.directory, resolve=True,
                           dispatch=lambda args: self.fail('resolve must not dispatch'))
        self.assertEqual(result['status'], 'INCOMPLETE')
        second = m.execute(self.context, self.directory, submit=True,
                           dispatch=self.dispatch, max_new_dispatches=1)
        self.assertEqual(second['status'], 'INCOMPLETE')
        self.assertEqual(len(self.calls), 2)
        self.assertEqual(first_intent.read_bytes(), before)
        self.assertFalse((self.directory / (self.shards[2]['shardId'] + '.intent.json')).exists())
        self.assertFalse((self.directory / 'runs.json').exists())

        final = m.execute(self.context, self.directory, submit=True,
                          dispatch=self.dispatch, max_new_dispatches=2)
        self.assertEqual(final['status'], 'RESOLVED')
        self.assertEqual([row['runId'] for row in final['runs']], ['101', '102', '103'])
        self.assertEqual(json.loads((self.directory / 'runs.json').read_bytes()), final['runs'])
        self.assertEqual(self.context, original)
        self.assertEqual(json.loads((self.directory / 'context.json').read_bytes()), original)
        snapshot = {file.name: file.read_bytes() for file in self.directory.glob('*.json')}
        m.execute(self.context, self.directory, submit=True,
                  dispatch=self.dispatch, max_new_dispatches=1)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(snapshot, {file.name: file.read_bytes() for file in self.directory.glob('*.json')})

    def test_limited_uncertain_dispatch_still_requires_readonly_resolution(self):
        def uncertain(args):
            self.calls.append(args)
            self.runs.append({'id': 99})
            raise subprocess.TimeoutExpired(args, 120)
        with self.assertRaisesRegex(RuntimeError, 'intent retained'):
            m.execute(self.context, self.directory, submit=True,
                      dispatch=uncertain, max_new_dispatches=1)
        with self.assertRaisesRegex(RuntimeError, 'Unresolved intent'):
            m.execute(self.context, self.directory, submit=True,
                      dispatch=uncertain, max_new_dispatches=2)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.directory / (self.shards[1]['shardId'] + '.intent.json')).exists())
        m.execute(self.context, self.directory, resolve=True,
                  dispatch=lambda args: self.fail('resolve must not dispatch'))
        final = m.execute(self.context, self.directory, submit=True,
                          dispatch=self.dispatch, max_new_dispatches=1)
        self.assertEqual([row['runId'] for row in final['runs']], ['99', '102'])
        self.assertEqual(len(self.calls), 2)

    def test_invalid_limits_fail_before_journal_or_dispatch(self):
        for value in (0, -1, 1.5, True, '1'):
            with self.subTest(value=value):
                target = self.directory / 'must-not-exist'
                with self.assertRaisesRegex(RuntimeError, 'positive integer'):
                    m.execute(self.context, target, submit=True, max_new_dispatches=value,
                              dispatch=lambda args: self.fail('invalid limit dispatched'))
                self.assertFalse(target.exists())
        with self.assertRaisesRegex(RuntimeError, 'requires --submit'):
            m.execute(self.context, self.directory / 'must-not-exist',
                      resolve=True, max_new_dispatches=1)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_cli_invalid_limits_and_modes_fail_before_context_loading(self):
        for arguments in (['--submit', '--max-new-dispatches', '0'],
                          ['--submit', '--max-new-dispatches', '-1'],
                          ['--submit', '--max-new-dispatches', '1.5'],
                          ['--resolve', '--max-new-dispatches', '1'],
                          ['--max-new-dispatches', '1']):
            with self.subTest(arguments=arguments), \
                 patch.object(m, 'load_context', side_effect=AssertionError('invalid CLI loaded context')), \
                 patch.object(m.sys, 'argv', ['dispatcher', '--plan', 'docs/plan.json', *arguments]), \
                 contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as exit:
                    m.main()
                self.assertEqual(exit.exception.code, 2)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_cli_forwards_limit_without_changing_bound_context(self):
        original = copy.deepcopy(self.context)
        with patch.object(m, 'load_context', return_value=(self.context, {})), \
             patch.object(m, 'WORK', self.directory), \
             patch.object(m, 'verify_public') as verify, \
             patch.object(m, 'execute', return_value={'status': 'INCOMPLETE'}) as execute, \
             patch.object(m.sys, 'argv', ['dispatcher', '--plan', 'docs/plan.json',
                                         '--submit', '--max-new-dispatches', '2']), \
             contextlib.redirect_stdout(io.StringIO()):
            m.main()
        verify.assert_called_once_with({})
        self.assertEqual(execute.call_args.args[0], original)
        self.assertEqual(execute.call_args.kwargs,
                         {'submit': True, 'resolve': False, 'max_new_dispatches': 2})
        self.assertEqual(self.context, original)

    def test_ambiguous_new_runs_halt_without_next_dispatch(self):
        def ambiguous(args):
            self.calls.append(args)
            self.runs.extend([{'id': 101}, {'id': 102}])
            return subprocess.CompletedProcess(args, 0, b'created', b'')
        with self.assertRaisesRegex(RuntimeError, 'ambiguous'):
            m.execute(self.context, self.directory, submit=True, dispatch=ambiguous,
                      max_new_dispatches=1)
        self.assertEqual(len(self.calls), 1)
        with self.assertRaisesRegex(RuntimeError, 'ambiguous'):
            m.execute(self.context, self.directory, resolve=True)
        self.assertFalse((self.directory / 'runs.json').exists())

    def test_failed_request_does_not_autoresolve_or_resubmit(self):
        def failed(args):
            self.calls.append(args)
            return subprocess.CompletedProcess(args, 1, b'', b'never persist potentially sensitive stderr')
        with self.assertRaisesRegex(RuntimeError, 'intent retained'):
            m.execute(self.context, self.directory, submit=True, dispatch=failed)
        with self.assertRaisesRegex(RuntimeError, 'Unresolved intent'):
            m.execute(self.context, self.directory, submit=True, dispatch=failed)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn(b'sensitive', b''.join(file.read_bytes() for file in self.directory.glob('*.json')))

    def test_branch_changes_after_intent_prevent_dispatch_and_leave_intent(self):
        checks = []
        def changing(context):
            checks.append(True)
            if len(checks) > 1:
                raise RuntimeError('Remote evaluation branch SHA changed')
        m.assert_remote_head = changing
        with self.assertRaisesRegex(RuntimeError, 'SHA changed'):
            m.execute(self.context, self.directory, submit=True, dispatch=lambda args: self.fail('changed branch must not dispatch'))
        self.assertTrue(list(self.directory.glob('*.intent.json')))

    def test_context_changes_cannot_reuse_journal(self):
        m.atomic_new(self.directory / 'context.json', self.context)
        changed = copy.deepcopy(self.context)
        changed['sourceCommit'] = 'd' * 40
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            m.execute(changed, self.directory, submit=True, dispatch=lambda args: self.fail('must not dispatch'))

    def test_readonly_resolution_survives_branch_movement_without_submitting(self):
        def failed(args):
            self.calls.append(args)
            self.runs.append({'id': 91})
            return subprocess.CompletedProcess(args, 1, b'', b'')
        with self.assertRaisesRegex(RuntimeError, 'intent retained'):
            m.execute(self.context, self.directory, submit=True, dispatch=failed)
        m.assert_remote_head = lambda context: self.fail('read-only resolve must not require current branch HEAD')
        result = m.execute(self.context, self.directory, resolve=True,
                           dispatch=lambda args: self.fail('read-only resolve must not dispatch'))
        self.assertEqual(result['status'], 'INCOMPLETE')
        self.assertEqual(len(self.calls), 1)
        record = json.loads((self.directory / (self.shards[0]['shardId'] + '.resolved.json')).read_bytes())
        self.assertEqual(record['runId'], '91')
        self.assertEqual(record['sourceCommit'], self.context['sourceCommit'])

    def test_resolution_loader_reuses_exact_journal_and_checks_committed_bindings(self):
        plan_file = 'docs/plan.json'
        raw = b'{"test":"original plan"}\n'
        target = self.directory / plan_file
        target.parent.mkdir()
        target.write_bytes(raw)
        bound = {**self.context, 'planPath': plan_file, 'planDigest': m.digest(raw), 'reviewChanges': True}
        journal = self.directory / 'next-package-dispatch' / m.digest(raw).split(':')[1]
        journal.mkdir(parents=True)
        m.atomic_new(journal / 'context.json', bound)
        base = {k:v for k,v in bound.items() if k != 'reviewChanges'}
        with patch.object(m, 'TREE', self.directory), patch.object(m, 'WORK', self.directory), \
             patch.object(m, 'load_context', return_value=(base.copy(), {})) as load:
            context, _ = m.load_resolution_context(plan_file)
            self.assertEqual(context, bound)
            load.assert_called_once_with(plan_file, resolution_context=bound)
        for field in ['sourceCommit', 'packageSetDigest', 'executionShards', 'branch']:
            changed = {**base, field: 'different'}
            with self.subTest(field=field), patch.object(m, 'TREE', self.directory), patch.object(m, 'WORK', self.directory), \
                 patch.object(m, 'load_context', return_value=(changed, {})):
                with self.assertRaisesRegex(RuntimeError, 'committed evidence'):
                    m.load_resolution_context(plan_file)
        target.write_bytes(b'{"test":"changed plan"}')
        with patch.object(m, 'TREE', self.directory), patch.object(m, 'WORK', self.directory), \
             patch.object(m, 'load_context', side_effect=AssertionError('must not load another plan')):
            with self.assertRaises(FileNotFoundError):
                m.load_resolution_context(plan_file)

    def test_resolution_cli_never_requires_current_remote_head_or_public_packages(self):
        with patch.object(m, 'load_resolution_context', return_value=(self.context, {})), \
             patch.object(m, 'WORK', self.directory), \
             patch.object(m, 'load_context', side_effect=AssertionError('must use original journal')), \
             patch.object(m, 'assert_remote_head', side_effect=AssertionError('branch may advance')), \
             patch.object(m, 'verify_public', side_effect=AssertionError('public version may advance')), \
             patch.object(m, 'execute', return_value={'status':'INCOMPLETE'}) as execute, \
             patch.object(m.sys, 'argv', ['dispatcher', '--plan', 'docs/plan.json', '--resolve']), \
             contextlib.redirect_stdout(io.StringIO()):
            m.main()
        self.assertEqual(execute.call_args.kwargs, {'submit':False,'resolve':True,'max_new_dispatches':None})

    def test_manifest_plan_and_eval_head_are_intent_bound(self):
        m.execute(self.context, self.directory, submit=True, dispatch=self.dispatch)
        intent = json.loads((self.directory / (self.shards[0]['shardId'] + '.intent.json')).read_bytes())
        self.assertEqual(intent['binding'], self.context)
        self.assertEqual(intent['shard'], self.shards[0])

    def test_shards_reject_accepted_overlap_missing_and_group_substitution(self):
        plan = {'groups': [{'group': 'win32-jetbrains', 'sampleIds': ['verify-1', 'verify-2']}],
                'executionShards': self.shards, 'reusedAcceptedSampleIds': [], 'plannedNewSamples': 2}
        self.assertEqual(len(m.validate_shards(plan)), 2)
        for mutate in [lambda p: p['executionShards'].pop(),
                       lambda p: p['reusedAcceptedSampleIds'].append('verify-1'),
                       lambda p: p['executionShards'][1].update(sampleIds=['verify-1']),
                       lambda p: p['executionShards'][1].update(group='linux-jetbrains'),
                       lambda p: p['executionShards'][1].update(shardId=p['executionShards'][0]['shardId'])]:
            bad = copy.deepcopy(plan)
            mutate(bad)
            with self.assertRaises(RuntimeError):
                m.validate_shards(bad)

    def test_response_url_disambiguates_only_new_run(self):
        intent = {'beforeRunIds': ['100']}
        runs = [{'id': 100}, {'id': 101}, {'id': 102}]
        self.assertEqual(m.unique_run(intent, runs, 'https://github.com/chainlesschain/chainlesschain/actions/runs/102'), '102')
        with self.assertRaises(RuntimeError):
            m.unique_run(intent, runs, 'https://github.com/chainlesschain/chainlesschain/actions/runs/100')

    def test_default_is_preview_and_cannot_dispatch_or_write_journal(self):
        with patch.object(m, 'load_context', return_value=(self.context, {})), \
             patch.object(m, 'WORK', self.directory), \
             patch.object(m, 'execute', side_effect=AssertionError('preview executed dispatch')), \
             patch.object(m.sys, 'argv', ['dispatcher', '--plan', 'docs/plan.json']), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            m.main()
        self.assertEqual(json.loads(output.getvalue())['mode'], 'PREVIEW_ONLY')
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_old_or_unapproved_public_versions_block_submit(self):
        manifest = {'versions': {'cli': '1.2.3', 'vscode': '2.3.4', 'jetbrains': '3.4.5'},
                    'origin': {'cli': {'integrity': 'digest', 'tarball': 'tarball'},
                               'vscode': {'download': 'vsix'}, 'jetbrains': {'updateId': 5, 'file': 'plugin.zip'}}}
        replies = [{'version': '1.2.3', 'dist': {'integrity': 'digest', 'tarball': 'tarball'}},
                   {'version': '2.3.4', 'files': {'download': 'vsix'}},
                   [{'version': '3.4.5', 'id': 5, 'file': 'plugin.zip', 'approve': True, 'listed': True, 'hidden': False}]]
        with patch.object(m, 'public_json', side_effect=copy.deepcopy(replies)):
            m.verify_public(manifest)
        for index, field, value in [(0, 'version', '1.2.4'), (1, 'version', '2.3.5'),
                                    (2, 'approve', False), (2, 'hidden', True)]:
            changed = copy.deepcopy(replies)
            target = changed[index][0] if index == 2 else changed[index]
            target[field] = value
            with patch.object(m, 'public_json', side_effect=changed):
                with self.assertRaises(RuntimeError):
                    m.verify_public(manifest)

    def test_rerun_is_not_the_original_execution(self):
        with self.assertRaisesRegex(RuntimeError, 'Rerun'):
            m.unique_run({'beforeRunIds': []}, [{'id': 101, 'run_attempt': 2}])

    def test_linked_worktrees_share_existing_intent_without_migration(self):
        common = self.directory / 'repo' / '.git'
        common.mkdir(parents=True)
        primary = common.parent
        linked = primary / '.worktrees' / 'evaluation'
        linked.mkdir(parents=True)
        response = subprocess.CompletedProcess([], 0, (str(common) + '\n').encode(), b'')
        with patch.object(m.subprocess, 'run', return_value=response) as query:
            first = m.shared_work_directory(primary)
            second = m.shared_work_directory(linked)
        self.assertEqual(first, second)
        self.assertEqual(first, primary / '.work')
        self.assertEqual([call.kwargs['cwd'] for call in query.call_args_list], [primary, linked])
        journal = first / 'next-package-dispatch' / ('b' * 64)
        def uncertain(args):
            self.calls.append(args)
            raise subprocess.TimeoutExpired(args, 120)
        with self.assertRaisesRegex(RuntimeError, 'intent retained'):
            m.execute(self.context, journal, submit=True, dispatch=uncertain)
        before = {p.name: p.read_bytes() for p in journal.glob('*.json')}
        with self.assertRaisesRegex(RuntimeError, 'Unresolved intent'):
            m.execute(self.context, second / 'next-package-dispatch' / ('b' * 64), submit=True, dispatch=uncertain)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(before, {p.name: p.read_bytes() for p in journal.glob('*.json')})

    def test_git_common_directory_failure_has_no_local_fallback(self):
        for response in [subprocess.CompletedProcess([], 1, b'', b'private stderr'),
                         subprocess.CompletedProcess([], 0, b'.git\n', b'')]:
            with patch.object(m.subprocess, 'run', return_value=response):
                with self.assertRaises(RuntimeError):
                    m.shared_work_directory(self.directory)
        self.assertEqual(m.TREE, pathlib.Path(__file__).resolve().parents[3])

    def test_live_branch_ref_is_checked_without_git_credential_helpers(self):
        remote = {'ref': 'refs/heads/' + self.context['branch'],
                  'object': {'type': 'commit', 'sha': self.context['sourceCommit']}}
        with patch.object(m, 'gh', return_value=remote) as query, \
             patch.object(m, 'git', side_effect=AssertionError('Git transport invoked')):
            self.old_head(self.context)
        query.assert_called_once_with('api', 'repos/' + m.REPO + '/git/ref/heads/feature/evaluation')
        for changed in [dict(remote, ref='refs/tags/feature/evaluation'),
                        dict(remote, object={'type': 'commit', 'sha': 'b' * 40}),
                        dict(remote, object={'type': 'tag', 'sha': self.context['sourceCommit']}), {}]:
            with self.subTest(remote=changed), patch.object(m, 'gh', return_value=changed):
                with self.assertRaisesRegex(RuntimeError, 'branch SHA changed'):
                    self.old_head(self.context)


if __name__ == '__main__':
    unittest.main()
