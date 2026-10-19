"""Resolve exact public task-quality releases without installing or executing them.

After all three releases are public:
  python resolve-next-task-package-set.py
Offline verification of a completed evidence directory:
  python resolve-next-task-package-set.py --verify <directory.readback>

Default output is a fresh .work/task-quality-105-<UTC>.readback directory.
Only after every metadata/artifact check passes is the new manifest created
with exclusive creation. The original latest manifest is never opened to write.
"""
import argparse
import base64
import datetime
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import struct
import subprocess
import tarfile
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import zipfile

WORK = pathlib.Path(__file__).resolve().parent
TREE = WORK.parent / '.worktrees/v17'
PACKAGE_DIRECTORY = 'docs/research/cli/verify01-package-sets'
OLD_MANIFEST = PACKAGE_DIRECTORY + '/2026-10-18-latest.json'
NEW_MANIFEST = PACKAGE_DIRECTORY + '/2026-10-18-task-quality-105.json'
RELEASE_SOURCE = 'd4065008bb4eff84cfc09f9361f4ae4e9de2140f'
VERSIONS = {'cli': '0.166.105', 'vscode': '0.37.150', 'jetbrains': '0.4.167',
            'vscodeHost': '1.132.0', 'jetbrainsHost': '2025.2'}
URLS = {
    'npm-metadata.json': 'https://registry.npmjs.org/chainlesschain/' + VERSIONS['cli'],
    'openvsx-metadata.json': 'https://open-vsx.org/api/chainlesschain/chainlesschain-ide/' + VERSIONS['vscode'],
    'jetbrains-updates.json': 'https://plugins.jetbrains.com/api/plugins/32208/updates?size=100',
}
HELPERS = ['src/lib/file-import-diagnostics.js', 'src/lib/coding-task-guidance.js',
           'src/lib/transport-error-details.js']
SOURCE_FILES = HELPERS + ['src/runtime/agent-core.js', 'src/runtime/headless-runner.js',
                          'src/runtime/headless-stream.js']
CLASSES = ['com/chainlesschain/ide/CliVersionCheck.class',
           'com/chainlesschain/ide/MarkdownLite.class',
           'com/chainlesschain/ide/intellij/ChatTranscriptRendering.class',
           'com/chainlesschain/ide/intellij/ConversationView.class']
MAX_METADATA = 16 * 1024 * 1024
MAX_ARTIFACT = 128 * 1024 * 1024
MAX_MEMBER = 64 * 1024 * 1024
LIMITATIONS = [
    'No package installation, module execution, JVM launch, candidate execution, or model request.',
    'Java verification checks class identity and the declared static-final ConstantValue; it is not runtime or UI restoration acceptance.',
    'Renderer class presence confirms packaging, not that restored conversations render correctly.',
    'Saved public HTTPS responses and byte digests are reproducible evidence, not a separate publisher signature for IDE artifacts.',
]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def digest(raw):
    return 'sha256:' + hashlib.sha256(raw).hexdigest()


def safe_file(root, relative):
    require(isinstance(relative, str) and relative, 'nonempty relative path required')
    require(not re.search(r'[\\:\x00-\x1f]', relative), 'unsafe file path')
    parts = relative.split('/')
    require(all(part and part not in ('.', '..') for part in parts), 'unsafe file path')
    current = root
    for index, part in enumerate(parts):
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            require(index == len(parts) - 1, 'missing parent directory')
            return current
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                'symbolic link or reparse path denied')
        require(stat.S_ISREG(info.st_mode) if index == len(parts) - 1 else stat.S_ISDIR(info.st_mode),
                'regular file path required')
    return current


def write_new(root, relative, raw):
    target = safe_file(root, relative)
    with target.open('xb') as output:
        output.write(raw)
    return {'path': relative, 'digest': digest(raw), 'bytes': len(raw)}


def publish_manifest(raw):
    target = safe_file(TREE, NEW_MANIFEST)
    temporary = safe_file(TREE, NEW_MANIFEST + '.pending-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as output:
            output.write(raw)
        # Atomic no-clobber publication: an existing manifest is never replaced.
        os.link(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        require(urllib.parse.urlsplit(newurl).scheme == 'https', 'non-HTTPS redirect denied')
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(url, target, maximum):
    require(urllib.parse.urlsplit(url).scheme == 'https', 'public HTTPS URL required')
    request = urllib.request.Request(url, headers={'User-Agent': 'ChainlessChain-package-readback/1',
                                                   'Accept-Encoding': 'identity'})
    opener = urllib.request.build_opener(HTTPSOnlyRedirect())
    with opener.open(request, timeout=90) as response:
        require(response.status == 200, 'public artifact did not return HTTP 200')
        length = response.headers.get('Content-Length')
        if length is not None:
            require(0 < int(length) <= maximum, 'response Content-Length exceeds bound')
        raw = response.read(maximum + 1)
        require(0 < len(raw) <= maximum, 'empty or oversized public response')
        if length is not None:
            require(len(raw) == int(length), 'incomplete public response')
        final = urllib.parse.urlsplit(response.geturl())
        require(final.scheme == 'https', 'non-HTTPS final URL denied')
        # Public redirects can include temporary CDN query credentials. Preserve
        # the initial public URL and final location without query/fragment data.
        final_url = urllib.parse.urlunsplit((final.scheme, final.netloc, final.path, '', ''))
    record = write_new(target.parent, target.name, raw)
    return raw, {**record, 'url': url, 'finalUrlWithoutQuery': final_url, 'httpStatus': 200}


def member_name(name):
    require(isinstance(name, str) and not re.search(r'[\\:\x00-\x1f]', name), 'unsafe archive member')
    value = pathlib.PurePosixPath(name)
    require(not value.is_absolute() and all(part not in ('.', '..') for part in value.parts),
            'unsafe archive member')
    return name


def zip_entries(archive):
    members = archive.infolist()
    require(len(members) <= 30000, 'ZIP member count exceeds bound')
    require(len({item.filename for item in members}) == len(members), 'duplicate ZIP members')
    require(sum(item.file_size for item in members) <= 512 * 1024 * 1024,
            'ZIP uncompressed size exceeds bound')
    for item in members:
        member_name(item.filename)
    return {item.filename: item for item in members}


def zip_read(archive, entries, name, maximum=MAX_MEMBER):
    require(name in entries, 'required archive member missing: ' + name)
    item = entries[name]
    require(not item.is_dir() and not stat.S_ISLNK(item.external_attr >> 16), 'regular ZIP member required')
    require(0 < item.file_size <= maximum, 'ZIP member size exceeds bound')
    raw = archive.read(item)
    require(len(raw) == item.file_size, 'ZIP member length mismatch')
    return raw


def xml_document(raw):
    require(b'<!DOCTYPE' not in raw.upper() and b'<!ENTITY' not in raw.upper(), 'XML declarations denied')
    return ET.fromstring(raw)


def metadata(npm, vscode, updates):
    require(npm.get('name') == 'chainlesschain' and npm.get('version') == VERSIONS['cli'], 'npm version mismatch')
    require(npm.get('dist', {}).get('tarball') ==
            'https://registry.npmjs.org/chainlesschain/-/chainlesschain-' + VERSIONS['cli'] + '.tgz',
            'unexpected npm tarball URL')
    require(vscode.get('namespace') == 'chainlesschain' and vscode.get('name') == 'chainlesschain-ide'
            and vscode.get('version') == VERSIONS['vscode'], 'Open VSX identity/version mismatch')
    expected_vsix = ('https://open-vsx.org/api/chainlesschain/chainlesschain-ide/' + VERSIONS['vscode'] +
                     '/file/chainlesschain.chainlesschain-ide-' + VERSIONS['vscode'] + '.vsix')
    require(vscode.get('files', {}).get('download') == expected_vsix, 'unexpected VSIX URL')
    require(isinstance(updates, list), 'JetBrains updates must be an array')
    matched = [item for item in updates if item.get('version') == VERSIONS['jetbrains']
               and item.get('approve') is True and item.get('listed') is True and item.get('hidden') is False]
    require(len(matched) == 1, 'exact JetBrains release must be uniquely approved, listed and visible')
    jb = matched[0]
    require(jb.get('pluginId') == 32208 and isinstance(jb.get('id'), int) and jb['id'] > 0,
            'JetBrains plugin/update identity mismatch')
    require(jb.get('file') == '32208/' + str(jb['id']) + '/chainlesschain-ide-bridge-' + VERSIONS['jetbrains'] + '.zip',
            'unexpected JetBrains ZIP path')
    return jb


def inspect_cli(raw, npm):
    tokens = npm['dist'].get('integrity', '').split()
    matches = []
    for token in tokens:
        if token.startswith('sha512-'):
            expected = base64.b64decode(token[len('sha512-'):], validate=True)
            require(len(expected) == 64, 'invalid SHA-512 SRI length')
            matches.append(expected == hashlib.sha512(raw).digest())
    require(any(matches), 'npm tarball SHA-512 SRI mismatch or missing')
    if npm['dist'].get('shasum'):
        require(hashlib.sha1(raw).hexdigest() == npm['dist']['shasum'], 'npm tarball SHA-1 mismatch')
    selected = {}
    required = {'package/package.json', *('package/' + name for name in SOURCE_FILES)}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        total, seen = 0, set()
        for index, item in enumerate(archive):
            require(index < 30000, 'tar member count exceeds bound')
            member_name(item.name)
            require(item.name not in seen, 'duplicate tar member')
            seen.add(item.name)
            total += item.size
            require(total <= 512 * 1024 * 1024, 'tar uncompressed size exceeds bound')
            if item.name in required:
                require(item.isfile() and 0 < item.size <= 2 * 1024 * 1024, 'regular bounded package member required')
                selected[item.name] = archive.extractfile(item).read()
    require(set(selected) == required, 'CLI package is missing required helpers or manifest')
    package = json.loads(selected['package/package.json'])
    require(package.get('name') == 'chainlesschain' and package.get('version') == VERSIONS['cli'],
            'CLI tarball package identity/version mismatch')
    source_matches = []
    for name in SOURCE_FILES:
        expected = subprocess.check_output(['git', 'show', RELEASE_SOURCE + ':packages/cli/' + name],
                                           cwd=TREE, timeout=20)
        require(selected['package/' + name] == expected, 'published CLI source differs from release commit: ' + name)
        source_matches.append({'path': name, 'digest': digest(expected), 'bytes': len(expected)})
    return {'packageVersion': package['version'], 'sriVerified': True,
            'releaseSourceCommit': RELEASE_SOURCE, 'sourceMatches': source_matches,
            'helpers': [{'path': name, 'digest': digest(selected['package/' + name]),
                         'bytes': len(selected['package/' + name])} for name in HELPERS]}


def inspect_vsix(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = zip_entries(archive)
        package_raw = zip_read(archive, entries, 'extension/package.json', 2 * 1024 * 1024)
        manifest_raw = zip_read(archive, entries, 'extension.vsixmanifest', 2 * 1024 * 1024)
    package = json.loads(package_raw)
    require(package.get('name') == 'chainlesschain-ide' and package.get('publisher') == 'chainlesschain'
            and package.get('version') == VERSIONS['vscode'], 'VSIX package identity/version mismatch')
    recommended = package.get('chainlesschain', {}).get('recommendedCliVersion')
    require(recommended == VERSIONS['cli'], 'VSIX recommended CLI mismatch')
    identities = [element for element in xml_document(manifest_raw).iter()
                  if element.tag.rsplit('}', 1)[-1] == 'Identity']
    require(len(identities) == 1, 'one VSIX identity required')
    identity = identities[0].attrib
    require(identity.get('Id') == 'chainlesschain-ide' and identity.get('Publisher') == 'chainlesschain'
            and identity.get('Version') == VERSIONS['vscode'], 'VSIX XML identity/version mismatch')
    return {'packageVersion': package['version'], 'manifestVersion': identity['Version'],
            'recommendedCliVersion': recommended, 'packageManifestDigest': digest(package_raw),
            'vsixManifestDigest': digest(manifest_raw)}


def class_constants(raw):
    """Read JVM class identity and String ConstantValue fields without a JVM."""
    position = 0
    def take(length):
        nonlocal position
        require(position + length <= len(raw), 'truncated Java class')
        value = raw[position:position + length]
        position += length
        return value
    def u2():
        return struct.unpack('>H', take(2))[0]
    def u4():
        return struct.unpack('>I', take(4))[0]
    require(take(4) == b'\xca\xfe\xba\xbe', 'invalid Java class magic')
    minor, major, count = u2(), u2(), u2()
    pool = [None] * count
    index = 1
    while index < count:
        tag = take(1)[0]
        if tag == 1:
            pool[index] = (tag, take(u2()))
        elif tag in (7, 8, 16, 19, 20):
            pool[index] = (tag, u2())
        elif tag in (3, 4, 9, 10, 11, 12, 17, 18):
            pool[index] = (tag, take(4))
        elif tag in (5, 6):
            pool[index] = (tag, take(8))
            index += 1
        elif tag == 15:
            pool[index] = (tag, take(3))
        else:
            raise ValueError('unsupported Java constant-pool tag')
        index += 1
    def constant(number, tag):
        require(0 < number < len(pool) and pool[number] is not None and pool[number][0] == tag,
                'invalid Java constant-pool reference')
        return pool[number][1]
    def text(number):
        # Only ASCII class/field names and the version String are decoded. Other
        # modified-UTF8 constants remain opaque bytes and are never executed.
        return constant(number, 1).decode('ascii')
    u2()  # access_flags
    class_name = text(constant(u2(), 7))
    u2()  # super_class
    take(2 * u2())
    fields = []
    for _ in range(u2()):
        access, name_index, descriptor_index, attribute_count = u2(), u2(), u2(), u2()
        name = constant(name_index, 1)
        descriptor = constant(descriptor_index, 1)
        values = []
        for _ in range(attribute_count):
            attribute_name = constant(u2(), 1)
            attribute = take(u4())
            if name == b'RECOMMENDED_CLI_VERSION' and attribute_name == b'ConstantValue':
                require(len(attribute) == 2, 'invalid ConstantValue attribute')
                values.append(text(constant(struct.unpack('>H', attribute)[0], 8)))
        if name == b'RECOMMENDED_CLI_VERSION':
            require(descriptor == b'Ljava/lang/String;' and access & 0x18 == 0x18,
                    'recommended CLI must be a static-final String')
            require(len(values) == 1, 'one declared recommended CLI ConstantValue required')
            fields.append({'field': 'RECOMMENDED_CLI_VERSION', 'value': values[0], 'accessFlags': access})
    return {'className': class_name, 'majorVersion': major, 'minorVersion': minor, 'recommendedFields': fields}


def inspect_jetbrains(raw):
    matches = []
    with zipfile.ZipFile(io.BytesIO(raw)) as outer:
        outer_entries = zip_entries(outer)
        jar_names = [name for name in outer_entries if name.endswith('.jar')]
        require(0 < len(jar_names) <= 200, 'unexpected plugin JAR count')
        for name in jar_names:
            jar_raw = zip_read(outer, outer_entries, name)
            with zipfile.ZipFile(io.BytesIO(jar_raw)) as jar:
                entries = zip_entries(jar)
                if 'META-INF/plugin.xml' not in entries:
                    continue
                plugin_raw = zip_read(jar, entries, 'META-INF/plugin.xml', 2 * 1024 * 1024)
                plugin = xml_document(plugin_raw)
                if (plugin.findtext('id') or '').strip() != 'com.chainlesschain.ide':
                    continue
                require((plugin.findtext('version') or '').strip() == VERSIONS['jetbrains'],
                        'JetBrains plugin.xml version mismatch')
                classes = []
                recommended = None
                for member in CLASSES:
                    class_raw = zip_read(jar, entries, member, 4 * 1024 * 1024)
                    details = class_constants(class_raw)
                    require(details['className'] == member[:-len('.class')], 'Java class identity mismatch')
                    if member.endswith('/CliVersionCheck.class'):
                        require(len(details['recommendedFields']) == 1, 'recommended CLI field missing')
                        recommended = details['recommendedFields'][0]
                        require(recommended['value'] == VERSIONS['cli'], 'JetBrains recommended CLI mismatch')
                    classes.append({'path': member, 'digest': digest(class_raw), 'bytes': len(class_raw),
                                    'className': details['className'], 'majorVersion': details['majorVersion']})
                matches.append({'pluginVersion': VERSIONS['jetbrains'], 'jarPath': name,
                    'jarDigest': digest(jar_raw), 'pluginXmlDigest': digest(plugin_raw),
                    'recommendedCliConstant': recommended, 'classes': classes})
    require(len(matches) == 1, 'one matching JetBrains plugin JAR required')
    return matches[0]


def inspect_all(raw):
    npm, vscode, updates = (json.loads(raw[name]) for name in URLS)
    jb = metadata(npm, vscode, updates)
    return {'cli': inspect_cli(raw['chainlesschain.tgz'], npm),
            'vscode': inspect_vsix(raw['chainlesschain.vsix']),
            'jetbrains': inspect_jetbrains(raw['chainlesschain-jetbrains.zip'])}, (npm, vscode, jb)


def package_manifest(resolved_at, registries, records):
    npm, vscode, jb = registries
    return {'schema': 'chainlesschain.native-package-set/v1', 'resolvedAt': resolved_at, 'versions': VERSIONS,
        'releaseSourceCommit': RELEASE_SOURCE,
        'origin': {
            'cli': {'url': URLS['npm-metadata.json'], 'integrity': npm['dist']['integrity'], 'tarball': npm['dist']['tarball']},
            'vscode': {'url': URLS['openvsx-metadata.json'], 'download': vscode['files']['download']},
            'jetbrains': {'url': URLS['jetbrains-updates.json'], 'updateId': jb['id'], 'file': jb['file'],
                          'approved': True, 'listed': True, 'hidden': False}},
        'publicArtifacts': {entry: {'digest': records[name]['digest'], 'bytes': records[name]['bytes']}
                            for entry, name in [('cli', 'chainlesschain.tgz'), ('vscode', 'chainlesschain.vsix'),
                                                ('jetbrains', 'chainlesschain-jetbrains.zip')]}}


def verify_offline(directory, require_manifest=True):
    receipt = json.loads(safe_file(directory, 'readback.json').read_bytes())
    require(receipt.get('schema') == 'chainlesschain.task-quality-public-readback/v1', 'readback schema mismatch')
    require(receipt.get('status') == 'VERIFIED_PUBLIC_ARTIFACTS', 'readback not verified')
    require(receipt['versions'] == VERSIONS and receipt['limitations'] == LIMITATIONS, 'readback scope mismatch')
    records = receipt['records']
    expected = {*URLS, 'chainlesschain.tgz', 'chainlesschain.vsix', 'chainlesschain-jetbrains.zip'}
    require(set(records) == expected, 'readback records incomplete')
    raw = {}
    for name, record in records.items():
        require(record['path'] == name and record['httpStatus'] == 200, 'record identity mismatch')
        maximum = MAX_METADATA if name in URLS else MAX_ARTIFACT
        require(isinstance(record['bytes'], int) and 0 < record['bytes'] <= maximum,
                'saved response size exceeds bound')
        target = safe_file(directory, name)
        require(target.stat().st_size == record['bytes'], 'saved response length differs')
        content = target.read_bytes()
        require(len(content) == record['bytes'] and digest(content) == record['digest'], 'saved public bytes differ')
        raw[name] = content
    checks, registries = inspect_all(raw)
    require(receipt['checks'] == checks, 'stored checks differ from artifact inspection')
    npm, vscode, jb = registries
    expected_urls = {**URLS, 'chainlesschain.tgz': npm['dist']['tarball'],
                     'chainlesschain.vsix': vscode['files']['download'],
                     'chainlesschain-jetbrains.zip': 'https://plugins.jetbrains.com/files/' + jb['file']}
    for name, url in expected_urls.items():
        require(records[name]['url'] == url, 'source public URL differs')
        require(urllib.parse.urlsplit(records[name]['finalUrlWithoutQuery']).scheme == 'https', 'final URL is not HTTPS')
    manifest_raw = encoded(package_manifest(receipt['verifiedAt'], registries, records))
    require(safe_file(directory, 'package-set.json').read_bytes() == manifest_raw, 'package-set snapshot differs')
    require(receipt['packageSet'] == {'path': NEW_MANIFEST, 'digest': digest(manifest_raw), 'bytes': len(manifest_raw)},
            'new manifest binding differs')
    preserved = safe_file(directory, 'original-package-set.json').read_bytes()
    require(receipt['originalManifest'] == {'path': OLD_MANIFEST, 'digest': digest(preserved), 'bytes': len(preserved)},
            'original manifest snapshot binding differs')
    require(safe_file(TREE, OLD_MANIFEST).read_bytes() == preserved, 'original latest manifest changed')
    if require_manifest:
        require(safe_file(TREE, NEW_MANIFEST).read_bytes() == manifest_raw, 'published local package-set differs')
    return {'status': receipt['status'], 'versions': VERSIONS, 'packageSetDigest': digest(manifest_raw),
            'readbackDigest': digest(safe_file(directory, 'readback.json').read_bytes())}


def resolve(directory):
    old_bytes = safe_file(TREE, OLD_MANIFEST).read_bytes()
    require(not safe_file(TREE, NEW_MANIFEST).exists(), 'new manifest already exists; use --verify instead')
    directory.mkdir(exist_ok=False)
    write_new(directory, 'original-package-set.json', old_bytes)
    raw, records = {}, {}
    for name, url in URLS.items():
        raw[name], records[name] = download(url, directory / name, MAX_METADATA)
    npm, vscode, updates = (json.loads(raw[name]) for name in URLS)
    jb = metadata(npm, vscode, updates)
    artifact_urls = {'chainlesschain.tgz': npm['dist']['tarball'], 'chainlesschain.vsix': vscode['files']['download'],
                     'chainlesschain-jetbrains.zip': 'https://plugins.jetbrains.com/files/' + jb['file']}
    for name, url in artifact_urls.items():
        raw[name], records[name] = download(url, directory / name, MAX_ARTIFACT)
    checks, registries = inspect_all(raw)
    verified_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    manifest_raw = encoded(package_manifest(verified_at, registries, records))
    write_new(directory, 'package-set.json', manifest_raw)
    receipt = {'schema': 'chainlesschain.task-quality-public-readback/v1', 'status': 'VERIFIED_PUBLIC_ARTIFACTS',
        'verifiedAt': verified_at, 'versions': VERSIONS, 'records': records, 'checks': checks,
        'packageSet': {'path': NEW_MANIFEST, 'digest': digest(manifest_raw), 'bytes': len(manifest_raw)},
        'originalManifest': {'path': OLD_MANIFEST, 'digest': digest(old_bytes), 'bytes': len(old_bytes)},
        'limitations': LIMITATIONS}
    write_new(directory, 'readback.json', encoded(receipt))
    # Re-read every saved byte before publishing the independent manifest.
    verify_offline(directory, require_manifest=False)
    require(safe_file(TREE, OLD_MANIFEST).read_bytes() == old_bytes, 'original latest manifest changed')
    publish_manifest(manifest_raw)
    return verify_offline(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group()
    options.add_argument('--readback-dir', help='fresh direct child of .work ending in .readback')
    options.add_argument('--verify', help='existing .readback directory; offline, read-only verification')
    args = parser.parse_args()
    if args.verify:
        directory = pathlib.Path(args.verify).absolute()
        require(directory.is_dir() and not directory.is_symlink(), 'regular readback directory required')
        result = verify_offline(directory)
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        directory = pathlib.Path(args.readback_dir).absolute() if args.readback_dir else WORK / ('task-quality-105-' + stamp + '.readback')
        require(directory.parent == WORK and directory.name.endswith('.readback'), 'readback must be a fresh .work child')
        result = resolve(directory)
    print(json.dumps({**result, 'readbackDirectory': str(directory)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
