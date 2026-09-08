package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.net.URI;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Guided LLM configuration — the plugin is only a thin wizard: all
 * writes/tests go through the CLI ({@code cc llm configure}, {@code cc llm test}),
 * so there is exactly one source of truth (~/.chainlesschain/config.json,
 * shared with the CLI and the VS Code extension). DETECTION reads that file
 * directly (file-first, CLI fallback) so it stays correct when {@code cc} is
 * transiently broken right after an update. Pure JDK (Java 8) — part of the
 * SDK-free protocol core, locally compilable and testable.
 */
public final class LlmConfig {
    private LlmConfig() {}

    /** One provider preset; ids must match the CLI's BUILT_IN_PROVIDERS. */
    public static final class Preset {
        public final String id;
        public final String label;
        public final String baseUrl;
        public final String defaultModel;
        public final boolean needsKey;

        Preset(String id, String label, String baseUrl, String defaultModel, boolean needsKey) {
            this.id = id;
            this.label = label;
            this.baseUrl = baseUrl;
            this.defaultModel = defaultModel;
            this.needsKey = needsKey;
        }
    }

    public static final Preset[] PRESETS = {
        new Preset("volcengine", "Volcengine / Doubao (volcengine)", "https://ark.cn-beijing.volces.com/api/v3", "deepseek-v4-flash-260425", true),
        new Preset("ollama", "Ollama (local, no key)", "http://localhost:11434", "qwen2.5:7b", false),
        new Preset("anthropic", "Anthropic Claude", "https://api.anthropic.com/v1", "claude-sonnet-4-6", true),
        new Preset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o", true),
        new Preset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat", true),
        new Preset("dashscope", "Aliyun Bailian / Tongyi (dashscope)", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-max", true),
        new Preset("kimi", "Moonshot Kimi", "https://api.moonshot.cn/v1", "moonshot-v1-auto", true),
        new Preset("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.0-flash", true),
        new Preset("mistral", "Mistral", "https://api.mistral.ai/v1", "mistral-large-latest", true),
        new Preset("minimax", "MiniMax", "https://api.minimax.chat/v1", "abab6.5s-chat", true),
    };

    private static final Pattern UNSAFE = Pattern.compile("[\\s&|<>^\"'`%]");

    /**
     * Values reach {@code cc config set} through a Windows {@code cmd /c}
     * (the npm shim is a .cmd), where metacharacters cannot be quoted
     * reliably — reject them up front instead of corrupting the config.
     */
    public static boolean hasUnsafeShellChars(String value) {
        return value != null && UNSAFE.matcher(value).find();
    }

    /** The non-secret {@code cc config set} invocations for the wizard's
     *  answers. API keys are intentionally excluded from argv and are written
     *  through {@code cc config set-secret} on stdin by {@link #applyConfig}. A
     *  blank visionModel is omitted (the CLI keeps its default vision model). */
    public static List<List<String>> buildConfigSetArgs(
            String provider, String model, String apiKey, String baseUrl, String visionModel) {
        List<List<String>> sets = new ArrayList<List<String>>();
        if (notBlank(provider)) sets.add(args("config", "set", "llm.provider", provider));
        if (notBlank(model)) sets.add(args("config", "set", "llm.model", model));
        if (notBlank(baseUrl)) sets.add(args("config", "set", "llm.baseUrl", baseUrl));
        if (notBlank(visionModel)) sets.add(args("config", "set", "llm.visionModel", visionModel));
        return sets;
    }

    /** Suggested default vision (image-recognition) model for a provider, when
     *  it differs from the text model. Blank = use the CLI's own default. */
    public static String suggestVisionModel(String providerId) {
        // Mirror the CLI's DEFAULT_VISION_MODEL (image-input.js) so the prefilled
        // suggestion equals what `cc agent --image` would use by default.
        if ("volcengine".equals(providerId)) return "doubao-seed-2-0-lite-260215";
        return "";
    }

    /** Outcome of one CLI run. */
    public static final class CliResult {
        public final boolean ok;
        public final String output;

        CliResult(boolean ok, String output) {
            this.ok = ok;
            this.output = output;
        }
    }

    interface CliRunner {
        CliResult run(List<String> ccArgs, String stdin);
    }

    // Shared by every project/tab, independent of the lifetime of a settings dialog.
    // Increment only after confirmed persistence, including credential-only changes.
    private static final java.util.concurrent.atomic.AtomicLong configurationRevision =
            new java.util.concurrent.atomic.AtomicLong();

    public static long configurationRevision() { return configurationRevision.get(); }

    /** Non-secret snapshot used by the connection form and save readback. */
    public static final class Connection {
        public final String provider, model, baseUrl, visionModel;
        public final boolean hasKey;
        public Connection(String provider, String model, String baseUrl, String visionModel, boolean hasKey) {
            this.provider = provider == null ? "" : provider;
            this.model = model == null ? "" : model;
            this.baseUrl = baseUrl == null ? "" : baseUrl;
            this.visionModel = visionModel == null ? "" : visionModel;
            this.hasKey = hasKey;
        }
    }

    public static Connection readConnection() {
        return readConnection((args, stdin) -> runCli(args, stdin));
    }

    static Connection readConnection(CliRunner cli) {
        CliResult result = cli.run(args("config", "list", "--json"), null);
        if (!result.ok) throw new IllegalStateException("Could not read the saved CLI configuration");
        Map<String, Object> document = MiniJson.parseObject(result.output.trim());
        if (document == null || !(document.get("llm") instanceof Map))
            throw new IllegalStateException("CLI returned an invalid configuration snapshot");
        Map<?, ?> values = (Map<?, ?>) document.get("llm");
        return new Connection(cleanConfigValue(values.get("provider")), cleanConfigValue(values.get("model")),
                cleanConfigValue(values.get("baseUrl")), cleanConfigValue(values.get("visionModel")),
                cleanConfigValue(values.get("apiKey")) != null);
    }

    /** One CLI transaction followed by a fresh, redacted readback. */
    public static String saveConnection(Connection connection, String apiKey, boolean allowHttp) {
        return saveConnection(connection, apiKey, allowHttp, (args, stdin) -> runCli(args, stdin));
    }

    static String saveConnection(Connection connection, String apiKey, boolean allowHttp, CliRunner cli) {
        String validation = validateConnection(connection, allowHttp);
        if (validation != null) return validation;
        if (apiKey != null && apiKey.length() > 8192) return "API key is too long";
        Map<String, Object> values = new LinkedHashMap<String, Object>();
        values.put("provider", connection.provider.trim());
        values.put("model", connection.model.trim());
        values.put("baseUrl", connection.baseUrl.trim());
        values.put("visionModel", connection.visionModel.trim());
        values.put("apiKey", apiKey == null ? "" : apiKey.trim());
        values.put("allowHttp", allowHttp);
        CliResult result = cli.run(args("llm", "configure"), MiniJson.stringify(values));
        if (!result.ok) {
            String detail = result.output == null ? "" : result.output;
            if (notBlank(apiKey)) detail = detail.replace(apiKey, "[REDACTED]").replace(apiKey.trim(), "[REDACTED]");
            return tail(detail, 500).isEmpty() ? "Configuration write failed" : tail(detail, 500);
        }
        try {
            Connection saved = readConnection(cli);
            if (!saved.provider.equals(connection.provider.trim()) || !saved.model.equals(connection.model.trim())
                    || !normalizedBaseUrl(saved.baseUrl).equals(normalizedBaseUrl(connection.baseUrl))
                    || !saved.visionModel.equals(connection.visionModel.trim())
                    || (!"ollama".equals(saved.provider) && !saved.hasKey))
                return "Configuration write could not be confirmed: readback differs. Reload before trying again.";
        } catch (Exception e) {
            return "Configuration write could not be confirmed: could not read it back. Reload before trying again.";
        }
        configurationRevision.incrementAndGet();
        return null;
    }

    public static String normalizedBaseUrl(String value) {
        try {
            URI uri = new URI(value.trim()).normalize();
            String host = uri.getHost();
            if (host == null) return value.trim().replaceAll("/+$", "");
            int port = uri.getPort();
            if (("https".equalsIgnoreCase(uri.getScheme()) && port == 443)
                    || ("http".equalsIgnoreCase(uri.getScheme()) && port == 80)) port = -1;
            return new URI(uri.getScheme().toLowerCase(java.util.Locale.ROOT), null,
                    host.toLowerCase(java.util.Locale.ROOT), port, uri.getPath(), null, null)
                    .toASCIIString().replaceAll("/+$", "");
        } catch (Exception e) { return value.trim().replaceAll("/+$", ""); }
    }

    public static String validateConnection(Connection connection, boolean allowHttp) {
        boolean supported = false;
        for (Preset preset : PRESETS) if (preset.id.equals(connection.provider.trim())) supported = true;
        if (!supported) return "Choose a supported provider or protocol";
        if (connection.baseUrl.length() > 2048) return "Base URL is too long";
        if (!notBlank(connection.model) || connection.model.length() > 2048 || connection.visionModel.length() > 2048
                || (connection.model + connection.visionModel).matches("(?s).*[\\r\\n\\x00].*"))
            return "Enter a valid model name";
        try {
            URI uri = new URI(connection.baseUrl.trim());
            String scheme = uri.getScheme();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || uri.getHost() == null
                    || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null)
                return "Use an HTTP(S) base URL without credentials, query or fragment";
            if (uri.getPath().matches(".*/(chat/completions|messages|responses|api/generate)/?"))
                return "Enter the base URL, without a completion/messages endpoint";
            String host = uri.getHost();
            if ("http".equalsIgnoreCase(scheme) && !"localhost".equalsIgnoreCase(host)
                    && !"127.0.0.1".equals(host) && !"[::1]".equals(host) && !allowHttp)
                return "Confirm unencrypted HTTP before using a remote endpoint";
        } catch (Exception e) { return "Enter a valid base URL"; }
        return null;
    }

    /** Run `cc <args…>` (via cmd /c on Windows — npm shims are .cmd files).
     *  PATH is augmented with the usual npm/node bin dirs and the binary name is
     *  resolved (cc/chainlesschain/…) so the wizard works even when the IDE was
     *  launched from a shortcut and never inherited %APPDATA%\npm on PATH. */
    public static CliResult runCli(List<String> ccArgs) {
        return runCli(ccArgs, null);
    }

    /** Run the CLI and, when non-null, deliver sensitive input through stdin. */
    static CliResult runCli(List<String> ccArgs, String stdin) {
        List<String> cmd = new ArrayList<String>();
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        if (windows) {
            cmd.add("cmd");
            cmd.add("/c");
        }
        // Reuse the chat session's binary resolution (skips a `cc` shadowed by
        // the C compiler) — its probes already run with the augmented PATH.
        cmd.add(AgentChatSession.resolveBinary());
        cmd.addAll(ccArgs);
        Process p = null;
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            CliLauncher.augmentPath(pb);
            pb.redirectErrorStream(true);
            p = pb.start();
            final InputStream output = p.getInputStream();
            CompletableFuture<String> reading = CompletableFuture.supplyAsync(() -> {
                try { return readAll(output); }
                catch (Exception e) { throw new java.util.concurrent.CompletionException(e); }
            });
            try (OutputStream out = p.getOutputStream()) {
                if (stdin != null) out.write(stdin.getBytes(StandardCharsets.UTF_8));
            }
            boolean finished = p.waitFor(60, TimeUnit.SECONDS);
            if (!finished) {
                stopCliProcess(p);
                return new CliResult(false, "cc timed out");
            }
            String out = reading.get(5, TimeUnit.SECONDS);
            boolean ok = p.exitValue() == 0;
            if (!ok && CliLauncher.looksLikeMissingCli(out)) {
                return new CliResult(false, CliLauncher.missingCliMessage());
            }
            return new CliResult(ok, out);
        } catch (Exception e) {
            if (p != null && p.isAlive()) stopCliProcess(p);
            String msg = String.valueOf(e.getMessage());
            return new CliResult(false,
                    CliLauncher.looksLikeMissingCli(msg) ? CliLauncher.missingCliMessage() : msg);
        }
    }

    private static void stopCliProcess(Process process) {
        try {
            process.descendants().forEach(child -> {
                try { child.destroyForcibly(); } catch (RuntimeException ignored) { }
            });
        } finally {
            process.destroyForcibly();
            try { process.getInputStream().close(); } catch (Exception ignored) { }
        }
    }

    /**
     * Extract {@code llm.<field>} from raw config.json text. Pure + testable.
     * Returns the trimmed value, or null when the json is invalid / has no llm
     * block / the field is unset. The {@code llmPresent} 1-element flag (when
     * non-null) is set to true iff a usable {@code llm} object was found — lets
     * the caller distinguish "field unset" (authoritative) from "no llm block"
     * (defer to the CLI for configs that predate the llm section).
     */
    static String llmFieldFromConfigJson(String json, String field, boolean[] llmPresent) {
        try {
            Map<String, Object> cfg = MiniJson.parseObject(json);
            Object llm = cfg == null ? null : cfg.get("llm");
            if (!(llm instanceof Map)) return null;
            if (llmPresent != null && llmPresent.length > 0) llmPresent[0] = true;
            return cleanConfigValue(((Map<?, ?>) llm).get(field));
        } catch (Exception e) {
            return null;
        }
    }

    /** Normalize a config value → non-empty trimmed string, or null. */
    static String cleanConfigValue(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.isEmpty() || s.equalsIgnoreCase("undefined") || s.equalsIgnoreCase("null")) return null;
        return s;
    }

    /**
     * Read one {@code llm.<field>} for detection. The config FILE
     * (~/.chainlesschain/config.json — the same file {@code cc config set}
     * writes) is the source of truth, so detection does NOT depend on the
     * {@code cc} binary being runnable. Right after a CLI update (npm global
     * install), {@code cc} is frequently mid-rebuild and {@code cc config get}
     * exits non-zero; the old code read that as "LLM unconfigured" and forced a
     * full re-setup every update even though config.json was intact (the
     * recurring "更新后又要重新配置LLM" bug). Falls back to {@code cc config
     * get} only when the file is missing / unreadable / has no llm block.
     */
    private static String readLlmField(String field) {
        try {
            java.nio.file.Path f = Paths.get(System.getProperty("user.home", ""),
                    ".chainlesschain", "config.json");
            if (Files.isRegularFile(f)) {
                String raw = new String(Files.readAllBytes(f), StandardCharsets.UTF_8);
                boolean[] present = new boolean[1];
                String v = llmFieldFromConfigJson(raw, field, present);
                if (present[0]) return v; // file authoritative (v may be null = unset)
            }
        } catch (Exception ignore) {
            // fall through to CLI
        }
        CliResult r = runCli(args("config", "get", "llm." + field));
        if (!r.ok) return null;
        return parseConfigGet(r.output);
    }

    /** Currently configured provider, or null when genuinely unset. */
    public static String getConfiguredProvider() {
        return readLlmField("provider");
    }

    /** Currently configured vision (image-recognition) model, or null when unset. */
    public static String getConfiguredVisionModel() {
        return readLlmField("visionModel");
    }

    /** Currently configured text model, or null when unset. */
    public static String getConfiguredModel() {
        return readLlmField("model");
    }

    /** Currently configured base URL, or null when unset. */
    public static String getConfiguredBaseUrl() {
        return readLlmField("baseUrl");
    }

    /**
     * True when an API key is already stored — lets the wizard offer "leave the
     * key blank to keep the existing one" instead of forcing a re-type on every
     * reconfigure ("更新后又要重新配置模型和key"). The key value is never read
     * into the UI — only its presence — so "blank = keep" stays secure.
     * File-first so a post-update {@code cc} crash never makes the panel think
     * the key vanished.
     */
    public static boolean hasConfiguredApiKey() {
        return readLlmField("apiKey") != null;
    }

    /**
     * Set just {@code llm.visionModel} (the dedicated vision-model entry, so the
     * user need not re-run the full wizard / re-type the API key). A blank value
     * clears it (reverting to the text model / CLI default).
     * @return null on success, otherwise a user-facing error message
     */
    public static String setVisionModel(String visionModel) {
        return setVisionModel(visionModel, (args, stdin) -> runCli(args, stdin));
    }

    static String setVisionModel(String visionModel, CliRunner cli) {
        String v = visionModel == null ? "" : visionModel.trim();
        if (!v.isEmpty() && hasUnsafeShellChars(v)) {
            return "Value contains unsafe characters — remove spaces/quotes/& and retry";
        }
        CliResult r = cli.run(args("config", "set", "llm.visionModel", v), null);
        if (!r.ok) return "Vision model write failed: " + tail(r.output, 200);
        try {
            if (!v.equals(readConnection(cli).visionModel))
                return "Vision model write could not be confirmed: readback differs. Reload before trying again.";
        } catch (Exception e) {
            return "Vision model write could not be confirmed: could not read it back. Reload before trying again.";
        }
        configurationRevision.incrementAndGet();
        return null;
    }

    /**
     * Does this agent error message look like an LLM provider/key configuration
     * problem (auth failure / missing key) — i.e. worth nudging the user toward
     * Configure LLM? Pure, testable.
     */
    public static boolean looksLikeLlmConfigError(String message) {
        if (message == null) return false;
        String m = message.toLowerCase();
        if (m.contains("accountoverdue") || m.contains("overdue balance")
                || m.contains("account balance/billing")
                || m.contains("model access permissions")) {
            return false;
        }
        return m.contains("401")
                || m.contains("api key") || m.contains("api_key")
                || m.contains("unauthorized")
                || m.contains("authentication failed")
                || m.contains("invalid api key")
                || m.contains("incorrect api key");
    }

    private static String blankToNull(Object o) {
        if (o == null) return null;
        String s = String.valueOf(o).trim();
        return s.isEmpty() ? null : s;
    }

    /** Pure: extract {provider, model} from a ~/.chainlesschain/config.json string. */
    public static String[] parseLlmProviderModel(String configJson) {
        try {
            Map<String, Object> root = MiniJson.parseObject(configJson);
            Object llmObj = root == null ? null : root.get("llm");
            if (!(llmObj instanceof Map)) return new String[] { null, null };
            @SuppressWarnings("unchecked")
            Map<String, Object> llm = (Map<String, Object>) llmObj;
            return new String[] { blankToNull(llm.get("provider")), blankToNull(llm.get("model")) };
        } catch (Exception e) {
            return new String[] { null, null };
        }
    }

    /**
     * Read llm.provider/llm.model straight from ~/.chainlesschain/config.json
     * (no CLI spawn — safe to call off the wizard), so the chat panel can PIN
     * the same provider the terminal `cc` uses instead of relying on the child's
     * ambient resolution. Returns {provider, model}; either may be null.
     */
    public static String[] readConfiguredProviderModel() {
        try {
            String json = new String(Files.readAllBytes(
                    Paths.get(System.getProperty("user.home"), ".chainlesschain", "config.json")),
                    StandardCharsets.UTF_8);
            return parseLlmProviderModel(json);
        } catch (Exception e) {
            return new String[] { null, null };
        }
    }

    /**
     * Configured non-secret llm block {@code [provider, model, baseUrl, null]}
     * for the chat spawn. Secure configs contain only an opaque key reference
     * in config.json, so the plugin never reads or forwards the API key. The
     * CLI resolves it from the secure store for the matching provider.
     */
    public static String[] readConfiguredLlmBlock() {
        return readConfiguredLlmBlock((args, stdin) -> runCli(args, stdin));
    }

    static String[] readConfiguredLlmBlock(CliRunner cli) {
        // Use the same CLI snapshot as the form: CHAINLESSCHAIN_HOME and other
        // supported config-root overrides must also apply to the spawned chat.
        Connection saved = readConnection(cli);
        return new String[] { cleanConfigValue(saved.provider), cleanConfigValue(saved.model),
                cleanConfigValue(saved.baseUrl), null };
    }

    /** Pure parse of `cc config get` output (both `k = v` and bare-value). */
    public static String parseConfigGet(String stdout) {
        if (stdout == null) return null;
        String raw = stdout.trim();
        int eq = raw.lastIndexOf('=');
        if (eq >= 0) raw = raw.substring(eq + 1).trim();
        if (raw.isEmpty() || "undefined".equalsIgnoreCase(raw) || "null".equalsIgnoreCase(raw)) {
            return null;
        }
        return raw;
    }

    /**
     * Atomically apply the form's answers and verify redacted readback.
     * @return null on success, otherwise a user-facing error message
     */
    public static String applyConfig(String provider, String model, String apiKey, String baseUrl) {
        return applyConfig(provider, model, apiKey, baseUrl, null);
    }

    public static String applyConfig(String provider, String model, String apiKey,
                                     String baseUrl, String visionModel) {
        return applyConfig(provider, model, apiKey, baseUrl, visionModel,
                new CliRunner() {
                    @Override
                    public CliResult run(List<String> ccArgs, String stdin) {
                        return runCli(ccArgs, stdin);
                    }
                });
    }

    static String applyConfig(String provider, String model, String apiKey,
                              String baseUrl, String visionModel, CliRunner cli) {
        return saveConnection(new Connection(provider, model, baseUrl, visionModel, false), apiKey, false, cli);
    }

    /** Connectivity check via `cc llm test`; returns a short summary. */
    public static CliResult testLlm() {
        CliResult r = runCli(args("llm", "test"));
        return new CliResult(r.ok, tail(r.output, 300));
    }

    private static boolean notBlank(String s) {
        return s != null && !s.trim().isEmpty();
    }

    private static List<String> args(String... a) {
        List<String> list = new ArrayList<String>();
        for (String s : a) list.add(s);
        return list;
    }

    private static String tail(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        String[] lines = t.split("\n");
        StringBuilder b = new StringBuilder();
        for (int i = Math.max(0, lines.length - 3); i < lines.length; i++) {
            if (b.length() > 0) b.append(' ');
            b.append(lines[i].trim());
        }
        String joined = b.toString();
        return joined.length() > max ? joined.substring(0, max) : joined;
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int n;
        while ((n = in.read(chunk)) > 0) {
            if (buf.size() + n > 1024 * 1024) throw new java.io.IOException("CLI output exceeded 1 MiB");
            buf.write(chunk, 0, n);
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
