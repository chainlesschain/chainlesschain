package com.chainlesschain.ide;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.zip.GZIPOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * ManagedCli / ManagedCliRuntime (pure) — the decision core is driven by the
 * SAME shared twin fixtures as the VS Code extension
 * ({@code packages/vscode-extension/src/__fixtures__/managed-cli/}, consumed
 * by the JS side's vscode-ext-managed-cli.test.js). Both sides MUST produce
 * byte-identical decisions on these files — the fixtures are read directly
 * from the vscode-extension package (never copied, never modified), and
 * {@link #sharedFixturesExistAndAreWellFormed()} fails loudly on drift.
 *
 * <p>Tar extraction is exercised against hand-rolled tar bytes built in-test
 * (PaxHeader long-path override, GNU @LongLink, ustar prefix, zip-slip
 * rejection, caps), mirroring the JS test's builders byte-for-byte.
 */
class ManagedCliTest {

    // ── Shared fixture loading (direct cross-package read) ──────────────────

    private static final String[] FIXTURE_FILES = {
            "registry-meta.json", "plan-cases.json", "verify-cases.json",
            "state-cases.json", "candidate-cases.json",
    };

    /** Gradle's test working dir is the plugin dir; tolerate the repo root too. */
    private static Path fixturesDir() {
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension",
                "../../packages/vscode-extension" }) {
            Path p = Paths.get(root, "src", "__fixtures__", "managed-cli");
            if (Files.isDirectory(p)) return p;
        }
        throw new AssertionError(
                "shared managed-cli twin fixtures not found (fixture drift or moved dir?)"
                        + " cwd=" + Paths.get("").toAbsolutePath());
    }

    private static Object fixture(String name) {
        try {
            return MiniJson.parse(Files.readString(
                    fixturesDir().resolve(name), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AssertionError("cannot read shared fixture " + name, e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> fixtureObj(String name) {
        return (Map<String, Object>) fixture(name);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> fixtureCases(String name) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : (List<Object>) fixture(name)) {
            out.add((Map<String, Object>) o);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> obj(Object o) {
        return (Map<String, Object>) o;
    }

    @Test
    void sharedFixturesExistAndAreWellFormed() {
        // Drift guard: the twin contract lives in the vscode-extension package;
        // a moved/renamed fixture must fail HERE, not silently run zero cases.
        Path dir = fixturesDir();
        for (String f : FIXTURE_FILES) {
            assertTrue(Files.isRegularFile(dir.resolve(f)), "missing shared fixture " + f);
        }
        assertTrue(fixtureCases("plan-cases.json").size() >= 12, "plan cases shrank");
        assertTrue(fixtureCases("verify-cases.json").size() >= 3, "verify cases shrank");
        assertTrue(fixtureCases("state-cases.json").size() >= 7, "state cases shrank");
        assertTrue(fixtureCases("candidate-cases.json").size() >= 14, "candidate cases shrank");
    }

    // ── Fixture-locked twin contract ─────────────────────────────────────────

    @TestFactory
    List<DynamicTest> planManagedInstall_twinFixture() {
        Map<String, Object> registryMeta = fixtureObj("registry-meta.json");
        List<DynamicTest> tests = new ArrayList<>();
        for (Map<String, Object> c : fixtureCases("plan-cases.json")) {
            Map<String, Object> input = obj(c.get("input"));
            tests.add(DynamicTest.dynamicTest((String) c.get("name"), () -> {
                Object metaRef = input.get("metaRef");
                Map<String, Object> meta =
                        metaRef == null ? null : obj(registryMeta.get(metaRef));
                Map<String, Object> res = ManagedCli.planManagedInstall(
                        (String) input.get("requestedVersion"),
                        meta,
                        (String) input.get("floorVersion"));
                assertEquals(c.get("expected"), res);
            }));
        }
        return tests;
    }

    @TestFactory
    List<DynamicTest> verifyTarball_twinFixture() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Map<String, Object> c : fixtureCases("verify-cases.json")) {
            tests.add(DynamicTest.dynamicTest((String) c.get("name"), () -> {
                Map<String, Object> res = ManagedCli.verifyTarball(
                        ((String) c.get("payloadUtf8")).getBytes(StandardCharsets.UTF_8),
                        obj(c.get("integrity")));
                // Same consumption as the JS twin: every key present in
                // `expected` must match exactly.
                for (Map.Entry<String, Object> e : obj(c.get("expected")).entrySet()) {
                    assertEquals(e.getValue(), res.get(e.getKey()), e.getKey());
                }
            }));
        }
        return tests;
    }

    @TestFactory
    List<DynamicTest> stateMachine_twinFixture() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Map<String, Object> c : fixtureCases("state-cases.json")) {
            Map<String, Object> input = obj(c.get("input"));
            tests.add(DynamicTest.dynamicTest((String) c.get("name"), () -> {
                Map<String, Object> res;
                if ("next".equals(c.get("op"))) {
                    res = ManagedCli.nextState(
                            (String) input.get("version"),
                            input.get("previousState") == null
                                    ? null : obj(input.get("previousState")),
                            ((Number) input.get("now")).longValue());
                } else {
                    @SuppressWarnings("unchecked")
                    List<Object> diskVersions = (List<Object>) input.get("diskVersions");
                    res = ManagedCli.rollbackPlan(
                            input.get("state") == null ? null : obj(input.get("state")),
                            diskVersions::contains,
                            ((Number) input.get("now")).longValue());
                }
                assertEquals(c.get("expected"), res);
            }));
        }
        return tests;
    }

    @TestFactory
    List<DynamicTest> deriveCliCandidates_twinFixture() {
        List<DynamicTest> tests = new ArrayList<>();
        for (Map<String, Object> c : fixtureCases("candidate-cases.json")) {
            tests.add(DynamicTest.dynamicTest((String) c.get("name"), () ->
                    assertEquals(c.get("expected"),
                            ManagedCli.deriveCliCandidates(obj(c.get("input"))))));
        }
        return tests;
    }

    @Test
    void verifyTarball_failsOnRealDecodedByteFlip() {
        byte[] tgz = makeCliTgz("1.0.0");
        Map<String, Object> plan =
                ManagedCli.planManagedInstall("latest", metaFor("1.0.0", tgz), null);
        assertEquals(Boolean.TRUE, plan.get("ok"));
        Map<String, Object> integrity = obj(plan.get("integrity"));
        byte[] tampered = tgz.clone();
        tampered[0] ^= (byte) 0xff;
        assertEquals(Boolean.TRUE, ManagedCli.verifyTarball(tgz, integrity).get("ok"));
        assertEquals(Boolean.FALSE, ManagedCli.verifyTarball(tampered, integrity).get("ok"));
    }

    @Test
    void parseStateJson_survivesCorruption() {
        assertNull(ManagedCli.parseStateJson("not json"));
        assertNull(ManagedCli.parseStateJson("{\"nope\":1}"));
        Map<String, Object> ok = ManagedCli.parseStateJson(
                "{\"version\":\"1.0.0\",\"installedAt\":5,\"previousVersion\":null}");
        assertNotNull(ok);
        assertEquals("1.0.0", ok.get("version"));
        assertEquals(5L, ok.get("installedAt"));
        assertNull(ok.get("previousVersion"));
    }

    // ── Tar builders (test-only, byte-mirrors the JS test's builders) ───────

    private static byte[] tarHeader(String name, long size, char type, String prefix) {
        byte[] h = new byte[512];
        byte[] nb = name.getBytes(StandardCharsets.UTF_8);
        System.arraycopy(nb, 0, h, 0, Math.min(nb.length, 100));
        writeLatin1(h, 100, "0000644\0"); // mode
        writeLatin1(h, 108, "0000000\0"); // uid
        writeLatin1(h, 116, "0000000\0"); // gid
        writeLatin1(h, 124, padOctal(size, 11) + "\0");
        writeLatin1(h, 136, "00000000000\0"); // mtime
        h[156] = (byte) type;
        writeLatin1(h, 257, "ustar"); // magic (NUL-terminated by the alloc)
        writeLatin1(h, 263, "00"); // version
        if (prefix != null) {
            byte[] pb = prefix.getBytes(StandardCharsets.UTF_8);
            System.arraycopy(pb, 0, h, 345, Math.min(pb.length, 155));
        }
        Arrays.fill(h, 148, 156, (byte) 0x20); // checksum field = spaces while summing
        long sum = 0;
        for (byte b : h) sum += b & 0xff;
        writeLatin1(h, 148, padOctal(sum, 6) + "\0 ");
        return h;
    }

    private static void writeLatin1(byte[] dst, int off, String s) {
        byte[] b = s.getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(b, 0, dst, off, b.length);
    }

    private static String padOctal(long v, int width) {
        StringBuilder s = new StringBuilder(Long.toOctalString(v));
        while (s.length() < width) s.insert(0, '0');
        return s.toString();
    }

    private static byte[] tarEntry(String name, byte[] data, char type, String prefix) {
        long size = type == '5' ? 0 : data.length;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(tarHeader(name, size, type, prefix));
        if (size > 0) {
            byte[] padded = new byte[(int) ((size + 511) / 512) * 512];
            System.arraycopy(data, 0, padded, 0, (int) size);
            out.writeBytes(padded);
        }
        return out.toByteArray();
    }

    private static byte[] tarEntry(String name, String content) {
        return tarEntry(name, content.getBytes(StandardCharsets.UTF_8), '0', null);
    }

    private static byte[] makeTar(byte[]... entries) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] e : entries) out.writeBytes(e);
        out.writeBytes(new byte[1024]); // two zero blocks = EOF
        return out.toByteArray();
    }

    private static byte[] gzip(byte[] data) {
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            try (GZIPOutputStream gz = new GZIPOutputStream(bos)) {
                gz.write(data);
            }
            return bos.toByteArray();
        } catch (IOException e) {
            throw new AssertionError(e);
        }
    }

    private static byte[] makeTgz(byte[]... entries) {
        return gzip(makeTar(entries));
    }

    /** A pax extended-header record: "LEN key=value\n" with self-counting LEN. */
    private static String paxRecord(String key, String value) {
        String body = " " + key + "=" + value + "\n";
        int len = body.length() + 1;
        while (String.valueOf(len).length() + body.length() != len) {
            len = String.valueOf(len).length() + body.length();
        }
        return len + body;
    }

    /** A minimal valid chainlesschain-shaped package tgz. */
    private static byte[] makeCliTgz(String version) {
        String pkg = "{\"name\":\"chainlesschain\",\"version\":\"" + version + "\","
                + "\"bin\":{\"chainlesschain\":\"./bin/chainlesschain.js\","
                + "\"cc\":\"./bin/chainlesschain.js\"}}";
        return makeTgz(
                tarEntry("package/", new byte[0], '5', null),
                tarEntry("package/package.json", pkg),
                tarEntry("package/bin/", new byte[0], '5', null),
                tarEntry("package/bin/chainlesschain.js",
                        "#!/usr/bin/env node\nconsole.log(\"" + version + "\");\n"));
    }

    /** Registry version-manifest for a tgz built above, with a REAL sha512. */
    private static Map<String, Object> metaFor(String version, byte[] tgz) {
        try {
            String sri = "sha512-" + Base64.getEncoder().encodeToString(
                    MessageDigest.getInstance("SHA-512").digest(tgz));
            Map<String, Object> dist = new LinkedHashMap<>();
            dist.put("tarball", "https://registry.npmjs.org/chainlesschain/-/chainlesschain-"
                    + version + ".tgz");
            dist.put("integrity", sri);
            Map<String, Object> meta = new LinkedHashMap<>();
            meta.put("name", "chainlesschain");
            meta.put("version", version);
            meta.put("dist", dist);
            return meta;
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private static List<String> filePaths(ManagedCli.Extraction res) {
        List<String> paths = new ArrayList<>();
        for (ManagedCli.FileItem f : res.files) paths.add(f.path);
        java.util.Collections.sort(paths);
        return paths;
    }

    // ── Tar extraction ───────────────────────────────────────────────────────

    @Test
    void extractsNormalNpmLayout() {
        ManagedCli.Extraction res = ManagedCli.extractPackage(makeCliTgz("2.0.0"));
        assertNull(res.error);
        assertEquals(Arrays.asList(
                "package/bin/chainlesschain.js", "package/package.json"), filePaths(res));
        assertTrue(res.dirs.contains("package/bin"));
        for (ManagedCli.FileItem f : res.files) {
            if (f.path.equals("package/bin/chainlesschain.js")) {
                assertTrue(new String(f.data, StandardCharsets.UTF_8)
                        .contains("console.log(\"2.0.0\")"));
            }
        }
    }

    @Test
    void paxHeaderPathOverrideWins() {
        StringBuilder sb = new StringBuilder("package/very/long/");
        for (int i = 0; i < 30; i++) sb.append("sub/");
        String longPath = sb.append("deeply-nested-file.js").toString();
        byte[] tgz = makeTgz(
                tarEntry("package/PaxHeader/x",
                        paxRecord("path", longPath).getBytes(StandardCharsets.UTF_8), 'x', null),
                tarEntry("package/short-truncated-name", "long path content"),
                tarEntry("package/package.json", "{}"));
        ManagedCli.Extraction res = ManagedCli.extractPackage(tgz);
        assertNull(res.error);
        List<String> names = filePaths(res);
        assertTrue(names.contains(longPath), "pax path applied");
        assertFalse(names.contains("package/short-truncated-name"), "header name overridden");
    }

    @Test
    void gnuLongLinkAppliesToFollowingEntry() {
        StringBuilder sb = new StringBuilder("package/gnu/");
        for (int i = 0; i < 150; i++) sb.append('x');
        String longName = sb.append(".js").toString();
        byte[] tgz = makeTgz(
                tarEntry("././@LongLink",
                        (longName + "\0").getBytes(StandardCharsets.UTF_8), 'L', null),
                tarEntry("package/gnu-trunc", "gnu long content"));
        ManagedCli.Extraction res = ManagedCli.extractPackage(tgz);
        assertNull(res.error);
        assertEquals(List.of(longName), filePaths(res));
    }

    @Test
    void ustarPrefixIsPrepended() {
        byte[] tgz = makeTgz(tarEntry("file.txt",
                "prefixed".getBytes(StandardCharsets.UTF_8), '0', "package/deep/nested"));
        ManagedCli.Extraction res = ManagedCli.extractPackage(tgz);
        assertNull(res.error);
        assertEquals(List.of("package/deep/nested/file.txt"), filePaths(res));
    }

    @Test
    void rejectsZipSlipTraversal() {
        ManagedCli.Extraction res = ManagedCli.extractPackage(makeTgz(
                tarEntry("package/../../evil.txt", "pwned"),
                tarEntry("package/package.json", "{}")));
        assertEquals("unsafe-path", res.error);
        assertEquals("package/../../evil.txt", res.errorPath);
    }

    @Test
    void rejectsPaxSmuggledZipSlip() {
        ManagedCli.Extraction res = ManagedCli.extractPackage(makeTgz(
                tarEntry("package/PaxHeader/x",
                        paxRecord("path", "package/../../evil").getBytes(StandardCharsets.UTF_8),
                        'x', null),
                tarEntry("package/innocent", "x")));
        assertEquals("unsafe-path", res.error);
    }

    @Test
    void rejectsAbsoluteDriveLetterAndBackslashPaths() {
        for (String bad : new String[] { "/etc/passwd", "C:/evil.txt", "package\\evil.js" }) {
            ManagedCli.Extraction res = ManagedCli.extractPackage(makeTgz(tarEntry(bad, "x")));
            assertEquals("unsafe-path", res.error, bad);
        }
    }

    @Test
    void rejectsUnexpectedLayoutOutsidePackage() {
        assertEquals("unexpected-layout",
                ManagedCli.extractPackage(makeTgz(tarEntry("other/file.js", "x"))).error);
    }

    @Test
    void enforcesFileCountAndTotalSizeCaps() {
        byte[][] entries = {
                tarEntry("package/a.js", "1"),
                tarEntry("package/b.js", "2"),
                tarEntry("package/c.js", "3"),
        };
        assertEquals("too-many-files",
                ManagedCli.extractPackage(makeTgz(entries), 2, ManagedCli.MAX_TOTAL_BYTES).error);
        assertEquals("too-large",
                ManagedCli.extractPackage(makeTgz(entries), ManagedCli.MAX_ENTRY_COUNT, 2).error);
    }

    @Test
    void skipsLinksIgnoresGlobalPaxAndFlagsCorruption() {
        byte[] tgz = makeTgz(
                tarEntry("package/PaxHeader/g",
                        paxRecord("comment", "hi").getBytes(StandardCharsets.UTF_8), 'g', null),
                tarEntry("package/evil-symlink", new byte[0], '2', null),
                tarEntry("package/real.js", "ok"));
        ManagedCli.Extraction res = ManagedCli.extractPackage(tgz);
        assertNull(res.error);
        assertEquals(List.of("package/real.js"), filePaths(res));

        byte[] corrupt = makeTar(tarEntry("package/x.js", "y"));
        corrupt[0] ^= (byte) 0xff; // breaks the header checksum
        assertEquals("tar-checksum-mismatch", ManagedCli.parseTarEntries(corrupt).error);
        assertEquals("gunzip-failed",
                ManagedCli.extractPackage("not gzip".getBytes(StandardCharsets.UTF_8)).error);
    }

    @Test
    void allDirsArchiveIsEmptyPackage() {
        assertEquals("empty-package", ManagedCli.extractPackage(
                makeTgz(tarEntry("package/", new byte[0], '5', null))).error);
    }

    // ── Binary resolution / shims / node diagnostic ──────────────────────────

    @Test
    void packageBinEntryPrefersCcThenPackageNameThenAny() {
        Map<String, Object> bin = new LinkedHashMap<>();
        bin.put("chainlesschain", "./bin/chainlesschain.js");
        bin.put("cc", "./bin/cc-alias.js");
        assertEquals("./bin/cc-alias.js", ManagedCli.packageBinEntry(Map.of("bin", bin)));
        assertEquals("./bin/x.js", ManagedCli.packageBinEntry(
                Map.of("bin", Map.of("chainlesschain", "./bin/x.js"))));
        assertEquals("./o.js", ManagedCli.packageBinEntry(Map.of("bin", Map.of("other", "./o.js"))));
        assertEquals("./cli.js", ManagedCli.packageBinEntry(Map.of("bin", "./cli.js")));
        assertNull(ManagedCli.packageBinEntry(Map.of()));
        assertNull(ManagedCli.packageBinEntry(null));
    }

    /** ResolveIo over a fixed set of existing paths, joining with "/". */
    private static ManagedCli.ResolveIo slashIo(Set<String> known, Map<String, Object> pkgJson) {
        return new ManagedCli.ResolveIo() {
            @Override
            public boolean exists(String path) {
                return known.contains(path);
            }

            @Override
            public Map<String, Object> readJson(String path) {
                return pkgJson;
            }

            @Override
            public String join(String... parts) {
                return String.join("/", parts);
            }
        };
    }

    @Test
    void resolveManagedBinaryResolvesStateToNodeEntry() {
        Map<String, Object> pkgJson = Map.of(
                "name", "chainlesschain", "version", "3.0.0",
                "bin", Map.of("cc", "./bin/chainlesschain.js"));
        String root = "/store/managed-cli";
        String entry = root + "/3.0.0/package/bin/chainlesschain.js";
        Set<String> known = Set.of(root + "/3.0.0/package/package.json", entry);
        Map<String, Object> state = new HashMap<>();
        state.put("version", "3.0.0");
        Map<String, Object> res =
                ManagedCli.resolveManagedBinary(root, state, slashIo(known, pkgJson));
        assertNotNull(res);
        assertEquals("3.0.0", res.get("version"));
        assertEquals(entry, res.get("entry"));
        assertEquals(List.of(entry), res.get("nodeArgs"));
    }

    @Test
    void resolveManagedBinaryNullOnMissingPieces() {
        Map<String, Object> pkgJson = Map.of("bin", Map.of("cc", "./bin/chainlesschain.js"));
        String root = "/store/managed-cli";
        Map<String, Object> state = new HashMap<>();
        state.put("version", "3.0.0");
        assertNull(ManagedCli.resolveManagedBinary(root, null, slashIo(Set.of(), pkgJson)));
        assertNull(ManagedCli.resolveManagedBinary(root, state, slashIo(Set.of(), pkgJson)));
        Set<String> onlyPkg = Set.of(root + "/3.0.0/package/package.json");
        assertNull(ManagedCli.resolveManagedBinary(root, state, slashIo(onlyPkg, pkgJson)));
    }

    @Test
    void launcherShimsWrapEntryInNodeForBothPlatforms() {
        Map<String, Object> s = ManagedCli.buildLauncherScripts("/store/v/package/bin/cc.js");
        Map<String, Object> windows = obj(s.get("windows"));
        Map<String, Object> posix = obj(s.get("posix"));
        assertEquals("cc-managed.cmd", windows.get("name"));
        assertEquals("@ECHO OFF\r\nnode \"/store/v/package/bin/cc.js\" %*\r\n",
                windows.get("content"));
        assertEquals("cc-managed", posix.get("name"));
        assertEquals("#!/bin/sh\nexec node \"/store/v/package/bin/cc.js\" \"$@\"\n",
                posix.get("content"));
        assertEquals(0755, posix.get("mode"));
    }

    @Test
    void launcherShimsRefuseUnquotablePathsFailClosed() {
        assertEquals("unquotable-entry-path",
                ManagedCli.buildLauncherScripts("a\"b.js").get("error"));
        assertEquals("unquotable-entry-path",
                ManagedCli.buildLauncherScripts(null).get("error"));
    }

    @Test
    void shimNameAndCommandForSpawnQuotingRules() {
        assertEquals("cc-managed.cmd", ManagedCli.shimName("win32"));
        assertEquals("cc-managed", ManagedCli.shimName("linux"));
        // Windows spawns go through cmd.exe → whitespace must be pre-quoted.
        assertEquals("\"C:\\Users\\Some One\\s\\cc-managed.cmd\"",
                ManagedCli.commandForSpawn("C:\\Users\\Some One\\s\\cc-managed.cmd", "win32"));
        assertEquals("C:\\store\\cc-managed.cmd",
                ManagedCli.commandForSpawn("C:\\store\\cc-managed.cmd", "win32"));
        // POSIX spawns are shell-less → the raw path is correct even with spaces.
        assertEquals("/a b/cc-managed", ManagedCli.commandForSpawn("/a b/cc-managed", "linux"));
    }

    @Test
    void managedNodeDiagnosticCases() {
        Map<String, Object> ok = ManagedCli.managedNodeDiagnostic("v22.16.0\n", "22.12.0");
        assertEquals(Boolean.TRUE, ok.get("ok"));
        assertEquals("22.16.0", ok.get("version"));
        for (String out : new String[] { null, "", "'node' is not recognized" }) {
            Map<String, Object> res = ManagedCli.managedNodeDiagnostic(out, "22.12.0");
            assertEquals(Boolean.FALSE, res.get("ok"));
            assertEquals("no-node", res.get("reason"));
        }
        Map<String, Object> old = ManagedCli.managedNodeDiagnostic("v18.19.0", "22.12.0");
        assertEquals(Boolean.FALSE, old.get("ok"));
        assertEquals("node-too-old", old.get("reason"));
        assertEquals("18.19.0", old.get("version"));
    }

    @Test
    void registryMetaUrlTargetsVersionManifest() {
        assertEquals("https://registry.npmjs.org/chainlesschain/latest",
                ManagedCli.registryMetaUrl(null));
        assertEquals("https://registry.npmjs.org/chainlesschain/0.162.158",
                ManagedCli.registryMetaUrl("0.162.158"));
    }

    // ── AgentChatSession seam (managed consulted only after global probes) ──

    @Test
    void seam_usedOnlyWhenEveryGlobalProbeFails() {
        assertEquals("/store/cc-managed", AgentChatSession.chooseBinaryOrManaged(
                cand -> null, () -> "/store/cc-managed"));
    }

    @Test
    void seam_usableGlobalWinsAndManagedNeverConsulted() {
        AtomicInteger consulted = new AtomicInteger();
        String bin = AgentChatSession.chooseBinaryOrManaged(
                cand -> "cc".equals(cand) ? "0.162.158" : null,
                () -> {
                    consulted.incrementAndGet();
                    return "/store/cc-managed";
                });
        assertEquals("cc", bin);
        assertEquals(0, consulted.get());
    }

    @Test
    void seam_nullOrThrowingSupplierFallsThrough() {
        assertNull(AgentChatSession.chooseBinaryOrManaged(cand -> null, null));
        assertNull(AgentChatSession.chooseBinaryOrManaged(cand -> null, () -> null));
        assertNull(AgentChatSession.chooseBinaryOrManaged(cand -> null, () -> "  "));
        assertNull(AgentChatSession.chooseBinaryOrManaged(cand -> null, () -> {
            throw new RuntimeException("boom");
        }));
    }

    @Test
    void seam_explicitConfiguredPathWinsAndManagedNeverConsulted() {
        // Iron rule end-to-end: with an explicit configured path,
        // resolveBinary() returns it without probing OR consulting managed.
        AtomicInteger consulted = new AtomicInteger();
        Supplier<String> supplier = () -> {
            consulted.incrementAndGet();
            return "/store/cc-managed";
        };
        try {
            AgentChatSession.setManagedCliSupplier(supplier);
            AgentChatSession.setConfiguredBinary("/opt/broken/cc");
            assertEquals("/opt/broken/cc", AgentChatSession.resolveBinary());
            assertEquals(0, consulted.get());
        } finally {
            AgentChatSession.setConfiguredBinary(null);
            AgentChatSession.setManagedCliSupplier(null);
        }
    }

    // ── In-memory FileOps for flow tests ─────────────────────────────────────

    private static final class MemFs implements ManagedCliRuntime.FileOps {
        final Map<String, byte[]> files = new LinkedHashMap<>();
        final Set<String> dirs = new HashSet<>();

        private String sep() {
            return String.valueOf(java.io.File.separatorChar);
        }

        private void addDirChain(String p) {
            String cur = p;
            while (cur != null && !cur.isEmpty()) {
                dirs.add(cur);
                int idx = cur.lastIndexOf(java.io.File.separatorChar);
                if (idx <= 0) break;
                cur = cur.substring(0, idx);
            }
        }

        @Override
        public boolean exists(String path) {
            return files.containsKey(path) || dirs.contains(path);
        }

        @Override
        public String readText(String path) {
            byte[] b = files.get(path);
            return b == null ? null : new String(b, StandardCharsets.UTF_8);
        }

        @Override
        public void writeBytes(String path, byte[] data) {
            int idx = path.lastIndexOf(java.io.File.separatorChar);
            if (idx > 0) addDirChain(path.substring(0, idx));
            files.put(path, data.clone());
        }

        @Override
        public void writeText(String path, String text) {
            writeBytes(path, text.getBytes(StandardCharsets.UTF_8));
        }

        @Override
        public void mkdirs(String path) {
            addDirChain(path);
        }

        @Override
        public void deleteRecursively(String path) {
            files.keySet().removeIf(k -> k.equals(path) || k.startsWith(path + sep()));
            dirs.removeIf(k -> k.equals(path) || k.startsWith(path + sep()));
        }
    }

    private static ManagedCliRuntime.Io ioFor(MemFs fs, Map<String, Object> meta, byte[] tgz) {
        ManagedCliRuntime.Io io = new ManagedCliRuntime.Io();
        io.fetchJson = url -> {
            assertTrue(url.contains("registry.npmjs.org/chainlesschain/"), url);
            return meta;
        };
        io.fetchBuffer = url -> {
            Map<String, Object> dist = obj(meta.get("dist"));
            return url.equals(dist.get("tarball")) ? tgz : null;
        };
        io.fs = fs;
        io.now = () -> 1111L;
        io.windows = false;
        return io;
    }

    private static String j(String... parts) {
        return ManagedCliRuntime.joinFs(parts);
    }

    // ── Full install / resolve / rollback flow (injected IO) ─────────────────

    private static final String ROOT = ManagedCliRuntime.joinFs("/store", "managed-cli");

    @Test
    void install_writesStateShimsAndResolvableCommand() {
        MemFs fs = new MemFs();
        byte[] tgz = makeCliTgz("9.9.9");
        List<String> steps = new ArrayList<>();
        ManagedCliRuntime.Io io = ioFor(fs, metaFor("9.9.9", tgz), tgz);
        io.report = steps::add;
        Map<String, Object> res =
                ManagedCliRuntime.runManagedInstall(ROOT, "latest", null, io);
        assertEquals(Boolean.TRUE, res.get("ok"), String.valueOf(res));
        assertEquals("9.9.9", res.get("version"));
        assertEquals(List.of("resolve", "download", "verify", "extract", "install"), steps);
        Map<String, Object> state = ManagedCliRuntime.readManagedState(ROOT, fs);
        assertEquals("9.9.9", state.get("version"));
        assertEquals(1111L, state.get("installedAt"));
        assertNull(state.get("previousVersion"));
        // Both shims exist; the posix one wraps the entry in PATH `node`.
        String posixShim = fs.readText(j(ROOT, "cc-managed"));
        assertNotNull(posixShim);
        assertTrue(posixShim.contains("exec node "));
        assertTrue(posixShim.contains("chainlesschain.js"));
        assertTrue(fs.exists(j(ROOT, "cc-managed.cmd")));
        // The session can use it immediately.
        Map<String, Object> resolved = ManagedCliRuntime.resolveManagedCommand(ROOT, fs, false);
        assertNotNull(resolved);
        assertEquals("9.9.9", resolved.get("version"));
        assertEquals(j(ROOT, "cc-managed"), resolved.get("command"));
        assertEquals(res.get("command"), resolved.get("command"));
    }

    @Test
    void install_tamperedDownloadRejectedAtVerifyWritesNothing() {
        MemFs fs = new MemFs();
        byte[] tgz = makeCliTgz("9.9.9");
        byte[] evil = tgz.clone();
        evil[evil.length - 1] ^= 0x01;
        Map<String, Object> res = ManagedCliRuntime.runManagedInstall(
                ROOT, "latest", null, ioFor(fs, metaFor("9.9.9", tgz), evil));
        assertEquals(Boolean.FALSE, res.get("ok"));
        assertEquals("verify", res.get("step"));
        assertEquals("integrity-mismatch", res.get("error"));
        assertTrue(fs.files.isEmpty(), "nothing written on verify failure");
        assertNull(ManagedCliRuntime.readManagedState(ROOT, fs));
    }

    @Test
    void install_belowFloorRefusedAtPlanTimeNeverDownloads() {
        MemFs fs = new MemFs();
        byte[] tgz = makeCliTgz("0.1.0");
        ManagedCliRuntime.Io io = ioFor(fs, metaFor("0.1.0", tgz), tgz);
        io.fetchBuffer = url -> {
            throw new AssertionError("must not download");
        };
        Map<String, Object> res =
                ManagedCliRuntime.runManagedInstall(ROOT, "latest", "0.162.47", io);
        assertEquals(Boolean.FALSE, res.get("ok"));
        assertEquals("plan", res.get("step"));
        assertEquals("below-floor", res.get("error"));
    }

    @Test
    void upgradeRecordsRollbackTargetAndRollbackRestoresOneStep() {
        MemFs fs = new MemFs();
        byte[] v9 = makeCliTgz("9.9.9");
        byte[] v10 = makeCliTgz("9.9.10");
        assertEquals(Boolean.TRUE, ManagedCliRuntime.runManagedInstall(
                ROOT, "latest", null, ioFor(fs, metaFor("9.9.9", v9), v9)).get("ok"));
        assertEquals(Boolean.TRUE, ManagedCliRuntime.runManagedInstall(
                ROOT, "latest", null, ioFor(fs, metaFor("9.9.10", v10), v10)).get("ok"));
        Map<String, Object> state = ManagedCliRuntime.readManagedState(ROOT, fs);
        assertEquals("9.9.10", state.get("version"));
        assertEquals("9.9.9", state.get("previousVersion"));
        // Shim now targets 9.9.10…
        assertTrue(fs.readText(j(ROOT, "cc-managed"))
                .contains(j(ROOT, "9.9.10", "package", "bin", "chainlesschain.js")));
        // …rollback flips it back to 9.9.9 and consumes the slot.
        ManagedCliRuntime.Io rbIo = new ManagedCliRuntime.Io();
        rbIo.fs = fs;
        rbIo.now = () -> 2222L;
        rbIo.windows = false;
        Map<String, Object> rb = ManagedCliRuntime.runManagedRollback(ROOT, rbIo);
        assertEquals(Boolean.TRUE, rb.get("ok"), String.valueOf(rb));
        assertEquals("9.9.9", rb.get("version"));
        Map<String, Object> after = ManagedCliRuntime.readManagedState(ROOT, fs);
        assertEquals("9.9.9", after.get("version"));
        assertEquals(2222L, after.get("installedAt"));
        assertNull(after.get("previousVersion"));
        assertTrue(fs.readText(j(ROOT, "cc-managed"))
                .contains(j(ROOT, "9.9.9", "package", "bin", "chainlesschain.js")));
        // A second rollback is gated: nothing to go back to.
        Map<String, Object> rb2 = ManagedCliRuntime.runManagedRollback(ROOT, rbIo);
        assertEquals(Boolean.FALSE, rb2.get("ok"));
        assertEquals("no-previous", rb2.get("reason"));
    }

    @Test
    void rollbackRefusesWhenPreviousVersionDirWasWiped() {
        MemFs fs = new MemFs();
        byte[] v9 = makeCliTgz("9.9.9");
        byte[] v10 = makeCliTgz("9.9.10");
        ManagedCliRuntime.runManagedInstall(ROOT, "latest", null,
                ioFor(fs, metaFor("9.9.9", v9), v9));
        ManagedCliRuntime.runManagedInstall(ROOT, "latest", null,
                ioFor(fs, metaFor("9.9.10", v10), v10));
        fs.deleteRecursively(j(ROOT, "9.9.9"));
        ManagedCliRuntime.Io io = new ManagedCliRuntime.Io();
        io.fs = fs;
        io.windows = false;
        Map<String, Object> rb = ManagedCliRuntime.runManagedRollback(ROOT, io);
        assertEquals(Boolean.FALSE, rb.get("ok"));
        assertEquals("previous-missing", rb.get("reason"));
    }

    @Test
    void resolveManagedCommandQuotesWhitespaceShimOnWindowsOnly() {
        String spacedRoot = j("/Users", "Some One", "managed-cli");
        MemFs fs = new MemFs();
        byte[] tgz = makeCliTgz("9.9.9");
        ManagedCliRuntime.Io io = ioFor(fs, metaFor("9.9.9", tgz), tgz);
        io.windows = true;
        assertEquals(Boolean.TRUE, ManagedCliRuntime.runManagedInstall(
                spacedRoot, "latest", null, io).get("ok"));
        Map<String, Object> win = ManagedCliRuntime.resolveManagedCommand(spacedRoot, fs, true);
        assertEquals("\"" + j(spacedRoot, "cc-managed.cmd") + "\"", win.get("command"));
        Map<String, Object> nix = ManagedCliRuntime.resolveManagedCommand(spacedRoot, fs, false);
        assertEquals(j(spacedRoot, "cc-managed"), nix.get("command"));
    }

    @Test
    void resolveManagedCommandNullWithNoInstallOrCorruptState() {
        MemFs fs = new MemFs();
        assertNull(ManagedCliRuntime.resolveManagedCommand(ROOT, fs, false));
        fs.writeText(j(ROOT, ManagedCli.STATE_FILE), "corrupt{{{");
        assertNull(ManagedCliRuntime.resolveManagedCommand(ROOT, fs, false));
    }

    @Test
    void missingFetchIoIsExplicitPlanFailure() {
        ManagedCliRuntime.Io io = new ManagedCliRuntime.Io();
        io.fs = new MemFs();
        Map<String, Object> res = ManagedCliRuntime.runManagedInstall(ROOT, "latest", null, io);
        assertEquals(Boolean.FALSE, res.get("ok"));
        assertEquals("plan", res.get("step"));
        assertEquals("no-fetch-io", res.get("error"));
    }

    @Test
    void installStateWriteIsLast_reinstallKeepsRollbackTarget() {
        // Re-install of the SAME version keeps previousVersion (repair
        // semantics), matching the fixture-locked nextState rule end-to-end.
        MemFs fs = new MemFs();
        byte[] v9 = makeCliTgz("9.9.9");
        byte[] v10 = makeCliTgz("9.9.10");
        ManagedCliRuntime.runManagedInstall(ROOT, "latest", null,
                ioFor(fs, metaFor("9.9.9", v9), v9));
        ManagedCliRuntime.runManagedInstall(ROOT, "latest", null,
                ioFor(fs, metaFor("9.9.10", v10), v10));
        ManagedCliRuntime.runManagedInstall(ROOT, "latest", null,
                ioFor(fs, metaFor("9.9.10", v10), v10)); // repair, same version
        Map<String, Object> state = ManagedCliRuntime.readManagedState(ROOT, fs);
        assertEquals("9.9.10", state.get("version"));
        assertEquals("9.9.9", state.get("previousVersion"));
    }

    @Test
    void httpsFetcherRefusesNonHttpsBeforeAnyNetwork() {
        for (String bad : new String[] {
                "http://registry.npmjs.org/chainlesschain/latest",
                "ftp://evil/x", "file:///etc/passwd" }) {
            try {
                ManagedCliRuntime.fetchBufferHttps(bad, 1024);
                throw new AssertionError("should have refused " + bad);
            } catch (IOException e) {
                assertTrue(String.valueOf(e.getMessage()).startsWith("insecure-url"), bad);
            }
        }
    }

    @Test
    void defaultRootDirIsUnderUserHomeChainlesschainIde() {
        String root = ManagedCliRuntime.defaultRootDir();
        assertTrue(root.contains(".chainlesschain"));
        assertTrue(root.endsWith("managed-cli-jetbrains"));
    }

    // ── Function<String,String> import guard (keeps the seam signature honest) ─

    @Test
    void chooseBinaryProbeStillPure() {
        Function<String, String> probe = cand -> "chainlesschain".equals(cand) ? "0.1.0" : null;
        assertEquals("chainlesschain", AgentChatSession.chooseBinary(probe));
    }
}
