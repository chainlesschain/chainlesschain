"""CLI-only public readback before IDE publication. No package code is executed.

Required: --source-commit FULL_SHA --new-manifest REPO_PATH
--previous-manifest REPO_PATH and either --readback-dir FRESH_DIR or --verify DIR.
Exit 2 means HTTP 404 / pending publication; no verified receipt is written.
This stage never creates a package-set manifest or claims IDE publication.
"""
import argparse
import datetime
import importlib.util
import io
import json
import pathlib
import tarfile
import urllib.error
import urllib.parse

SCRIPTS = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('package_readback', SCRIPTS / 'verify-public-package-set.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
VERSION = SOURCE = METADATA_URL = TARBALL_URL = None
SCHEMA = 'chainlesschain.cli-only-public-readback/v1'
FIELDS = ('dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
          'engines', 'bin', 'chainlesschain')
LIMITATIONS = [
    'CLI-only public metadata and artifact byte verification; IDE publication is not verified.',
    'No installation, package execution, model request, runtime acceptance, or IDE acceptance.',
    'No three-package manifest is created; this receipt cannot authorize a native package campaign.',
    'Only the explicitly listed runtime/helper files are compared byte-for-byte with the release commit.',
    'Saved HTTPS responses and byte digests are evidence, not a separate publisher signature.',
]
require = shared.require


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def initialize(options):
    global VERSION, SOURCE, METADATA_URL, TARBALL_URL
    shared.configure(options)
    SOURCE, VERSION = shared.RELEASE_SOURCE, shared.VERSIONS['cli']
    METADATA_URL = shared.URLS['npm-metadata.json']
    TARBALL_URL = 'https://registry.npmjs.org/chainlesschain/-/chainlesschain-' + VERSION + '.tgz'


def source_package():
    require(SOURCE is not None, 'explicit source binding required')
    raw = shared.git_bytes(SOURCE, 'packages/cli/package.json')
    return json.loads(raw), raw


def check_manifest(value, expected, label):
    shared.check_npm_manifest(value, expected, label)


def inspect_metadata(raw):
    npm = json.loads(raw)
    expected, _ = source_package()
    check_manifest(npm, expected, 'npm metadata')
    require(npm.get('dist', {}).get('tarball') == TARBALL_URL, 'unexpected npm tarball URL')
    return npm


def inspect(raw_metadata, raw_tarball):
    npm = inspect_metadata(raw_metadata)
    checks = shared.inspect_cli(raw_tarball, npm)
    expected, source_raw = source_package()
    # inspect_cli has already bounded the archive and rejected duplicate members.
    with tarfile.open(fileobj=io.BytesIO(raw_tarball), mode='r:gz') as archive:
        package_raw = archive.extractfile('package/package.json').read()
    package = json.loads(package_raw)
    check_manifest(package, expected, 'tarball package.json')
    return {**checks, 'metadataGitHead': npm.get('gitHead'), 'tarballGitHead': package.get('gitHead'),
            'sourcePackageJsonDigest': shared.digest(source_raw),
            'publishedPackageJsonDigest': shared.digest(package_raw),
            'manifestFieldsCompared': list(FIELDS),
            'dependencies': expected.get('dependencies', {}),
            'optionalDependencies': expected.get('optionalDependencies', {}),
            'recommendedPairing': expected.get('chainlesschain', {}),
            'idePublicationVerified': False}


def verify_offline(directory):
    receipt = json.loads(shared.safe_file(directory, 'readback.json').read_bytes())
    require(receipt.get('releaseBinding') == shared.BINDING, 'receipt explicit release binding mismatch')
    require(receipt.get('schema') == SCHEMA and receipt.get('status') == 'VERIFIED_PUBLIC_CLI_ONLY',
            'not a verified CLI-only receipt')
    require(receipt.get('version') == VERSION and receipt.get('releaseSourceCommit') == SOURCE,
            'receipt release binding mismatch')
    require(receipt.get('limitations') == LIMITATIONS and receipt.get('idePublicationVerified') is False,
            'receipt scope mismatch')
    records = receipt['records']
    urls = {'npm-metadata.json': METADATA_URL, 'chainlesschain.tgz': TARBALL_URL}
    require(set(records) == set(urls), 'CLI-only response records required')
    raw = {}
    for name, url in urls.items():
        record = records[name]
        require(record['path'] == name and record['url'] == url and record['httpStatus'] == 200,
                'response identity mismatch')
        final = urllib.parse.urlsplit(record['finalUrlWithoutQuery'])
        require(final.scheme == 'https' and final.netloc and not final.query and not final.fragment,
                'invalid final HTTPS location')
        maximum = shared.MAX_METADATA if name.endswith('.json') else shared.MAX_ARTIFACT
        require(type(record['bytes']) is int and 0 < record['bytes'] <= maximum, 'invalid response size')
        target = shared.safe_file(directory, name)
        require(target.stat().st_size == record['bytes'], 'saved response size mismatch')
        raw[name] = target.read_bytes()
        require(shared.digest(raw[name]) == record['digest'], 'saved response digest mismatch')
    require(receipt['checks'] == inspect(raw['npm-metadata.json'], raw['chainlesschain.tgz']),
            'stored checks differ from artifact inspection')
    return {'status': receipt['status'], 'version': VERSION, 'releaseSourceCommit': SOURCE,
            'idePublicationVerified': False, 'readbackDigest': shared.digest(
                shared.safe_file(directory, 'readback.json').read_bytes())}


def resolve(directory):
    source_package()
    directory.mkdir(exist_ok=False)
    records = {}
    current_url = METADATA_URL
    try:
        metadata_raw, records['npm-metadata.json'] = shared.download(
            current_url, directory / 'npm-metadata.json', shared.MAX_METADATA)
        inspect_metadata(metadata_raw)
        current_url = TARBALL_URL
        tarball_raw, records['chainlesschain.tgz'] = shared.download(
            current_url, directory / 'chainlesschain.tgz', shared.MAX_ARTIFACT)
        checks = inspect(metadata_raw, tarball_raw)
        # Re-read the saved responses before writing a verified receipt.
        require(shared.safe_file(directory, 'npm-metadata.json').read_bytes() == metadata_raw,
                'saved metadata differs')
        require(shared.safe_file(directory, 'chainlesschain.tgz').read_bytes() == tarball_raw,
                'saved tarball differs')
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        pending = {'schema': SCHEMA, 'status': 'PENDING_PUBLICATION', 'checkedAt': now(),
                   'version': VERSION, 'releaseBinding': shared.BINDING, 'url': current_url, 'httpStatus': 404,
                   'idePublicationVerified': False, 'records': records, 'limitations': LIMITATIONS}
        shared.write_new(directory, 'pending.json', shared.encoded(pending))
        return pending, 2
    receipt = {'schema': SCHEMA, 'status': 'VERIFIED_PUBLIC_CLI_ONLY', 'verifiedAt': now(),
               'version': VERSION, 'releaseSourceCommit': SOURCE, 'releaseBinding': shared.BINDING, 'records': records, 'checks': checks,
               'idePublicationVerified': False, 'limitations': LIMITATIONS}
    shared.write_new(directory, 'readback.json', shared.encoded(receipt))
    return verify_offline(directory), 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    shared.add_binding_arguments(parser)
    args = parser.parse_args()
    initialize(args)
    if args.verify:
        directory = shared.evidence_directory(args.verify)
        result, code = verify_offline(directory), 0
    else:
        directory = shared.evidence_directory(args.readback_dir, fresh=True)
        result, code = resolve(directory)
    print(json.dumps({**result, 'readbackDirectory': str(directory)}, ensure_ascii=False))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
