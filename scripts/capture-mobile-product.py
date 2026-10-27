"""Capture the verified public APK without editing app code or seeding UI data."""

import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.work/product-ui-captures'
APK = Path(os.environ.get('RUNNER_TEMP', OUT)) / 'chainlesschain-product.apk'
PACKAGE = 'com.chainlesschain.android'
VERSION = '5.0.3.143'
RECEIPT = ROOT / 'docs/research/cli/evidence/release128-public/product-publication.json'


def command(*args, binary=False, timeout=45):
    result = subprocess.run(args, check=True, capture_output=True, timeout=timeout)
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')


def adb(*args, **kwargs):
    return command('adb', *args, **kwargs)


def asset():
    publication = json.loads(RECEIPT.read_text(encoding='utf-8'))
    assert publication['version'] == f'v{VERSION}'
    assert publication['release']['immutable'] is True
    record = next(a for a in publication['release']['assets'] if a['name'] == 'app-universal-release.apk')
    expected_url = f'https://github.com/chainlesschain/chainlesschain/releases/download/v{VERSION}/app-universal-release.apk'
    assert record['url'] == expected_url
    return record, publication


def verify_apk(record):
    digest = hashlib.file_digest(APK.open('rb'), 'sha256').hexdigest()
    assert APK.stat().st_size == record['size'], 'APK size differs from publication'
    assert f'sha256:{digest}' == record['digest'], 'APK digest differs from publication'
    return digest


def download():
    record, _ = asset()
    OUT.mkdir(parents=True, exist_ok=True)
    APK.parent.mkdir(parents=True, exist_ok=True)
    if not APK.exists():
        request = urllib.request.Request(record['url'], headers={'User-Agent': 'chainlesschain-product-capture'})
        with urllib.request.urlopen(request, timeout=90) as source, APK.open('wb') as destination:
            while block := source.read(1024 * 1024):
                destination.write(block)
    print(f'Verified public APK SHA-256: {verify_apk(record)}', flush=True)


def hierarchy(label='current'):
    adb('shell', 'uiautomator', 'dump', '/sdcard/cc-product-screen.xml', timeout=25)
    raw = adb('shell', 'cat', '/sdcard/cc-product-screen.xml')
    xml = raw[raw.index('<?xml'):]
    (OUT / f'{label}.xml').write_text(xml, encoding='utf-8')
    return ET.fromstring(xml)


def labels(tree):
    return [n.attrib.get('text', '') or n.attrib.get('content-desc', '') for n in tree.iter('node')]


def tap_node(node):
    match = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.attrib.get('bounds', ''))
    assert match, 'Missing UI element bounds'
    x1, y1, x2, y2 = map(int, match.groups())
    assert x2 > x1 and y2 > y1
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def tap_text(options, bottom=False, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        tree = hierarchy()
        for option in options:
            found = [n for n in tree.iter('node') if n.attrib.get('text') == option or n.attrib.get('content-desc') == option]
            if found:
                if bottom:
                    found.sort(key=lambda n: int(re.findall(r'\d+', n.attrib.get('bounds', '[0,0][0,0]'))[1]), reverse=True)
                tap_node(found[0])
                time.sleep(1)
                return
        time.sleep(2)
    raise RuntimeError(f'UI label not found: {options}; current labels: {labels(tree)}')


def wait_labels(options, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        tree = hierarchy()
        text = '\n'.join(labels(tree))
        if any(option in text for option in options):
            return tree
        # Grant only a system permission dialog in this disposable emulator.
        for node in tree.iter('node'):
            if node.attrib.get('resource-id') in {
                'com.android.permissioncontroller:id/permission_allow_button',
                'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
            }:
                tap_node(node)
                break
        time.sleep(2)
    raise RuntimeError(f'Expected screen not reached: {options}; current labels: {labels(tree)}')


def screenshot(name, expected):
    tree = wait_labels(expected, timeout=60)
    assert any(n.attrib.get('package') == PACKAGE for n in tree.iter('node')), 'App UI not in foreground'
    time.sleep(2)
    data = adb('exec-out', 'screencap', '-p', binary=True)
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', data[16:24])
    assert width >= 720 and height > width
    target = OUT / f'{name}.png'
    target.write_bytes(data)
    hierarchy(name)
    print(f'CAPTURED {name}: {width} x {height}', flush=True)
    return {'file': target.name, 'width': width, 'height': height, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'expectedLabels': expected}


def capture():
    record, publication = asset()
    digest = verify_apk(record)
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        adb('wait-for-device', timeout=90)
        adb('shell', 'wm', 'size', '1080x2160')
        adb('shell', 'wm', 'density', '420')
        adb('shell', 'input', 'keyevent', '82')
        adb('install', str(APK), timeout=240)
        package_info = adb('shell', 'dumpsys', 'package', PACKAGE)
        assert re.search(rf'versionName={re.escape(VERSION)}(?:\s|$)', package_info), 'Installed version mismatch'
        (OUT / 'installed-package.txt').write_text(package_info, encoding='utf-8')
        adb('shell', 'am', 'start', '-W', '-n', f'{PACKAGE}/.MainActivity')
        wait_labels(['设置您的6位PIN码'], timeout=150)
        # Only the normal first-run PIN UI is used. No database/preferences
        # injection, root auth bypass, model configuration or chat submission.
        for digit in '739142':
            tap_text([digit], timeout=10)
        wait_labels(['确认PIN码'], timeout=30)
        for digit in '739142':
            tap_text([digit], timeout=10)
        wait_labels(['个人助手', 'Personal Assistant'], timeout=150)
        images = [screenshot('android-home-5.0.3.143', ['个人助手', 'Personal Assistant'])]
        tap_text(['个人助手', 'Personal Assistant'], bottom=True)
        images.append(screenshot('android-assistant-5.0.3.143', ['个人助手', 'Personal Assistant']))
        tap_text(['个人中心', 'Profile', 'Me'], bottom=True)
        images.append(screenshot('android-profile-5.0.3.143', ['设置', 'Settings', '关于', 'About']))
        receipt = {
            'schema': 'chainlesschain.android-product-capture/v1',
            'status': 'captured-awaiting-visual-review',
            'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'captureSourceCommit': os.environ.get('GITHUB_SHA'),
            'workflowRunId': os.environ.get('GITHUB_RUN_ID'),
            'productVersion': VERSION,
            'productSourceCommit': publication['sourceSha'],
            'apk': {'url': record['url'], 'bytes': record['size'], 'sha256': digest},
            'deviceKind': 'Android emulator; not a physical device',
            'apiLevel': adb('shell', 'getprop', 'ro.build.version.sdk').strip(),
            'abiList': adb('shell', 'getprop', 'ro.product.cpu.abilist').strip(),
            'fingerprint': adb('shell', 'getprop', 'ro.build.fingerprint').strip(),
            'profile': 'fresh install; normal first-run PIN setup; no seeded notes or conversations',
            'modelRequests': 0,
            'hardwareSigningValidated': False,
            'images': images,
        }
        (OUT / 'capture.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    finally:
        try:
            (OUT / 'crash-logcat.txt').write_text(adb('logcat', '-d', '-b', 'crash'), encoding='utf-8')
        except (subprocess.SubprocessError, OSError):
            pass


if __name__ == '__main__':
    {'download': download, 'capture': capture}[sys.argv[1]]()
