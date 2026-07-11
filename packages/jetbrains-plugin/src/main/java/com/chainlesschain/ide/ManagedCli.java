package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Managed CLI runtime — pure decision core, the Java twin of the VS Code
 * extension's {@code packages/vscode-extension/src/managed-cli.js}.
 *
 * <p>When no usable global {@code cc} exists, the plugin can download, verify,
 * cache and use its own copy of the {@code chainlesschain} npm package. This
 * class holds ALL of the decision logic — registry-metadata planning,
 * integrity verification, .tgz extraction (minimal pure tar reader with
 * PaxHeader / GNU @LongLink / ustar-prefix support and a zip-slip guard),
 * install-state bookkeeping with one-step rollback, launcher-shim generation,
 * and the candidate-ordering rules — with every side effect injected, so this
 * twin asserts <b>byte-identical decisions</b> with the JS side on the shared
 * fixtures in {@code packages/vscode-extension/src/__fixtures__/managed-cli/}.
 *
 * <p>Iron rule honored by {@link #deriveCliCandidates}: an explicitly
 * configured cc path is NEVER silently replaced. If it is broken we keep using
 * it, surface a diagnostic, and at most OFFER the managed copy.
 *
 * <p>Twin contract: results are {@link LinkedHashMap}s / {@link List}s shaped
 * exactly like the JS return values (numbers as {@link Long}), so tests can
 * deep-compare them against the MiniJson-parsed fixture expectations.
 *
 * <p>Pure JDK — no IntelliJ imports, no filesystem, no network, no clock.
 */
public final class ManagedCli {
    private ManagedCli() {}

    public static final String PACKAGE_NAME = "chainlesschain";
    public static final String REGISTRY_BASE = "https://registry.npmjs.org";
    public static final String MANAGED_DIR_NAME = "managed-cli";
    public static final String STATE_FILE = "current.json";
    /** Launcher shim base name — distinctive so it never shadows a global cc. */
    public static final String SHIM_BASE = "cc-managed";

    /** Extraction safety caps (the packed CLI is ~2 MB / ~1.5k files). */
    public static final int MAX_ENTRY_COUNT = 20000;
    public static final long MAX_TOTAL_BYTES = 256L * 1024 * 1024;

    // ── Small shared helpers ────────────────────────────────────────────────

    private static Map<String, Object> map() {
        return new LinkedHashMap<>();
    }

    /** JS parseInt semantics for decimal: leading sign + digits, NaN → fallback. */
    private static long jsParseLong(String s, long fallback) {
        if (s == null) return fallback;
        Matcher m = Pattern.compile("^\\s*([+-]?\\d+)").matcher(s);
        if (!m.find()) return fallback;
        try {
            return Long.parseLong(m.group(1));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    /** Registry URL for the metadata of a version (or the {@code latest} dist-tag). */
    public static String registryMetaUrl(String requestedVersion) {
        String v = requestedVersion == null || requestedVersion.isEmpty()
                ? "latest" : requestedVersion;
        try {
            v = java.net.URLEncoder.encode(v, StandardCharsets.UTF_8);
        } catch (Throwable ignored) {
            // never happens for UTF-8; fall through with the raw value
        }
        return REGISTRY_BASE + "/" + PACKAGE_NAME + "/" + v;
    }

    /** Local x.y.z compare (prerelease ignored) — mirrors the JS twin. */
    public static int compareVersions(String a, String b) {
        String[] pa = String.valueOf(a).split("-", 2)[0].split("\\.");
        String[] pb = String.valueOf(b).split("-", 2)[0].split("\\.");
        for (int i = 0; i < 3; i++) {
            long da = i < pa.length ? jsParseLong(pa[i], 0) : 0;
            long db = i < pb.length ? jsParseLong(pb[i], 0) : 0;
            if (da != db) return da < db ? -1 : 1;
        }
        return 0;
    }

    private static String asString(Object o) {
        return o instanceof String ? (String) o : null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    private static boolean truthyString(Object o) {
        return o instanceof String && !((String) o).isEmpty();
    }

    // ── planManagedInstall ──────────────────────────────────────────────────

    /**
     * Resolve target version + tarball URL + expected integrity from npm
     * registry metadata (a VERSION MANIFEST or a PACKUMENT). Fail-closed:
     * no dist / http tarball / missing integrity+shasum / below the floor all
     * return {@code {ok:false, error}} instead of a best-effort plan.
     * Twin of the JS {@code planManagedInstall} — fixture-locked.
     */
    public static Map<String, Object> planManagedInstall(
            String requestedVersion, Map<String, Object> registryMeta, String floorVersion) {
        Map<String, Object> out = map();
        if (registryMeta == null) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "no-registry-meta");
            return out;
        }
        Map<String, Object> manifest = registryMeta;
        Map<String, Object> versions = asMap(registryMeta.get("versions"));
        if (versions != null) {
            // Packument form: resolve the requested version through dist-tags.
            String v;
            if (requestedVersion == null || requestedVersion.isEmpty()
                    || "latest".equals(requestedVersion)) {
                Map<String, Object> distTags = asMap(registryMeta.get("dist-tags"));
                v = distTags == null ? null : asString(distTags.get("latest"));
            } else {
                v = requestedVersion;
            }
            manifest = truthyString(v) ? asMap(versions.get(v)) : null;
            if (manifest == null) {
                out.put("ok", Boolean.FALSE);
                out.put("error", "version-not-found");
                out.put("version", truthyString(v) ? v : null);
                return out;
            }
        }
        String name = asString(manifest.get("name"));
        if (truthyString(name) && !PACKAGE_NAME.equals(name)) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "wrong-package");
            out.put("name", name);
            return out;
        }
        String version = asString(manifest.get("version"));
        if (!truthyString(version)) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "no-version");
            return out;
        }
        Map<String, Object> dist = asMap(manifest.get("dist"));
        String tarball = dist == null ? null : asString(dist.get("tarball"));
        if (!truthyString(tarball)) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "no-tarball");
            out.put("version", version);
            return out;
        }
        if (!Pattern.compile("^https://", Pattern.CASE_INSENSITIVE).matcher(tarball).find()) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "insecure-tarball-url");
            out.put("version", version);
            return out;
        }
        if (floorVersion != null && !floorVersion.isEmpty()
                && compareVersions(version, floorVersion) < 0) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "below-floor");
            out.put("version", version);
            out.put("floorVersion", floorVersion);
            return out;
        }
        // Prefer the sha512 SRI entry; fall back to the legacy sha1 shasum.
        Map<String, Object> integrity = null;
        String sri = asString(dist.get("integrity"));
        if (truthyString(sri)) {
            for (String part : sri.trim().split("\\s+")) {
                Matcher m = Pattern.compile("^sha512-([A-Za-z0-9+/=]+)$").matcher(part);
                if (m.matches()) {
                    integrity = map();
                    integrity.put("algorithm", "sha512");
                    integrity.put("value", m.group(1));
                    break;
                }
            }
        }
        String shasum = asString(dist.get("shasum"));
        if (integrity == null && truthyString(shasum)
                && Pattern.compile("^[0-9a-fA-F]{40}$").matcher(shasum).matches()) {
            integrity = map();
            integrity.put("algorithm", "sha1");
            integrity.put("value", shasum.toLowerCase(java.util.Locale.ROOT));
        }
        if (integrity == null) {
            out.put("ok", Boolean.FALSE);
            out.put("error", "no-integrity");
            out.put("version", version);
            return out;
        }
        out.put("ok", Boolean.TRUE);
        out.put("version", version);
        out.put("tarballUrl", tarball);
        out.put("integrity", integrity);
        return out;
    }

    // ── verifyTarball ───────────────────────────────────────────────────────

    /**
     * Verify a downloaded tarball against the plan's expected integrity.
     * sha512 compares the base64 digest, sha1 the lowercase hex digest —
     * exactly the JS twin's contract (fixture-locked).
     */
    public static Map<String, Object> verifyTarball(byte[] buffer, Map<String, Object> expected) {
        Map<String, Object> out = map();
        String algorithm = expected == null ? null : asString(expected.get("algorithm"));
        String value = expected == null ? null : asString(expected.get("value"));
        if (!truthyString(algorithm) || !truthyString(value)) {
            out.put("ok", Boolean.FALSE);
            out.put("algorithm", "none");
            out.put("expected", "");
            out.put("actual", "");
            return out;
        }
        boolean sha512 = "sha512".equals(algorithm);
        String actual;
        try {
            MessageDigest md = MessageDigest.getInstance(sha512 ? "SHA-512" : "SHA-1");
            byte[] digest = md.digest(buffer == null ? new byte[0] : buffer);
            actual = sha512 ? Base64.getEncoder().encodeToString(digest) : hex(digest);
        } catch (Exception e) {
            actual = "";
        }
        String want = sha512 ? value : value.toLowerCase(java.util.Locale.ROOT);
        out.put("ok", actual.equals(want));
        out.put("algorithm", algorithm);
        out.put("expected", want);
        out.put("actual", actual);
        return out;
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    // ── Minimal pure tar reader (npm .tgz payloads) ─────────────────────────
    // Handles: ustar name+prefix fields, PaxHeader (`x`) `path=` overrides,
    // GNU @LongLink (`L`) long names, header checksum validation, base-256
    // sizes. (This repo was burned by GNU tar @LongLink before — trap #22 —
    // so long-path support is REQUIRED, not optional.)

    /** One parsed tar entry (type: "file" / "dir" / "other"). */
    public static final class TarEntry {
        public final String path;
        public final String type;
        public final int mode;
        public final byte[] data;

        TarEntry(String path, String type, int mode, byte[] data) {
            this.path = path;
            this.type = type;
            this.mode = mode;
            this.data = data;
        }
    }

    /** {@link #parseTarEntries} result: {@code error} XOR {@code entries}. */
    public static final class TarParse {
        public final String error;
        public final List<TarEntry> entries;

        TarParse(String error, List<TarEntry> entries) {
            this.error = error;
            this.entries = entries;
        }
    }

    private static String cString(byte[] buf, int start, int len) {
        int end = start;
        int max = Math.min(start + len, buf.length);
        while (end < max && buf[end] != 0) end++;
        return new String(buf, start, end - start, StandardCharsets.UTF_8);
    }

    private static long octal(byte[] buf, int start, int len) {
        // GNU base-256: high bit of the first byte set → big-endian binary.
        if ((buf[start] & 0x80) != 0) {
            long n = buf[start] & 0x7f;
            for (int i = start + 1; i < start + len; i++) n = n * 256 + (buf[i] & 0xff);
            return n;
        }
        StringBuilder sb = new StringBuilder(len);
        for (int i = start; i < start + len; i++) {
            char c = (char) (buf[i] & 0xff);
            sb.append(c >= '0' && c <= '7' ? c : ' ');
        }
        String t = sb.toString().trim();
        if (t.isEmpty()) return 0;
        try {
            return Long.parseLong(t, 8);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static boolean checksumOk(byte[] header, int off) {
        long stored = octal(header, off + 148, 8);
        long unsignedSum = 0;
        long signedSum = 0;
        for (int i = 0; i < 512; i++) {
            int rel = i;
            int b = rel >= 148 && rel < 156 ? 0x20 : (header[off + i] & 0xff);
            unsignedSum += b;
            signedSum += rel >= 148 && rel < 156 ? 0x20 : (byte) b; // int8 view
        }
        return stored == unsignedSum || stored == signedSum;
    }

    /** Parse {@code LEN key=value\n} pax records into a map. */
    private static Map<String, String> parsePax(byte[] data) {
        Map<String, String> out = new LinkedHashMap<>();
        int off = 0;
        while (off < data.length) {
            int sp = -1;
            for (int i = off; i < data.length; i++) {
                if (data[i] == 0x20) { sp = i; break; }
            }
            if (sp < 0) break;
            String lenStr = new String(data, off, sp - off, StandardCharsets.ISO_8859_1);
            long len = jsParseLong(lenStr, -1);
            if (len <= 0) break;
            int recEnd = (int) Math.min(off + len - 1, data.length); // drop trailing \n
            if (sp + 1 > recEnd) break;
            String rec = new String(data, sp + 1, recEnd - (sp + 1), StandardCharsets.UTF_8);
            int eq = rec.indexOf('=');
            if (eq > 0) out.put(rec.substring(0, eq), rec.substring(eq + 1));
            off += (int) len;
        }
        return out;
    }

    /** Parse an (already gunzipped) tar buffer into entries. */
    public static TarParse parseTarEntries(byte[] tarBuf) {
        List<TarEntry> entries = new ArrayList<>();
        int off = 0;
        String pendingLongName = null;
        Map<String, String> pendingPax = null;
        while (off + 512 <= tarBuf.length) {
            boolean allZero = true;
            for (int i = off; i < off + 512; i++) {
                if (tarBuf[i] != 0) { allZero = false; break; }
            }
            if (allZero) break; // end-of-archive block
            if (!checksumOk(tarBuf, off)) return new TarParse("tar-checksum-mismatch", null);
            long size = octal(tarBuf, off + 124, 12);
            if (size < 0) return new TarParse("tar-bad-size", null);
            int typeByte = tarBuf[off + 156] & 0xff;
            String type = typeByte == 0 ? "0" : String.valueOf((char) typeByte);
            long dataStart = off + 512L;
            long dataEnd = dataStart + size;
            if (dataEnd > tarBuf.length) return new TarParse("tar-truncated", null);
            byte[] data = new byte[(int) size];
            System.arraycopy(tarBuf, (int) dataStart, data, 0, (int) size);
            int headerOff = off;
            off = (int) (dataStart + ((size + 511) / 512) * 512);

            if ("L".equals(type)) {
                // GNU @LongLink: the DATA of this pseudo-entry names the next entry.
                pendingLongName = new String(data, StandardCharsets.UTF_8)
                        .replaceAll("\0+$", "");
                continue;
            }
            if ("x".equals(type) || "X".equals(type)) {
                pendingPax = parsePax(data); // extended header for the NEXT entry
                continue;
            }
            if ("g".equals(type)) continue; // global pax header — ignored

            String name = cString(tarBuf, headerOff, 100);
            String magic = new String(tarBuf, headerOff + 257, 5, StandardCharsets.ISO_8859_1);
            String prefix = magic.startsWith("ustar")
                    ? cString(tarBuf, headerOff + 345, 155) : "";
            String path = name;
            if (!prefix.isEmpty()) path = prefix + "/" + name;
            if (pendingLongName != null) path = pendingLongName; // GNU long name wins
            if (pendingPax != null) {
                String paxPath = pendingPax.get("path");
                if (paxPath != null && !paxPath.isEmpty()) {
                    path = paxPath; // pax `path=` outranks everything
                }
            }
            pendingLongName = null;
            pendingPax = null;
            long mode = octal(tarBuf, headerOff + 100, 8);
            entries.add(new TarEntry(
                    path,
                    "0".equals(type) ? "file" : "5".equals(type) ? "dir" : "other",
                    (int) (mode != 0 ? mode : 0644 /* octal 0644 */),
                    data));
        }
        return new TarParse(null, entries);
    }

    /** One file in a safe extraction plan. */
    public static final class FileItem {
        public final String path;
        public final byte[] data;
        public final int mode;

        FileItem(String path, byte[] data, int mode) {
            this.path = path;
            this.data = data;
            this.mode = mode;
        }
    }

    /** {@link #planExtraction} result: {@code error[/errorPath]} XOR files+dirs. */
    public static final class Extraction {
        public final String error;
        public final String errorPath;
        public final List<FileItem> files;
        public final List<String> dirs;
        public final long totalBytes;

        Extraction(String error, String errorPath,
                   List<FileItem> files, List<String> dirs, long totalBytes) {
            this.error = error;
            this.errorPath = errorPath;
            this.files = files;
            this.dirs = dirs;
            this.totalBytes = totalBytes;
        }
    }

    /**
     * Filter parsed tar entries into a safe extraction plan (twin of the JS
     * {@code planExtraction}):
     * <ul>
     * <li>Only entries under the npm {@code package/} root are accepted
     *     (anything else ⇒ {@code unexpected-layout} — fail-closed).</li>
     * <li>Zip-slip guard: absolute paths, drive letters, backslashes, {@code ..}
     *     and NUL bytes are rejected with {@code unsafe-path}.</li>
     * <li>Caps: maxFiles entries / maxTotalBytes payload.</li>
     * </ul>
     */
    public static Extraction planExtraction(List<TarEntry> entries, int maxFiles, long maxTotalBytes) {
        List<FileItem> files = new ArrayList<>();
        TreeSet<String> dirs = new TreeSet<>();
        long totalBytes = 0;
        for (TarEntry e : entries) {
            if ("other".equals(e.type)) continue; // links/devices/fifos — never extract
            String raw = e.path == null ? "" : e.path;
            if (raw.isEmpty()) return new Extraction("unsafe-path", raw, null, null, 0);
            if (raw.indexOf('\\') >= 0 || raw.indexOf('\0') >= 0) {
                return new Extraction("unsafe-path", raw, null, null, 0);
            }
            if (raw.startsWith("/") || raw.matches("^[A-Za-z]:.*")) {
                return new Extraction("unsafe-path", raw, null, null, 0);
            }
            List<String> segs = new ArrayList<>();
            for (String s : raw.split("/")) {
                if (!s.isEmpty() && !".".equals(s)) segs.add(s);
            }
            for (String s : segs) {
                if ("..".equals(s)) return new Extraction("unsafe-path", raw, null, null, 0);
            }
            if (segs.isEmpty()) continue;
            if (!"package".equals(segs.get(0))) {
                return new Extraction("unexpected-layout", raw, null, null, 0);
            }
            String norm = String.join("/", segs);
            if ("dir".equals(e.type)) {
                dirs.add(norm);
                continue;
            }
            if (segs.size() < 2) return new Extraction("unexpected-layout", raw, null, null, 0);
            files.add(new FileItem(norm, e.data, e.mode));
            dirs.add(String.join("/", segs.subList(0, segs.size() - 1)));
            totalBytes += e.data.length;
            if (files.size() > maxFiles) return new Extraction("too-many-files", null, null, null, 0);
            if (totalBytes > maxTotalBytes) return new Extraction("too-large", null, null, null, 0);
        }
        if (files.isEmpty()) return new Extraction("empty-package", null, null, null, 0);
        return new Extraction(null, null, files, new ArrayList<>(dirs), totalBytes);
    }

    /** Gunzip + parse + plan with the default caps. */
    public static Extraction extractPackage(byte[] tgzBuffer) {
        return extractPackage(tgzBuffer, MAX_ENTRY_COUNT, MAX_TOTAL_BYTES);
    }

    /** Gunzip + parse + plan. Any gunzip failure ⇒ {@code gunzip-failed}. */
    public static Extraction extractPackage(byte[] tgzBuffer, int maxFiles, long maxTotalBytes) {
        byte[] tarBuf;
        try {
            tarBuf = gunzip(tgzBuffer);
        } catch (Exception | OutOfMemoryError e) {
            return new Extraction("gunzip-failed", null, null, null, 0);
        }
        TarParse parsed = parseTarEntries(tarBuf);
        if (parsed.error != null) return new Extraction(parsed.error, null, null, null, 0);
        return planExtraction(parsed.entries, maxFiles, maxTotalBytes);
    }

    /** In-memory gunzip with a hard 1 GiB bomb cap (Node buffers cap similarly). */
    private static byte[] gunzip(byte[] gz) throws java.io.IOException {
        final long cap = 1L << 30;
        try (java.util.zip.GZIPInputStream in = new java.util.zip.GZIPInputStream(
                new java.io.ByteArrayInputStream(gz == null ? new byte[0] : gz))) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > cap) throw new java.io.IOException("gunzip output exceeds cap");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    // ── Install state + rollback ────────────────────────────────────────────

    /** Parse current.json text; null on any corruption (never throws). */
    public static Map<String, Object> parseStateJson(String text) {
        try {
            Object parsed = MiniJson.parse(String.valueOf(text));
            Map<String, Object> s = asMap(parsed);
            if (s == null || !(s.get("version") instanceof String)) return null;
            Map<String, Object> out = map();
            out.put("version", s.get("version"));
            out.put("installedAt", s.get("installedAt") instanceof Number
                    ? Long.valueOf(((Number) s.get("installedAt")).longValue())
                    : Long.valueOf(0));
            out.put("previousVersion", s.get("previousVersion") instanceof String
                    ? s.get("previousVersion") : null);
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * The state after installing {@code version} over {@code previousState}.
     * Reinstalling the SAME version keeps the old previousVersion (a repair
     * must not destroy the rollback target). Fixture-locked.
     */
    public static Map<String, Object> nextState(String version, Map<String, Object> previousState, long now) {
        String prev = null;
        if (previousState != null) {
            String prevVersion = asString(previousState.get("version"));
            if (truthyString(prevVersion) && !prevVersion.equals(version)) {
                prev = prevVersion;
            } else {
                String kept = asString(previousState.get("previousVersion"));
                prev = truthyString(kept) ? kept : null;
            }
        }
        Map<String, Object> out = map();
        out.put("version", version);
        out.put("installedAt", Long.valueOf(now));
        out.put("previousVersion", prev);
        return out;
    }

    /**
     * One-step rollback plan (fixture-locked). {@code hasVersionDir} is the
     * injected disk probe.
     */
    public static Map<String, Object> rollbackPlan(
            Map<String, Object> state, Predicate<String> hasVersionDir, long now) {
        Map<String, Object> out = map();
        if (state == null || !truthyString(asString(state.get("version")))) {
            out.put("ok", Boolean.FALSE);
            out.put("reason", "no-state");
            return out;
        }
        String prev = asString(state.get("previousVersion"));
        if (!truthyString(prev)) {
            out.put("ok", Boolean.FALSE);
            out.put("reason", "no-previous");
            return out;
        }
        if (hasVersionDir != null && !hasVersionDir.test(prev)) {
            out.put("ok", Boolean.FALSE);
            out.put("reason", "previous-missing");
            return out;
        }
        Map<String, Object> newState = map();
        newState.put("version", prev);
        newState.put("installedAt", Long.valueOf(now));
        // Rolling back consumes the slot — no ping-pong chain is kept.
        newState.put("previousVersion", null);
        out.put("ok", Boolean.TRUE);
        out.put("version", prev);
        out.put("newState", newState);
        return out;
    }

    // ── Binary resolution + launcher shims ──────────────────────────────────

    /**
     * The bin entry (relative path) of an extracted package.json. Prefers
     * {@code bin.cc}, then the package name, then any entry; a string
     * {@code bin} is used as-is; null when absent.
     */
    public static String packageBinEntry(Map<String, Object> pkgJson) {
        if (pkgJson == null) return null;
        Object bin = pkgJson.get("bin");
        if (bin instanceof String && !((String) bin).isEmpty()) return (String) bin;
        Map<String, Object> binMap = asMap(bin);
        if (binMap != null) {
            Object rel = binMap.get("cc");
            if (!truthyString(rel)) rel = binMap.get(PACKAGE_NAME);
            if (!truthyString(rel)) {
                for (Object v : binMap.values()) { rel = v; break; }
            }
            return truthyString(rel) ? (String) rel : null;
        }
        return null;
    }

    /** Injected filesystem view for {@link #resolveManagedBinary}. */
    public interface ResolveIo {
        boolean exists(String path);

        /** Parsed package.json, or null on any failure. */
        Map<String, Object> readJson(String path);

        /** Path join; the default separator-joins like node path.join. */
        default String join(String... parts) {
            return ManagedCliRuntime.joinFs(parts);
        }
    }

    /**
     * Resolve the managed install to a spawnable {@code node <entry>}
     * invocation, or null. All filesystem access injected.
     * Returns {@code {version, entry, nodeArgs:[entry]}}.
     */
    public static Map<String, Object> resolveManagedBinary(
            String rootDir, Map<String, Object> state, ResolveIo io) {
        if (rootDir == null || rootDir.isEmpty() || state == null || io == null) return null;
        String version = asString(state.get("version"));
        if (!truthyString(version)) return null;
        String pkgDir = io.join(rootDir, version, "package");
        String pkgJsonPath = io.join(pkgDir, "package.json");
        if (!io.exists(pkgJsonPath)) return null;
        Map<String, Object> pkg = io.readJson(pkgJsonPath);
        String binRel = packageBinEntry(pkg);
        if (binRel == null) return null;
        List<String> parts = new ArrayList<>();
        parts.add(pkgDir);
        for (String s : binRel.split("/")) {
            if (!s.isEmpty() && !".".equals(s)) parts.add(s);
        }
        String entry = io.join(parts.toArray(new String[0]));
        if (!io.exists(entry)) return null;
        Map<String, Object> out = map();
        out.put("version", version);
        out.put("entry", entry);
        List<String> nodeArgs = new ArrayList<>();
        nodeArgs.add(entry);
        out.put("nodeArgs", nodeArgs);
        return out;
    }

    /**
     * Launcher shim scripts wrapping {@code node "<entry>" <args…>}; node is
     * resolved from PATH at RUN time. Unquotable entry paths (a double quote /
     * CR / LF) ⇒ {@code {error:"unquotable-entry-path"}} — fail-closed.
     */
    public static Map<String, Object> buildLauncherScripts(String entryPath) {
        Map<String, Object> out = map();
        if (entryPath == null || entryPath.isEmpty()
                || Pattern.compile("[\"\r\n]").matcher(entryPath).find()) {
            out.put("error", "unquotable-entry-path");
            return out;
        }
        Map<String, Object> windows = map();
        windows.put("name", SHIM_BASE + ".cmd");
        windows.put("content", "@ECHO OFF\r\nnode \"" + entryPath + "\" %*\r\n");
        Map<String, Object> posix = map();
        posix.put("name", SHIM_BASE);
        posix.put("content", "#!/bin/sh\nexec node \"" + entryPath + "\" \"$@\"\n");
        posix.put("mode", Integer.valueOf(0755));
        out.put("windows", windows);
        out.put("posix", posix);
        return out;
    }

    /** Shim file name for a platform ({@code "win32"} vs anything else). */
    public static String shimName(String platform) {
        return "win32".equals(platform) ? SHIM_BASE + ".cmd" : SHIM_BASE;
    }

    /**
     * The command string spawn sites can use. Windows spawns go through
     * cmd.exe, so a path with whitespace must be pre-quoted; POSIX spawns are
     * shell-less and take the raw path.
     */
    public static String commandForSpawn(String shimPath, String platform) {
        if ("win32".equals(platform) && Pattern.compile("\\s").matcher(shimPath).find()) {
            return "\"" + shimPath + "\"";
        }
        return shimPath;
    }

    /**
     * Explicit diagnostic for whether a managed runtime is even possible:
     * {@code {ok:true, version}} / {@code {ok:false, reason:"no-node"}} /
     * {@code {ok:false, reason:"node-too-old", version}}.
     */
    public static Map<String, Object> managedNodeDiagnostic(
            String nodeVersionOutput, String minNodeVersion) {
        Map<String, Object> out = map();
        Matcher m = Pattern.compile("v?(\\d+\\.\\d+\\.\\d+)")
                .matcher(String.valueOf(nodeVersionOutput == null ? "" : nodeVersionOutput));
        if (!m.find()) {
            out.put("ok", Boolean.FALSE);
            out.put("reason", "no-node");
            return out;
        }
        String version = m.group(1);
        if (minNodeVersion != null && !minNodeVersion.isEmpty()
                && compareVersions(version, minNodeVersion) < 0) {
            out.put("ok", Boolean.FALSE);
            out.put("reason", "node-too-old");
            out.put("version", version);
            return out;
        }
        out.put("ok", Boolean.TRUE);
        out.put("version", version);
        return out;
    }

    // ── Candidate ordering (the decision core — fixture-locked) ─────────────

    /**
     * Ordered CLI-source decision, twin of the JS {@code deriveCliCandidates}
     * and locked by {@code candidate-cases.json}. Order: explicit setting >
     * usable global (≥ floor) > managed (enabled + node on PATH) > outdated
     * global > none. A broken explicit path is STILL used (never silently
     * replaced — iron rule); we emit {@code explicit-path-broken} and may
     * OFFER the managed copy.
     *
     * @param input {@code {configured:{path,usable}|null, global:{binary,version}|null,
     *              managed:{command,version}|null, managedEnabled, nodeOnPath,
     *              floorVersion}}
     * @return {@code {use, command, offerManaged, diagnostics}} (diagnostics
     *         order is significant)
     */
    public static Map<String, Object> deriveCliCandidates(Map<String, Object> input) {
        Map<String, Object> in = input == null ? map() : input;
        Map<String, Object> configured = asMap(in.get("configured"));
        Map<String, Object> globalProbe = asMap(in.get("global"));
        Map<String, Object> managed = asMap(in.get("managed"));
        boolean managedEnabled = !Boolean.FALSE.equals(in.get("managedEnabled"));
        boolean nodeOnPath = Boolean.TRUE.equals(in.get("nodeOnPath"));
        String floorVersion = asString(in.get("floorVersion"));

        List<String> diagnostics = new ArrayList<>();

        // 1. Explicit setting always wins — broken or not.
        String configuredPath = configured == null ? null : asString(configured.get("path"));
        if (truthyString(configuredPath)) {
            boolean offerManaged = false;
            if (Boolean.FALSE.equals(configured.get("usable"))) {
                push(diagnostics, "explicit-path-broken");
                if (!managedEnabled) push(diagnostics, "managed-disabled");
                else if (!nodeOnPath) push(diagnostics, "no-node-on-path");
                else offerManaged = true; // OFFER only — the setting stays authoritative
            }
            return candidateResult("explicit", configuredPath, offerManaged, diagnostics);
        }

        // 2. A global cc at (or above) the floor.
        boolean globalMeetsFloor = globalProbe != null
                && (!truthyString(floorVersion)
                        || compareVersions(asString(globalProbe.get("version")), floorVersion) >= 0);
        if (globalMeetsFloor) {
            return candidateResult("global", asString(globalProbe.get("binary")),
                    false, diagnostics);
        }

        // 3. An installed managed copy (needs the feature enabled + node on PATH).
        if (managed != null) {
            if (!managedEnabled) push(diagnostics, "managed-disabled");
            else if (!nodeOnPath) push(diagnostics, "no-node-on-path");
            else {
                if (globalProbe != null) push(diagnostics, "global-below-floor");
                return candidateResult("managed", asString(managed.get("command")),
                        false, diagnostics);
            }
        }

        // 4. A below-floor global still beats nothing (version-check nudges it).
        if (globalProbe != null) {
            push(diagnostics, "global-below-floor");
            return candidateResult("global", asString(globalProbe.get("binary")),
                    managed == null && managedEnabled && nodeOnPath, diagnostics);
        }

        // 5. Nothing usable. Offer a managed download when it is actually
        //    possible; otherwise say exactly why it is not (明确诊断).
        boolean offerManaged = false;
        if (!managedEnabled) push(diagnostics, "managed-disabled");
        else if (!nodeOnPath) push(diagnostics, "no-node-on-path");
        else offerManaged = true;
        return candidateResult("none", null, offerManaged, diagnostics);
    }

    private static void push(List<String> diagnostics, String d) {
        if (!diagnostics.contains(d)) diagnostics.add(d);
    }

    private static Map<String, Object> candidateResult(
            String use, String command, boolean offerManaged, List<String> diagnostics) {
        Map<String, Object> out = map();
        out.put("use", use);
        out.put("command", command);
        out.put("offerManaged", offerManaged ? Boolean.TRUE : Boolean.FALSE);
        out.put("diagnostics", diagnostics);
        return out;
    }
}
