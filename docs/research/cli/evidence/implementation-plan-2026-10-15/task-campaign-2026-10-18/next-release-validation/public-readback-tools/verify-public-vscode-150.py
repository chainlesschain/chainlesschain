"""VS Code-only public readback, including official immutable candidate bytes.

Run with GH_TOKEN supplied only by the parent PowerShell process. No package code runs.
Offline verification: python .work/verify-public-vscode-150.py --verify <directory>
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
import zipfile

WORK = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('public_resolver', WORK / 'resolve-next-task-package-set.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
SOURCE = 'd4065008bb4eff84cfc09f9361f4ae4e9de2140f'
RUN = 39104012121
RUN_URL = 'https://github.com/chainlesschain/chainlesschain/actions/runs/' + str(RUN)
ARTIFACT = 12127523866
API = 'repos/chainlesschain/chainlesschain/'
METADATA_URL = 'https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.150'
VSIX_URL = METADATA_URL + '/file/chainlesschain.chainlesschain-ide-0.37.150.vsix'
LIMITATIONS = ['VS Code/Open VSX only; JetBrains and Microsoft Marketplace publication are not verified.',
               'No package installation, module execution, IDE startup, candidate execution, or model request.',
               'No full three-package manifest or new-version task acceptance is created.',
               'GitHub artifact/API and HTTPS byte bindings are verified; no additional publisher signature is asserted.']
require = shared.require


def verify(directory):
    records = json.loads((directory / 'response-records.json').read_bytes())
    required = {'run.json', 'artifact.json', 'official-candidate.zip', 'official-manifest.json',
                'openvsx-metadata.json', 'chainlesschain.vsix'}
    require(set(records) == required, 'VS Code-only evidence files incomplete')
    raw = {}
    for name, record in records.items():
        path = shared.safe_file(directory, name)
        require(path.stat().st_size == record['bytes'] <= shared.MAX_ARTIFACT, 'saved size mismatch')
        raw[name] = path.read_bytes()
        require(shared.digest(raw[name]) == record['digest'], 'saved digest mismatch')
    run = json.loads(raw['run.json'])
    require(run['id'] == RUN and run['head_sha'] == SOURCE and run['status'] == 'completed'
            and run['conclusion'] == 'success' and run['html_url'] == RUN_URL, 'official successful run mismatch')
    require(run['path'] == '.github/workflows/ide-extensions.yml'
            and run['head_branch'] == 'ide-vscode-v0.37.150' and run['event'] == 'push',
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
            and manifest['version'] == '0.37.150'
            and manifest['vsixmanifestIdentity'] == {'id': 'chainlesschain-ide',
                'publisher': 'chainlesschain', 'version': '0.37.150'}, 'official manifest package mismatch')
    public = raw['chainlesschain.vsix']
    require(public == candidate and len(public) == manifest['bytes'], 'public VSIX differs from immutable candidate')
    require(hashlib.sha256(public).hexdigest() == manifest['sha256']
            and hashlib.sha512(public).hexdigest() == manifest['sha512'], 'official manifest digest mismatch')
    metadata = json.loads(raw['openvsx-metadata.json'])
    require(metadata['namespace'] == 'chainlesschain' and metadata['name'] == 'chainlesschain-ide'
            and metadata['version'] == '0.37.150' and metadata['files']['download'] == VSIX_URL,
            'public metadata identity/download mismatch')
    for name, url in [('openvsx-metadata.json', METADATA_URL), ('chainlesschain.vsix', VSIX_URL)]:
        require(records[name]['url'] == url and records[name]['httpStatus'] == 200, 'public response binding mismatch')
    checks = shared.inspect_vsix(public)
    return {'schema': 'chainlesschain.vscode-only-public-readback/v1',
            'status': 'VERIFIED_PUBLIC_VSCODE_ONLY', 'version': '0.37.150',
            'recommendedCliVersion': '0.166.105', 'releaseSourceCommit': SOURCE,
            'workflowRun': RUN_URL, 'artifactId': ARTIFACT,
            'publicVsixDigest': shared.digest(public), 'publicVsixBytes': len(public),
            'officialManifestDigest': shared.digest(manifest_raw), 'officialCandidateBytesMatch': True,
            'checks': checks, 'jetbrainsPublicationVerified': False,
            'microsoftMarketplacePublicationVerified': False, 'newVersionTaskRetest': 'NOT_RUN',
            'limitations': LIMITATIONS}


def fetch(directory):
    require(bool(os.environ.get('GH_TOKEN')), 'GH_TOKEN must be supplied by parent process')
    directory.mkdir(exist_ok=False)
    records = {}
    for name, endpoint in [('run.json', API + 'actions/runs/' + str(RUN)),
                           ('artifact.json', API + 'actions/artifacts/' + str(ARTIFACT)),
                           ('official-candidate.zip', API + 'actions/artifacts/' + str(ARTIFACT) + '/zip')]:
        raw = subprocess.check_output(['gh', 'api', endpoint], timeout=180)
        require(0 < len(raw) <= shared.MAX_ARTIFACT, 'official response exceeds bound')
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
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify')
    args = parser.parse_args()
    if args.verify:
        directory = Path(args.verify).absolute()
        result = verify(directory)
        receipt = json.loads((directory / 'readback.json').read_bytes())
        require({key: value for key, value in receipt.items() if key != 'verifiedAt'} == result,
                'stored verified receipt differs')
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        directory = WORK / ('vscode-only-150-' + stamp + '.readback')
        result = fetch(directory)
    print(json.dumps({**result, 'readbackDirectory': str(directory)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
