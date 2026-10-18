"""Read bounded artifact members; credentials stay in stdin/process environment."""
import io
import os
import pathlib
import re
import subprocess
import sys
import zipfile


def curl(config, *args):
    result = subprocess.run(
        ['curl.exe' if os.name == 'nt' else 'curl', '--config', '-', '--fail', '--silent', '--show-error',
         '--retry', '3', '--retry-all-errors', '--connect-timeout', '15', '--max-time', '90', *args],
        input=config.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=300,
    )
    if result.returncode:
        raise RuntimeError('artifact HTTP read failed (curl %s)' % result.returncode)
    return result.stdout


artifact_id, artifact_size, destination = sys.argv[1:4]
token = os.environ['GH_TOKEN']
headers = curl('header = "Authorization: Bearer %s"\n' % token,
               '--dump-header', '-', '--output', os.devnull,
               'https://api.github.com/repos/chainlesschain/chainlesschain/actions/artifacts/%s/zip' % artifact_id)
match = re.search(br'^location:\s*(\S+)', headers, re.I | re.M)
if not match:
    raise RuntimeError('artifact redirect missing')
signed_url = match.group(1).decode()
del token


class RemoteZip(io.RawIOBase):
    def __init__(self):
        self.position = 0
        self.size = int(artifact_size)

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else (self.position if whence == 1 else self.size) + offset
        if not 0 <= self.position <= self.size:
            raise ValueError('invalid ZIP seek')
        return self.position

    def read(self, size=-1):
        length = min(self.size - self.position, size if size >= 0 else self.size)
        if length == 0:
            return b''
        if length > 4 * 1024 * 1024:
            raise ValueError('bounded artifact read exceeded')
        result = curl('url = "%s"\n' % signed_url,
                      '--range', '%d-%d' % (self.position, self.position + length - 1))
        if len(result) != length:
            raise ValueError('artifact byte range mismatch')
        self.position += length
        return result


target = pathlib.Path(destination)
target.mkdir(parents=True, exist_ok=True)
# New subset artifacts are small. Cache the ZIP once so preserving several
# receipts does not open three fresh HTTPS connections for every tiny file.
# Large historical artifacts retain the bounded remote-range reader.
archive_source = None
if 0 < int(artifact_size) <= 32 * 1024 * 1024 and re.fullmatch(r'[1-9][0-9]*', artifact_id):
    cache = pathlib.Path(__file__).resolve().parents[3] / '.work' / 'diagnostic-artifact-cache'
    cache.mkdir(parents=True, exist_ok=True)
    cached = cache / (artifact_id + '.zip')
    range_only = cache / (artifact_id + '.range-only')
    if (not cached.exists() or cached.stat().st_size != int(artifact_size)) and not range_only.exists():
        partial = cache / (artifact_id + '.partial')
        try:
            curl('url = "%s"\n' % signed_url, '--retry', '0', '--max-time', '30', '--output', str(partial))
            if partial.stat().st_size != int(artifact_size):
                raise ValueError('artifact archive length mismatch')
            partial.replace(cached)
        except (RuntimeError, subprocess.TimeoutExpired):
            range_only.write_text('Full body download timed out; use bounded ranges.\n', encoding='utf-8')
    archive_source = cached if cached.exists() and cached.stat().st_size == int(artifact_size) else RemoteZip()
else:
    archive_source = RemoteZip()
with zipfile.ZipFile(archive_source) as archive:
    if sys.argv[4:] == ['--list']:
        print('\n'.join(archive.namelist()))
        sys.exit(0)
    names = sys.argv[4:] or [
        name for name in archive.namelist()
        if name.endswith(('/summary.json', '/result.json'))
        and '/execution-source/' not in name
    ]
    for name in names:
        parts = pathlib.PurePosixPath(name)
        if parts.is_absolute() or '..' in parts.parts:
            raise ValueError('invalid artifact member')
        entry = archive.getinfo(name)
        if entry.file_size > 2 * 1024 * 1024:
            raise ValueError('artifact member too large')
        output = target.joinpath(*parts.parts)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(archive.read(name))
        print(name, entry.file_size)
