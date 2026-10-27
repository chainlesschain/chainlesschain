import importlib.util
import io
import pathlib
import tarfile
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/verify01-extract-windows-archive.py'
spec = importlib.util.spec_from_file_location('extract_windows', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExtractWindowsArchiveTests(unittest.TestCase):
    def archive(self, root, entries, format=tarfile.PAX_FORMAT):
        target = root / 'fixture.tar'
        with tarfile.open(target, 'w', format=format, encoding='utf-8') as output:
            for name, kind, data in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.size = len(data) if kind == tarfile.REGTYPE else 0
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    member.linkname = '../outside'
                output.addfile(member, io.BytesIO(data))
        return target

    def test_unicode_header_and_pax_paths_preserve_exact_bytes(self):
        for format in (tarfile.USTAR_FORMAT, tarfile.PAX_FORMAT):
            with self.subTest(format=format), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                destination = root / 'destination'
                destination.mkdir()
                names = ['plain.bin', '\u540e\u7aef.txt', '\u6587\u6863/caf\u00e9.md']
                if format == tarfile.PAX_FORMAT:
                    names.append('\u6587\u6863/' + '\u957f\u6587\u4ef6\u540d' * 20 + '.txt')
                payload = bytes(range(256))
                archive = self.archive(root, [(name, tarfile.REGTYPE, payload) for name in names], format)
                module.extract(archive, destination)
                self.assertEqual(sorted(str(path.relative_to(destination)).replace('\\', '/')
                                        for path in destination.rglob('*') if path.is_file()), sorted(names))
                for name in names:
                    with open(module.disk(destination / name), 'rb') as source:
                        self.assertEqual(source.read(), payload)

    def test_unsafe_names_links_and_collisions_are_rejected_before_writes(self):
        invalid = [(name, tarfile.REGTYPE, b'x') for name in
                   ['../outside', '/absolute', 'C:/drive', 'stream:ads', 'a\\b',
                    'trailing.', 'trailing ', 'NUL.txt', 'dir/CON', 'a//b']]
        invalid += [('link', kind, b'') for kind in
                    [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE]]
        cases = [[entry] for entry in invalid]
        cases += [[('Name', tarfile.REGTYPE, b'1'), ('name', tarfile.REGTYPE, b'2')],
                  [('same', tarfile.REGTYPE, b'1'), ('same', tarfile.REGTYPE, b'2')],
                  [('a', tarfile.REGTYPE, b'1'), ('a/child', tarfile.REGTYPE, b'2')]]
        for entries in cases:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as temporary:
                root = pathlib.Path(temporary)
                destination = root / 'destination'
                destination.mkdir()
                with self.assertRaises(ValueError):
                    module.extract(self.archive(root, entries), destination)
                self.assertEqual(list(destination.iterdir()), [])

    def test_existing_destination_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            destination = root / 'destination'
            destination.mkdir()
            existing = destination / 'existing'
            existing.write_bytes(b'keep')
            with self.assertRaises(ValueError):
                module.extract(self.archive(root, [('existing', tarfile.REGTYPE, b'replace')]), destination)
            self.assertEqual(existing.read_bytes(), b'keep')


if __name__ == '__main__':
    unittest.main()
