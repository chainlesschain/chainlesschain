// Fetch latest desktop release asset sizes from GitHub at build time.
// Writes src/data/release-sizes.json (committed). On API failure, keeps the
// existing cache so offline / rate-limited builds don't break.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'src', 'data', 'release-sizes.json');
const ROOT_PKG = path.resolve(__dirname, '..', '..', 'package.json');
const REPO = 'chainlesschain/chainlesschain';
// Note: was `/releases/latest` but post-2026-05-28 the "latest" tag is the
// `internal-binaries-android-vYYYYMMDD` Release (Android prebuilt binaries
// split out of git per `git_slim_2026_05_28_recipe`), which has zero desktop
// assets → empty sizes shipped to homepage. We now walk `/releases?per_page=30`
// and pick the first non-internal release with at least one classifiable asset.
const LIST_URL = `https://api.github.com/repos/${REPO}/releases?per_page=30`;
// The homepage header shows "CLI v<X>". Source it from the PUBLISHED npm
// `latest` dist-tag (what `npm i -g chainlesschain` actually gives) rather than
// the in-repo packages/cli/package.json — that working-tree value drifts ahead
// during active CLI development (parallel sessions bump it before publish), so
// the public site would otherwise advertise an unpublished/uninstallable version.
const NPM_LATEST_URL = 'https://registry.npmjs.org/chainlesschain/latest';

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

// Resolve the published CLI version from the npm registry's `latest` dist-tag.
// Returns null on any failure so the caller can fall back to the cached value
// (then ultimately to packages/cli/package.json in index.astro).
async function fetchPublishedCliVersion() {
  try {
    const res = await fetch(NPM_LATEST_URL, {
      headers: { 'User-Agent': 'chainlesschain-website-build', Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const j = await res.json();
    return typeof j.version === 'string' && j.version ? j.version : null;
  } catch (err) {
    console.warn(`[fetch-release-sizes] npm CLI version fetch failed: ${err.message}`);
    return null;
  }
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

function ghHeaders() {
  const headers = {
    'User-Agent': 'chainlesschain-website-build',
    'Accept': 'application/vnd.github+json',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

// Deterministically resolve the release for the current productVersion tag.
// Avoids the /releases list-order fragility: that endpoint clusters stale DRAFT
// releases ahead of published ones, and never version-sorts, so a list sweep can
// land on an older published release (e.g. v5.0.3.99 picked over v5.0.3.100 —
// "99" > "100" lexically too). Returns null if no productVersion / 404 / no
// desktop assets, so main() falls back to the list sweep then cache.
async function fetchByProductVersion() {
  let tag;
  try {
    tag = JSON.parse(await fs.readFile(ROOT_PKG, 'utf-8')).productVersion; // e.g. "v5.0.3.100"
  } catch { return null; }
  if (!tag) return null;
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${tag}`;
  console.log(`[fetch-release-sizes] GET ${url}`);
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) {
    console.warn(`[fetch-release-sizes] productVersion ${tag} not published yet (404); falling back to list`);
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const rel = await res.json();
  if (rel.draft || !(rel.assets || []).some(a => classify(a.name))) {
    console.warn(`[fetch-release-sizes] ${tag} has no desktop assets yet; falling back to list`);
    return null;
  }
  console.log(`[fetch-release-sizes] picked ${rel.tag_name} (by productVersion tag)`);
  return rel;
}

async function main() {
  let data;
  try {
    data = await fetchByProductVersion();
    if (!data) {
      console.log(`[fetch-release-sizes] GET ${LIST_URL}`);
      const res = await fetch(LIST_URL, { headers: ghHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const list = await res.json();
      data = pickDesktopRelease(list);
      if (!data) throw new Error(`no release with desktop assets in first ${list.length}`);
      console.log(`[fetch-release-sizes] picked ${data.tag_name} (list sweep; skipped internal-binaries-* + drafts)`);
    }
  } catch (err) {
    console.warn(`[fetch-release-sizes] fetch failed: ${err.message}`);
    const cached = await readCache();
    if (cached && cached.tag && !cached.tag.startsWith('internal-binaries-')) {
      console.warn(`[fetch-release-sizes] keeping cache (tag=${cached.tag}, fetchedAt=${cached.fetchedAt})`);
      return;
    }
    console.warn(`[fetch-release-sizes] no usable cache; writing empty placeholder`);
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, JSON.stringify({ tag: null, fetchedAt: null, cliVersion: null, sizes: {} }, null, 2) + '\n');
    return;
  }

  const sizes = {};
  for (const a of data.assets || []) {
    const c = classify(a.name);
    if (c && !sizes[c]) {
      sizes[c] = { name: a.name, bytes: a.size, label: fmtSize(a.size) };
    }
  }

  // Published npm CLI version for the homepage header. Fall back to the prior
  // cached value if npm is unreachable, so a transient registry blip doesn't
  // blank the chip.
  let cliVersion = await fetchPublishedCliVersion();
  if (!cliVersion) {
    const prev = await readCache();
    cliVersion = (prev && prev.cliVersion) || null;
  }

  const out = {
    tag: data.tag_name,
    fetchedAt: new Date().toISOString(),
    cliVersion,
    sizes,
  };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[fetch-release-sizes] wrote ${Object.keys(sizes).length} sizes for ${data.tag_name} (cli ${cliVersion || 'n/a'})`);
  for (const [k, v] of Object.entries(sizes)) {
    console.log(`  ${k.padEnd(18)} ${v.label.padStart(9)}  ${v.name}`);
  }
}

main().catch(err => {
  console.error('[fetch-release-sizes] fatal:', err);
  process.exit(1);
});
