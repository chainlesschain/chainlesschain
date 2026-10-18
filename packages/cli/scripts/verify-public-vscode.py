"""VS Code public readback after CLI verification, including official candidate bytes.

Required binding: --source-commit FULL_SHA --new-manifest REPO_PATH
--previous-manifest REPO_PATH --cli-readback DIR --vscode-run-id ID
--vscode-artifact-id ID, and either --readback-dir FRESH_DIR or --verify DIR.
For downloads GH_TOKEN must be supplied by the caller process. No package code runs.
This stage never creates a three-package manifest or claims JetBrains publication.
"""
import argparse
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import zipfile

SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('public_resolver', SCRIPTS / 'verify-public-package-set.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
SOURCE = RUN = RUN_URL = ARTIFACT = METADATA_URL = VSIX_URL = VERSION = OPTIONS = None
API = 'repos/chainlesschain/chainlesschain/'
LIMITATIONS = ['VS Code/Open VSX only; JetBrains and Microsoft Marketplace publication are not verified.',
               'No package installation, module execution, IDE startup, candidate execution, or model request.',
               'No full three-package manifest or new-version task acceptance is created.',
               'GitHub artifact/API and HTTPS byte bindings are verified; no additional publisher signature is asserted.']
require = shared.require


def initialize(options):
    global SOURCE, RUN, RUN_URL, ARTIFACT, VERSION, METADATA_URL, VSIX_URL, OPTIONS
    shared.configure(options)
    require(type(options.vscode_run_id) is int and options.vscode_run_id > 0, 'explicit official workflow run ID required')
    require(type(options.vscode_artifact_id) is int and options.vscode_artifact_id > 0, 'explicit official artifact ID required')
    SOURCE, VERSION, OPTIONS = shared.RELEASE_SOURCE, shared.VERSIONS['vscode'], options
    RUN, ARTIFACT = options.vscode_run_id, options.vscode_artifact_id
    RUN_URL = 'https://github.com/chainlesschain/chainlesschain/actions/runs/' + str(RUN)
    METADATA_URL = shared.URLS['openvsx-metadata.json']
    VSIX_URL = METADATA_URL + '/file/chainlesschain.chainlesschain-ide-' + VERSION + '.vsix'


def prior_cli():
    cli = shared.load_sibling('verify-public-cli')
    cli.initialize(OPTIONS)
    return cli.verify_offline(shared.evidence_directory(OPTIONS.cli_readback))


def expected_binding():
    return {'releaseBinding': shared.BINDING, 'workflowRunId': RUN, 'artifactId': ARTIFACT,
            'cliReadbackDigest': prior_cli()['readbackDigest']}


def verify(directory):
    binding = expected_binding()
    require(json.loads(shared.safe_file(directory, 'binding.json').read_bytes()) == binding,
            'VS Code stage explicit source/workflow/CLI binding mismatch')
    records = json.loads(shared.safe_file(directory, 'response-records.json').read_bytes())
    required = {'run.json', 'artifact.json', 'official-candidate.zip', 'official-manifest.json',
                'openvsx-metadata.json', 'chainlesschain.vsix'}
    require(set(records) == required, 'VS Code-only evidence files incomplete')
    raw = {}
    for name, record in records.items():
        path = shared.safe_file(directory, name)
        maximum = shared.MAX_METADATA if name.endswith('.json') else shared.MAX_ARTIFACT
        require(record['path'] == name and type(record['bytes']) is int
                and 0 < path.stat().st_size == record['bytes'] <= maximum, 'saved size mismatch')
        raw[name] = path.read_bytes()
        require(shared.digest(raw[name]) == record['digest'], 'saved digest mismatch')
    run = json.loads(raw['run.json'])
    require(run['id'] == RUN and run['head_sha'] == SOURCE and run['status'] == 'completed'
            and run['conclusion'] == 'success' and run['html_url'] == RUN_URL, 'official successful run mismatch')
    require(run['path'] == '.github/workflows/ide-extensions.yml'
            and run['head_branch'] == 'ide-vscode-v' + VERSION and run['event'] == 'push',
            'official release workflow/tag mismatch')
    artifact = json.loads(raw['artifact.json'])
    require(artifact['id'] == ARTIFACT and artifact['name'] == 'chainlesschain-ide-vscode-candidate'
            and artifact['expired'] is False and artifact['workflow_run']['id'] == RUN
            and artifact['workflow_run']['head_sha'] == SOURCE, 'official artifact source mismatch')
    if artifact.get('digest'):
        require(artifact['digest'] == shared.digest(raw['official-candidate.zip']), 'GitHub artifact digest mismatch')
    with zipfile.ZipFile(io.BytesIO(raw['official-candidate.zip'])) as archive:
        entries = shared.zip_entries(archive)
        require(set(entries) == {'chainlesschain-ide.vsix', 'manifest.json'}, 'unexpected candidate archive members')
        candidate = shared.zip_read(archive, entries, 'chainlesschain-ide.vsix')
        manifest_raw = shared.zip_read(archive, entries, 'manifest.json')
    require(manifest_raw == raw['official-manifest.json'], 'saved official manifest differs')
    manifest = json.loads(manifest_raw)
    require(manifest['schema'] == 1 and manifest['artifact'] == 'chainlesschain-ide.vsix'
            and manifest['commit'] == SOURCE and manifest['workflowRun'] == RUN_URL,
            'official immutable manifest source mismatch')
    require(manifest['package'] == 'chainlesschain-ide' and manifest['publisher'] == 'chainlesschain'
            and manifest['version'] == VERSION
            and manifest['vsixmanifestIdentity'] == {'id': 'chainlesschain-ide',
                'publisher': 'chainlesschain', 'version': VERSION}, 'official manifest package mismatch')
    public = raw['chainlesschain.vsix']
    require(public == candidate and len(public) == manifest['bytes'], 'public VSIX differs from immutable candidate')
    require(hashlib.sha256(public).hexdigest() == manifest['sha256']
            and hashlib.sha512(public).hexdigest() == manifest['sha512'], 'official manifest digest mismatch')
    metadata = json.loads(raw['openvsx-metadata.json'])
    require(metadata['namespace'] == 'chainlesschain' and metadata['name'] == 'chainlesschain-ide'
            and metadata['version'] == VERSION and metadata['files']['download'] == VSIX_URL,
            'public metadata identity/download mismatch')
    for name, url in [('openvsx-metadata.json', METADATA_URL), ('chainlesschain.vsix', VSIX_URL)]:
        require(records[name]['url'] == url and records[name]['httpStatus'] == 200, 'public response binding mismatch')
        final = urllib.parse.urlsplit(records[name]['finalUrlWithoutQuery'])
        require(final.scheme == 'https' and final.netloc and not final.query and not final.fragment,
                'invalid saved public final HTTPS location')
    for name, endpoint in [('run.json', 'actions/runs/' + str(RUN)),
                           ('artifact.json', 'actions/artifacts/' + str(ARTIFACT)),
                           ('official-candidate.zip', 'actions/artifacts/' + str(ARTIFACT) + '/zip')]:
        require(records[name]['url'] == 'https://api.github.com/' + API + endpoint, 'official response URL mismatch')
    checks = shared.inspect_vsix(public)
    return {'schema': 'chainlesschain.vscode-only-public-readback/v1',
            'status': 'VERIFIED_PUBLIC_VSCODE_ONLY', 'version': VERSION,
            **binding,
            'recommendedCliVersion': shared.VERSIONS['cli'], 'releaseSourceCommit': SOURCE,
            'workflowRun': RUN_URL, 'artifactId': ARTIFACT,
            'publicVsixDigest': shared.digest(public), 'publicVsixBytes': len(public),
            'officialManifestDigest': shared.digest(manifest_raw), 'officialCandidateBytesMatch': True,
            'checks': checks, 'jetbrainsPublicationVerified': False,
            'microsoftMarketplacePublicationVerified': False, 'newVersionTaskRetest': 'NOT_RUN',
            'limitations': LIMITATIONS}


def fetch(directory):
    binding = expected_binding()
    require(bool(os.environ.get('GH_TOKEN')), 'GH_TOKEN must be supplied by parent process')
    directory.mkdir(exist_ok=False)
    shared.write_new(directory, 'binding.json', shared.encoded(binding))
    records = {}
    for name, endpoint in [('run.json', API + 'actions/runs/' + str(RUN)),
                           ('artifact.json', API + 'actions/artifacts/' + str(ARTIFACT)),
                           ('official-candidate.zip', API + 'actions/artifacts/' + str(ARTIFACT) + '/zip')]:
        raw = subprocess.check_output(['gh', 'api', endpoint], timeout=180)
        maximum = shared.MAX_METADATA if name.endswith('.json') else shared.MAX_ARTIFACT
        require(0 < len(raw) <= maximum, 'official response exceeds bound')
        records[name] = {**shared.write_new(directory, name, raw), 'url': 'https://api.github.com/' + endpoint}
    with zipfile.ZipFile(io.BytesIO((directory / 'official-candidate.zip').read_bytes())) as archive:
        manifest = shared.zip_read(archive, shared.zip_entries(archive), 'manifest.json')
    records['official-manifest.json'] = shared.write_new(directory, 'official-manifest.json', manifest)
    for name, url, maximum in [('openvsx-metadata.json', METADATA_URL, shared.MAX_METADATA),
                               ('chainlesschain.vsix', VSIX_URL, shared.MAX_ARTIFACT)]:
        _, records[name] = shared.download(url, directory / name, maximum)
    shared.write_new(directory, 'response-records.json', shared.encoded(records))
    result = verify(directory)
    shared.write_new(directory, 'readback.json', shared.encoded({**result,
        'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
    return verify_offline(directory)


def verify_offline(directory):
    result = verify(directory)
    raw = shared.safe_file(directory, 'readback.json').read_bytes()
    receipt = json.loads(raw)
    require({key: value for key, value in receipt.items() if key != 'verifiedAt'} == result,
            'stored verified receipt differs')
    return {**result, 'readbackDigest': shared.digest(raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    shared.add_binding_arguments(parser)
    parser.add_argument('--cli-readback', required=True)
    parser.add_argument('--vscode-run-id', required=True, type=int)
    parser.add_argument('--vscode-artifact-id', required=True, type=int)
    args = parser.parse_args()
    initialize(args)
    if args.verify:
        directory = shared.evidence_directory(args.verify)
        result = verify_offline(directory)
    else:
        directory = shared.evidence_directory(args.readback_dir, fresh=True)
        result = fetch(directory)
    print(json.dumps({**result, 'readbackDirectory': str(directory)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
