"""Extract the frozen git tar with Unicode Win32 paths, independent of ACP.

Windows libarchive versions disagree on hdrcharset=UTF-8 conversion. Python's
tar reader decodes both ordinary headers and PAX paths explicitly as UTF-8.
Only regular files and directories in an empty destination are supported.
"""
import os
import pathlib
import re
import shutil
import sys
import tarfile


def disk(path):
    value = str(path.absolute())
    return '\\\\?\\' + value if os.name == 'nt' else value


def extract(archive, destination):
    root = pathlib.Path(destination).resolve(strict=True)
    if not root.is_dir() or any(root.iterdir()):
        raise ValueError('archive destination must be an empty directory')
    with tarfile.open(archive, mode='r:', encoding='utf-8', errors='strict') as source:
        members = source.getmembers()
        names = {}
        # Validate the complete namespace before creating any files. No links,
        # alternate streams, device names, traversal or case aliases on Windows.
        for member in members:
            name = member.name.rstrip('/') if member.isdir() else member.name
            parts = name.split('/')
            if (not name or any(not part or part in ('.', '..') or
                    re.search(r'[\\<>:"|?*\x00-\x1f]', part) or
                    part.endswith(('.', ' ')) or
                    re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', part, re.I)
                    for part in parts)):
                raise ValueError('unsafe archive path: ' + repr(name))
            if not (member.isdir() or member.isfile()):
                raise ValueError('unsupported archive entry: ' + repr(name))
            for index in range(1, len(parts) + 1):
                current = '/'.join(parts[:index])
                kind = 'directory' if index < len(parts) or member.isdir() else 'file'
                key = current.casefold()
                previous = names.get(key)
                explicit = index == len(parts)
                if previous is not None:
                    if (previous[0] != current or previous[1] != kind or
                            (explicit and previous[2])):
                        raise ValueError('archive path collision: ' + repr(current))
                    explicit = explicit or previous[2]
                names[key] = (current, kind, explicit)
        for member in members:
            target = root.joinpath(*member.name.rstrip('/').split('/'))
            if member.isdir():
                os.makedirs(disk(target), exist_ok=True)
            else:
                os.makedirs(disk(target.parent), exist_ok=True)
                with source.extractfile(member) as incoming, open(disk(target), 'xb') as outgoing:
                    shutil.copyfileobj(incoming, outgoing)
                if os.stat(disk(target)).st_size != member.size:
                    raise ValueError('extracted size mismatch')


if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2])
