"""Read back only public CLI 0.166.105; never install or run package code.

Fetch: python .work/verify-public-cli-105.py
Offline: python .work/verify-public-cli-105.py --verify <directory.readback>
Exit 2 means HTTP 404 / pending publication; no verified receipt is written.
This helper never creates a package-set manifest or claims IDE publication.
"""
import argparse
import datetime
import importlib.util
import io
import json
import pathlib
import re
import subprocess
import tarfile
import urllib.error
import urllib.parse

WORK = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('package_readback', WORK / 'resolve-next-task-package-set.py')
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
VERSION = '0.166.105'
SOURCE = 'd4065008bb4eff84cfc09f9361f4ae4e9de2140f'
METADATA_URL = 'https://registry.npmjs.org/chainlesschain/' + VERSION
TARBALL_URL = 'https://registry.npmjs.org/chainlesschain/-/chainlesschain-' + VERSION + '.tgz'
SCHEMA = 'chainlesschain.cli-only-public-readback/v1'
FIELDS = ('dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
          'engines', 'bin', 'chainlesschain')
LIMITATIONS = [
    'CLI-only public metadata and artifact byte verification; IDE publication is not verified.',
    'No installation, package execution, model request, runtime acceptance, or IDE acceptance.',
    'No three-package manifest is created; this receipt cannot authorize a native package campaign.',
    'Only the six specified runtime/helper files are compared byte-for-byte with the release commit.',
    'Saved HTTPS responses and byte digests are evidence, not a separate publisher signature.',
]
require = shared.require


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def source_package():
    require(shared.RELEASE_SOURCE == SOURCE and shared.VERSIONS['cli'] == VERSION,
            'shared inspector release binding changed')
    raw = subprocess.check_output(['git', 'show', SOURCE + ':packages/cli/package.json'],
                                  cwd=shared.TREE, timeout=20)
    package = json.loads(raw)
    require(package['name'] == 'chainlesschain' and package['version'] == VERSION,
            'release source package identity mismatch')
    return package, raw


def normalized_bin(value, label):
    require(isinstance(value, dict), label + ' bin must be an object')
    result = {}
    for name, path in value.items():
        require(isinstance(name, str) and name and isinstance(path, str),
                label + ' invalid bin entry')
        # npm removes exactly one leading './' from bin paths in registry metadata.
        # No other path rewriting, traversal, separators or target changes are allowed.
        normalized = path[2:] if path.startswith('./') else path
        parts = normalized.split('/')
        require(all(part not in ('', '.', '..') and re.fullmatch(r'[A-Za-z0-9._-]+', part)
                    for part in parts), label + ' unsafe bin path')
        result[name] = normalized
    return result


def check_manifest(value, expected, label):
    require(value.get('name') == 'chainlesschain' and value.get('version') == VERSION,
            label + ' identity/version mismatch')
    if 'gitHead' in value:
        require(value['gitHead'] == SOURCE, label + ' gitHead mismatch')
    for field in FIELDS:
        actual_field, expected_field = value.get(field, {}), expected.get(field, {})
        if field == 'bin':
            actual_field = normalized_bin(actual_field, label)
            expected_field = normalized_bin(expected_field, 'release source')
        require(actual_field == expected_field, label + ' ' + field + ' mismatch')


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
                   'version': VERSION, 'url': current_url, 'httpStatus': 404,
                   'idePublicationVerified': False, 'records': records, 'limitations': LIMITATIONS}
        shared.write_new(directory, 'pending.json', shared.encoded(pending))
        return pending, 2
    receipt = {'schema': SCHEMA, 'status': 'VERIFIED_PUBLIC_CLI_ONLY', 'verifiedAt': now(),
               'version': VERSION, 'releaseSourceCommit': SOURCE, 'records': records, 'checks': checks,
               'idePublicationVerified': False, 'limitations': LIMITATIONS}
    shared.write_new(directory, 'readback.json', shared.encoded(receipt))
    return verify_offline(directory), 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group()
    options.add_argument('--readback-dir', help='fresh direct .work child ending in .readback')
    options.add_argument('--verify', help='offline verification of an existing CLI-only .readback')
    args = parser.parse_args()
    if args.verify:
        directory = pathlib.Path(args.verify).absolute()
        require(directory.is_dir() and not directory.is_symlink(), 'regular readback directory required')
        result, code = verify_offline(directory), 0
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        directory = pathlib.Path(args.readback_dir).absolute() if args.readback_dir else (
            WORK / ('cli-only-105-' + stamp + '.readback'))
        require(directory.parent == WORK and directory.name.endswith('.readback'),
                'readback must be a fresh direct .work child')
        result, code = resolve(directory)
    print(json.dumps({**result, 'readbackDirectory': str(directory)}, ensure_ascii=False))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
