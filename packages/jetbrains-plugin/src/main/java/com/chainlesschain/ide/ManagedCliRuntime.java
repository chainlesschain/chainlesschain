package com.chainlesschain.ide;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.LongSupplier;

/**
 * Managed CLI runtime — install / rollback / resolve orchestration; the Java
 * twin of the VS Code extension's {@code managed-cli-flow.js}.
 *
 * <p>Thin, still SDK-free layer over {@link ManagedCli} that sequences the
 * real steps (fetch registry meta → download tarball → verify integrity →
 * extract → write shims → update state). Network IO is ALWAYS injected via
 * {@link Io}; the filesystem defaults to {@link #REAL} but is injectable for
 * tests. Every write lands under the caller-supplied rootDir
 * ({@code ~/.chainlesschain/ide/managed-cli-jetbrains} in production) —
 * nothing else on the machine is touched, and a failed install never updates
 * current.json (the previous install, if any, stays active).
 *
 * <p>The IntelliJ glue (actions, settings toggle) lives in
 * {@code intellij/InstallManagedCliAction} / {@code RollbackManagedCliAction};
 * {@link com.chainlesschain.ide.AgentChatSession#setManagedCliSupplier} is the
 * resolution seam — consulted ONLY after every global probe failed, never for
 * an explicit configured path.
 */
public final class ManagedCliRuntime {
    private ManagedCliRuntime() {}

    /** cc's engines floor — a managed copy cannot run on an older node. */
    public static final String MIN_NODE_VERSION = "22.12.0";

    /** Download hard cap (the real .tgz is ~2 MB). */
    public static final long MAX_DOWNLOAD_BYTES = 64L * 1024 * 1024;

    /** Max redirects the https fetchers will follow. */
    public static final int MAX_REDIRECTS = 3;

    // ── Injected filesystem ─────────────────────────────────────────────────

    /** The filesystem subset the flow needs (paths are opaque strings). */
    public interface FileOps {
        boolean exists(String path);

        /** File content as UTF-8 text, or null on any failure. */
        String readText(String path);

        void writeBytes(String path, byte[] data) throws IOException;

        void writeText(String path, String text) throws IOException;

        void mkdirs(String path) throws IOException;

        void deleteRecursively(String path) throws IOException;

        /** Best-effort chmod +x (no-op where there is no exec bit). */
        default void makeExecutable(String path) {}
    }

    /** Real java.nio-backed filesystem. */
    public static final FileOps REAL = new FileOps() {
        @Override
        public boolean exists(String path) {
            try {
                return Files.exists(Paths.get(path));
            } catch (Throwable t) {
                return false;
            }
        }

        @Override
        public String readText(String path) {
            try {
                return Files.readString(Paths.get(path), StandardCharsets.UTF_8);
            } catch (Throwable t) {
                return null;
            }
        }

        @Override
        public void writeBytes(String path, byte[] data) throws IOException {
            Path p = Paths.get(path);
            if (p.getParent() != null) Files.createDirectories(p.getParent());
            Files.write(p, data);
        }

        @Override
        public void writeText(String path, String text) throws IOException {
            Path p = Paths.get(path);
            if (p.getParent() != null) Files.createDirectories(p.getParent());
            Files.writeString(p, text, StandardCharsets.UTF_8);
        }

        @Override
        public void mkdirs(String path) throws IOException {
            Files.createDirectories(Paths.get(path));
        }

        @Override
        public void deleteRecursively(String path) throws IOException {
            Path root = Paths.get(path);
            if (!Files.exists(root)) return;
            try (java.util.stream.Stream<Path> walk = Files.walk(root)) {
                for (Path p : walk.sorted(Comparator.reverseOrder())
                        .collect(java.util.stream.Collectors.toList())) {
                    Files.deleteIfExists(p);
                }
            }
        }

        @Override
        public void makeExecutable(String path) {
            try {
                File f = new File(path);
                //noinspection ResultOfMethodCallIgnored
                f.setExecutable(true, false);
            } catch (Throwable ignored) {
                // Windows has no exec bit — best-effort
            }
        }
    };

    /** Injected side effects for install/rollback. */
    public static final class Io {
        /** GET url → parsed JSON object (MiniJson map), or null. REQUIRED for install. */
        public Function<String, Map<String, Object>> fetchJson;
        /** GET url → raw bytes, or null. REQUIRED for install. */
        public Function<String, byte[]> fetchBuffer;
        public FileOps fs = REAL;
        public LongSupplier now = System::currentTimeMillis;
        /** true ⇒ the "win32" shim/quoting rules apply. */
        public boolean windows = File.separatorChar == '\\';
        /** Progress callback (step ids: resolve/download/verify/extract/install). */
        public Consumer<String> report = s -> {};
    }

    // ── Paths ───────────────────────────────────────────────────────────────

    /**
     * Join path parts with the platform separator, normalizing any {@code /}
     * or {@code \} inside parts (extraction paths use {@code /}) and dropping
     * {@code .} segments — like node's {@code path.join} does. Pure.
     */
    public static String joinFs(String... parts) {
        boolean leadingSep = false;
        List<String> segs = new ArrayList<>();
        boolean first = true;
        for (String p : parts) {
            if (p == null || p.isEmpty()) continue;
            if (first) {
                leadingSep = p.startsWith("/") || p.startsWith("\\");
                first = false;
            }
            for (String s : p.split("[/\\\\]+")) {
                if (!s.isEmpty() && !".".equals(s)) segs.add(s);
            }
        }
        String sep = String.valueOf(File.separatorChar);
        String joined = String.join(sep, segs);
        return leadingSep ? sep + joined : joined;
    }

    /** Production root: {@code ~/.chainlesschain/ide/managed-cli-jetbrains}. */
    public static String defaultRootDir() {
        return joinFs(System.getProperty("user.home", "."),
                ".chainlesschain", "ide", ManagedCli.MANAGED_DIR_NAME + "-jetbrains");
    }

    private static String platformOf(boolean windows) {
        return windows ? "win32" : "posix";
    }

    // ── State + resolution ──────────────────────────────────────────────────

    /** Read + parse current.json (null when absent/corrupt — never throws). */
    public static Map<String, Object> readManagedState(String rootDir, FileOps fs) {
        try {
            String p = joinFs(rootDir, ManagedCli.STATE_FILE);
            if (!fs.exists(p)) return null;
            return ManagedCli.parseStateJson(fs.readText(p));
        } catch (Throwable t) {
            return null;
        }
    }

    private static ManagedCli.ResolveIo resolveIo(FileOps fs) {
        return new ManagedCli.ResolveIo() {
            @Override
            public boolean exists(String path) {
                return fs.exists(path);
            }

            @Override
            public Map<String, Object> readJson(String path) {
                try {
                    String text = fs.readText(path);
                    if (text == null) return null;
                    Object parsed = MiniJson.parse(text);
                    if (parsed instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> m = (Map<String, Object>) parsed;
                        return m;
                    }
                    return null;
                } catch (Throwable t) {
                    return null;
                }
            }

            @Override
            public String join(String... parts) {
                return joinFs(parts);
            }
        };
    }

    /**
     * Resolve an existing managed install to a spawnable command, or null.
     * Used behind {@link AgentChatSession#setManagedCliSupplier} — it must be
     * cheap (state read + a few exists), no spawning, no network.
     *
     * @return {@code {command, version, entry}} map or null
     */
    public static Map<String, Object> resolveManagedCommand(
            String rootDir, FileOps fs, boolean windows) {
        if (rootDir == null || rootDir.isEmpty()) return null;
        Map<String, Object> state = readManagedState(rootDir, fs);
        Map<String, Object> resolved =
                ManagedCli.resolveManagedBinary(rootDir, state, resolveIo(fs));
        if (resolved == null) return null;
        String platform = platformOf(windows);
        String shim = joinFs(rootDir, ManagedCli.shimName(platform));
        if (!fs.exists(shim)) return null; // install/rollback always writes shims
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("command", ManagedCli.commandForSpawn(shim, platform));
        out.put("version", resolved.get("version"));
        out.put("entry", resolved.get("entry"));
        return out;
    }

    /**
     * Default-wired resolver for the {@link AgentChatSession} seam: the
     * command of the managed install under {@link #defaultRootDir()}, or null.
     * Never throws.
     */
    public static String defaultResolveCommand() {
        try {
            Map<String, Object> r = resolveManagedCommand(
                    defaultRootDir(), REAL, File.separatorChar == '\\');
            Object cmd = r == null ? null : r.get("command");
            return cmd instanceof String && !((String) cmd).isEmpty() ? (String) cmd : null;
        } catch (Throwable t) {
            return null;
        }
    }

    // ── Install ─────────────────────────────────────────────────────────────

    private static Map<String, Object> fail(String step, String error) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", Boolean.FALSE);
        out.put("step", step);
        out.put("error", error);
        return out;
    }

    /**
     * Download + verify + extract + activate a managed CLI copy — twin of the
     * JS {@code runManagedInstall}. The state write is LAST; any earlier
     * failure leaves the old install active.
     *
     * @return {@code {ok:true, version, entry, command}} or
     *         {@code {ok:false, step, error[, detail]}}
     */
    public static Map<String, Object> runManagedInstall(
            String rootDir, String requestedVersion, String floorVersion, Io io) {
        if (io == null) io = new Io();
        FileOps fs = io.fs == null ? REAL : io.fs;
        Consumer<String> report = io.report == null ? s -> {} : io.report;
        String requested = requestedVersion == null || requestedVersion.isEmpty()
                ? "latest" : requestedVersion;
        if (rootDir == null || rootDir.isEmpty()) return fail("plan", "no-root-dir");
        if (io.fetchJson == null || io.fetchBuffer == null) {
            return fail("plan", "no-fetch-io");
        }

        report.accept("resolve");
        Map<String, Object> meta;
        try {
            meta = io.fetchJson.apply(ManagedCli.registryMetaUrl(requested));
        } catch (Throwable t) {
            meta = null;
        }
        Map<String, Object> plan =
                ManagedCli.planManagedInstall(requested, meta, floorVersion);
        if (!Boolean.TRUE.equals(plan.get("ok"))) {
            Map<String, Object> out = fail("plan", String.valueOf(plan.get("error")));
            out.put("detail", plan);
            return out;
        }
        String version = (String) plan.get("version");

        report.accept("download");
        byte[] tgz;
        try {
            tgz = io.fetchBuffer.apply((String) plan.get("tarballUrl"));
        } catch (Throwable t) {
            tgz = null;
        }
        if (tgz == null || tgz.length == 0) return fail("download", "download-failed");

        report.accept("verify");
        @SuppressWarnings("unchecked")
        Map<String, Object> integrity = (Map<String, Object>) plan.get("integrity");
        Map<String, Object> verified = ManagedCli.verifyTarball(tgz, integrity);
        if (!Boolean.TRUE.equals(verified.get("ok"))) {
            Map<String, Object> out = fail("verify", "integrity-mismatch");
            out.put("detail", verified);
            return out;
        }

        report.accept("extract");
        ManagedCli.Extraction extraction = ManagedCli.extractPackage(tgz);
        if (extraction.error != null) return fail("extract", extraction.error);

        report.accept("install");
        Map<String, Object> prevState = readManagedState(rootDir, fs);
        String versionDir = joinFs(rootDir, version);
        try {
            // A re-install of the same version starts from a clean slate.
            if (fs.exists(versionDir)) fs.deleteRecursively(versionDir);
            for (String d : extraction.dirs) fs.mkdirs(joinFs(versionDir, d));
            for (ManagedCli.FileItem f : extraction.files) {
                fs.writeBytes(joinFs(versionDir, f.path), f.data); // raw bytes
            }
        } catch (Throwable t) {
            String msg = String.valueOf(t.getMessage() == null ? t : t.getMessage());
            return fail("install",
                    "write-failed:" + msg.substring(0, Math.min(120, msg.length())));
        }

        // Locate the real bin entry from the freshly extracted package.json.
        Map<String, Object> pkg = null;
        for (ManagedCli.FileItem f : extraction.files) {
            if ("package/package.json".equals(f.path)) {
                try {
                    Object parsed = MiniJson.parse(new String(f.data, StandardCharsets.UTF_8));
                    if (parsed instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> m = (Map<String, Object>) parsed;
                        pkg = m;
                    }
                } catch (Throwable ignored) {
                    pkg = null;
                }
                break;
            }
        }
        String binRel = ManagedCli.packageBinEntry(pkg);
        if (binRel == null) return fail("install", "no-bin-entry");
        String entry = joinFs(versionDir, "package", binRel);
        if (!fs.exists(entry)) return fail("install", "bin-entry-missing");

        String shimError = writeShims(rootDir, entry, fs);
        if (shimError != null) return fail("install", shimError);

        // State write is LAST — any earlier failure leaves the old install active.
        Map<String, Object> state = ManagedCli.nextState(version, prevState, io.now.getAsLong());
        try {
            fs.writeText(joinFs(rootDir, ManagedCli.STATE_FILE), MiniJson.stringify(state));
        } catch (Throwable t) {
            return fail("install", "state-write-failed");
        }

        String platform = platformOf(io.windows);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", Boolean.TRUE);
        out.put("version", version);
        out.put("entry", entry);
        out.put("command", ManagedCli.commandForSpawn(
                joinFs(rootDir, ManagedCli.shimName(platform)), platform));
        return out;
    }

    /** Write both launcher shims for {@code entry}; null on success, else the error id. */
    private static String writeShims(String rootDir, String entry, FileOps fs) {
        Map<String, Object> scripts = ManagedCli.buildLauncherScripts(entry);
        if (scripts.get("error") != null) return String.valueOf(scripts.get("error"));
        for (String key : new String[] { "windows", "posix" }) {
            @SuppressWarnings("unchecked")
            Map<String, Object> s = (Map<String, Object>) scripts.get(key);
            String p = joinFs(rootDir, (String) s.get("name"));
            try {
                fs.writeText(p, (String) s.get("content"));
            } catch (Throwable t) {
                return "shim-write-failed";
            }
            if (s.get("mode") != null) fs.makeExecutable(p);
        }
        return null;
    }

    // ── Rollback ────────────────────────────────────────────────────────────

    /**
     * One-step rollback to {@code state.previousVersion} (must still be on
     * disk) — twin of the JS {@code runManagedRollback}.
     *
     * @return {@code {ok:true, version, command}} or {@code {ok:false, reason}}
     */
    public static Map<String, Object> runManagedRollback(String rootDir, Io io) {
        if (io == null) io = new Io();
        final FileOps fs = io.fs == null ? REAL : io.fs;
        Map<String, Object> failOut = new LinkedHashMap<>();
        failOut.put("ok", Boolean.FALSE);
        if (rootDir == null || rootDir.isEmpty()) {
            failOut.put("reason", "no-state");
            return failOut;
        }
        final String root = rootDir;
        Map<String, Object> state = readManagedState(rootDir, fs);
        Map<String, Object> plan = ManagedCli.rollbackPlan(
                state, v -> fs.exists(joinFs(root, v, "package")), io.now.getAsLong());
        if (!Boolean.TRUE.equals(plan.get("ok"))) {
            failOut.put("reason", String.valueOf(plan.get("reason")));
            return failOut;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> newState = (Map<String, Object>) plan.get("newState");
        Map<String, Object> resolved =
                ManagedCli.resolveManagedBinary(rootDir, newState, resolveIo(fs));
        if (resolved == null) {
            failOut.put("reason", "broken-previous");
            return failOut;
        }
        String shimError = writeShims(rootDir, (String) resolved.get("entry"), fs);
        if (shimError != null) {
            failOut.put("reason", "broken-previous");
            return failOut;
        }
        try {
            fs.writeText(joinFs(rootDir, ManagedCli.STATE_FILE), MiniJson.stringify(newState));
        } catch (Throwable t) {
            failOut.put("reason", "broken-previous");
            return failOut;
        }
        String platform = platformOf(io.windows);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", Boolean.TRUE);
        out.put("version", plan.get("version"));
        out.put("command", ManagedCli.commandForSpawn(
                joinFs(rootDir, ManagedCli.shimName(platform)), platform));
        return out;
    }

    // ── HTTPS fetch (used by the install action; injected into Io) ──────────

    /**
     * GET an https URL to bytes. Fail-closed: https-only (every hop), at most
     * {@link #MAX_REDIRECTS} redirects, {@code maxBytes} body cap.
     */
    public static byte[] fetchBufferHttps(String url, long maxBytes) throws IOException {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            java.net.URI uri;
            try {
                uri = java.net.URI.create(current);
            } catch (IllegalArgumentException e) {
                throw new IOException("bad-url: " + current);
            }
            if (!"https".equalsIgnoreCase(String.valueOf(uri.getScheme()))) {
                throw new IOException("insecure-url: " + current);
            }
            java.net.http.HttpClient client = java.net.http.HttpClient.newBuilder()
                    .followRedirects(java.net.http.HttpClient.Redirect.NEVER)
                    .connectTimeout(java.time.Duration.ofSeconds(20))
                    .build();
            java.net.http.HttpRequest req = java.net.http.HttpRequest.newBuilder(uri)
                    .timeout(java.time.Duration.ofMinutes(3))
                    .header("User-Agent", "chainlesschain-jetbrains-managed-cli")
                    .GET()
                    .build();
            java.net.http.HttpResponse<java.io.InputStream> resp;
            try {
                resp = client.send(req,
                        java.net.http.HttpResponse.BodyHandlers.ofInputStream());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("interrupted");
            }
            int status = resp.statusCode();
            if (status >= 300 && status < 400) {
                try (java.io.InputStream in = resp.body()) {
                    in.skip(Long.MAX_VALUE);
                } catch (Throwable ignored) {
                    // drain best-effort
                }
                String loc = resp.headers().firstValue("location").orElse(null);
                if (loc == null) throw new IOException("redirect-without-location");
                current = uri.resolve(loc).toString();
                continue; // next hop re-checks the https scheme
            }
            if (status != 200) throw new IOException("http-" + status);
            try (java.io.InputStream in = resp.body();
                 java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
                byte[] buf = new byte[64 * 1024];
                long total = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > maxBytes) throw new IOException("download-too-large");
                    out.write(buf, 0, n);
                }
                return out.toByteArray();
            }
        }
        throw new IOException("too-many-redirects");
    }

    /** GET an https URL to a parsed JSON object (same policy as fetchBufferHttps). */
    public static Map<String, Object> fetchJsonHttps(String url) throws IOException {
        byte[] body = fetchBufferHttps(url, 8L * 1024 * 1024);
        try {
            Object parsed = MiniJson.parse(new String(body, StandardCharsets.UTF_8));
            if (parsed instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> m = (Map<String, Object>) parsed;
                return m;
            }
            return null;
        } catch (Throwable t) {
            throw new IOException("bad-json");
        }
    }

    /**
     * Probe {@code node --version} from PATH (with the npm-dir PATH
     * augmentation cc spawns get) — the raw output feeds
     * {@link ManagedCli#managedNodeDiagnostic}. Null when node did not answer.
     */
    public static String probeNodeVersionOutput() {
        List<String> cmd = new ArrayList<>();
        if (File.separatorChar == '\\') {
            cmd.add("cmd.exe");
            cmd.add("/c");
        }
        cmd.add("node");
        cmd.add("--version");
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            CliLauncher.augmentPath(pb);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            byte[] out = p.getInputStream().readNBytes(4096);
            if (!p.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            return new String(out, StandardCharsets.UTF_8);
        } catch (Throwable t) {
            return null;
        }
    }
}
