// Fetch latest desktop release asset sizes from GitHub at build time.
// Writes src/data/release-sizes.json (committed). On API failure, keeps the
// existing cache so offline / rate-limited builds don't break.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'release-sizes.json');
const REPO = 'chainlesschain/chainlesschain';
// Note: was `/releases/latest` but post-2026-05-28 the "latest" tag is the
// `internal-binaries-android-vYYYYMMDD` Release (Android prebuilt binaries
// split out of git per `git_slim_2026_05_28_recipe`), which has zero desktop
// assets → empty sizes shipped to homepage. We now walk `/releases?per_page=30`
// and pick the first non-internal release with at least one classifiable asset.
const LIST_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;

function fmtSize(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function classify(name) {
  if (name.endsWith('.blockmap')) return null;
  if (/Setup-.*\.exe$/.test(name)) return 'win-setup';
  if (/Portable-.*\.exe$/.test(name)) return 'win-portable';
  if (/-arm64\.dmg$/.test(name)) return 'mac-arm64';
  if (/\.dmg$/.test(name) && !/-arm64/.test(name)) return 'mac-intel';
  if (/\.AppImage$/.test(name)) return 'linux-appimage';
  if (/_amd64\.deb$/.test(name)) return 'linux-deb';
  if (/x86_64\.rpm$/.test(name)) return 'linux-rpm';
  if (/app-arm64-v8a-release\.apk$/.test(name)) return 'android-arm64-v8a';
  if (/app-armeabi-v7a-release\.apk$/.test(name)) return 'android-armeabi-v7a';
  if (/app-universal-release\.apk$/.test(name)) return 'android-universal';
  if (/app-release\.aab$/.test(name)) return 'android-aab';
  return null;
}

async function readCache() {
  try { return JSON.parse(await fs.readFile(OUT, 'utf-8')); }
  catch { return null; }
}

function pickDesktopRelease(releases) {
  for (const r of releases) {
    if (!r || !r.tag_name) continue;
    if (r.tag_name.startsWith('internal-binaries-')) continue;
    // Skip drafts + prereleases: when run with a GITHUB_TOKEN (CI), the REST
    // /releases list includes draft releases (often clustered ahead of the
    // published ones), so a stale draft with desktop assets would otherwise be
    // picked over the real latest published release. Mirror /releases/latest.
    if (r.draft || r.prerelease) continue;
    const hits = (r.assets || []).filter(a => classify(a.name));
    if (hits.length > 0) return r;
  }
  return null;
}

async function main() {
  console.log(`[fetch-release-sizes] GET ${LIST_URL}`);
  let data;
  try {
    const headers = {
      'User-Agent': 'chainlesschain-website-build',
      'Accept': 'application/vnd.github+json',
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(LIST_URL, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const list = await res.json();
    data = pickDesktopRelease(list);
    if (!data) throw new Error(`no release with desktop assets in first ${list.length}`);
    console.log(`[fetch-release-sizes] picked ${data.tag_name} (skipped internal-binaries-* tags)`);
  } catch (err) {
    console.warn(`[fetch-release-sizes] fetch failed: ${err.message}`);
    const cached = await readCache();
    if (cached && cached.tag && !cached.tag.startsWith('internal-binaries-')) {
      console.warn(`[fetch-release-sizes] keeping cache (tag=${cached.tag}, fetchedAt=${cached.fetchedAt})`);
      return;
    }
    console.warn(`[fetch-release-sizes] no usable cache; writing empty placeholder`);
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, JSON.stringify({ tag: null, fetchedAt: null, sizes: {} }, null, 2) + '\n');
    return;
  }

  const sizes = {};
  for (const a of data.assets || []) {
    const c = classify(a.name);
    if (c && !sizes[c]) {
      sizes[c] = { name: a.name, bytes: a.size, label: fmtSize(a.size) };
    }
  }

  const out = {
    tag: data.tag_name,
    fetchedAt: new Date().toISOString(),
    sizes,
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[fetch-release-sizes] wrote ${Object.keys(sizes).length} sizes for ${data.tag_name}`);
  for (const [k, v] of Object.entries(sizes)) {
    console.log(`  ${k.padEnd(18)} ${v.label.padStart(9)}  ${v.name}`);
  }
}

main().catch(err => {
  console.error('[fetch-release-sizes] fatal:', err);
  process.exit(1);
});
