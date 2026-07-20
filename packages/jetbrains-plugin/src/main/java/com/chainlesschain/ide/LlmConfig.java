package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Guided LLM configuration — the plugin is only a thin wizard: all
 * writes/tests go through the CLI ({@code cc config set}, {@code cc llm test}),
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
        new Preset("volcengine", "Volcengine / Doubao (volcengine)", "https://ark.cn-beijing.volces.com/api/v3", "doubao-seed-evolving", true),
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

    /** The {@code cc config set} invocations for the wizard's answers. A blank
     *  visionModel is omitted (the CLI keeps its default vision model). */
    public static List<List<String>> buildConfigSetArgs(
            String provider, String model, String apiKey, String baseUrl, String visionModel) {
        List<List<String>> sets = new ArrayList<List<String>>();
        if (notBlank(provider)) sets.add(args("config", "set", "llm.provider", provider));
        if (notBlank(model)) sets.add(args("config", "set", "llm.model", model));
        if (notBlank(baseUrl)) sets.add(args("config", "set", "llm.baseUrl", baseUrl));
        if (notBlank(apiKey)) sets.add(args("config", "set", "llm.apiKey", apiKey));
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

    /** Run `cc <args…>` (via cmd /c on Windows — npm shims are .cmd files).
     *  PATH is augmented with the usual npm/node bin dirs and the binary name is
     *  resolved (cc/chainlesschain/…) so the wizard works even when the IDE was
     *  launched from a shortcut and never inherited %APPDATA%\npm on PATH. */
    public static CliResult runCli(List<String> ccArgs) {
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
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            CliLauncher.augmentPath(pb);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out = readAll(p.getInputStream());
            boolean finished = p.waitFor(60, TimeUnit.SECONDS);
            if (!finished) {
                p.destroyForcibly();
                return new CliResult(false, "cc timed out");
            }
            boolean ok = p.exitValue() == 0;
            if (!ok && CliLauncher.looksLikeMissingCli(out)) {
                return new CliResult(false, CliLauncher.missingCliMessage());
            }
            return new CliResult(ok, out);
        } catch (Exception e) {
            String msg = String.valueOf(e.getMessage());
            return new CliResult(false,
                    CliLauncher.looksLikeMissingCli(msg) ? CliLauncher.missingCliMessage() : msg);
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
        String v = visionModel == null ? "" : visionModel.trim();
        if (!v.isEmpty() && hasUnsafeShellChars(v)) {
            return "Value contains unsafe characters — remove spaces/quotes/& and retry";
        }
        CliResult r = runCli(args("config", "set", "llm.visionModel", v));
        return r.ok ? null : tail(r.output, 200);
    }

    /**
     * Does this agent error message look like an LLM provider/key configuration
     * problem (auth failure / missing key) — i.e. worth nudging the user toward
     * Configure LLM? Pure, testable.
     */
    public static boolean looksLikeLlmConfigError(String message) {
        if (message == null) return false;
        String m = message.toLowerCase();
        return m.contains("401") || m.contains("403")
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
     * Full configured llm block {@code [provider, model, baseUrl, apiKey]} for
     * the chat spawn. The panel pins --provider/--model AND must pass
     * --base-url/--api-key, or the CLI (seeing an explicit --provider) drops a
     * cloud provider's endpoint + key → it falls through to ollama ("配置了火山却
     * fetch failed"). Read file-first via {@link #readLlmField}; any element may
     * be null (then omitted as a flag, and the CLI resolves it itself).
     */
    public static String[] readConfiguredLlmBlock() {
        // Read + parse config.json ONCE for all four fields. The old code called
        // readLlmField 4× — 4 file reads + 4 MiniJson parses per spawn, and (when
        // a field was absent) up to 4 sequential 60s `cc config get` fallbacks on
        // the per-tab send worker before the first message. When the llm block is
        // present (the common case) the file is authoritative for every field.
        try {
            java.nio.file.Path f = Paths.get(System.getProperty("user.home", ""),
                    ".chainlesschain", "config.json");
            if (Files.isRegularFile(f)) {
                String raw = new String(Files.readAllBytes(f), StandardCharsets.UTF_8);
                Map<String, Object> cfg = MiniJson.parseObject(raw);
                Object llm = cfg == null ? null : cfg.get("llm");
                if (llm instanceof Map) {
                    Map<?, ?> m = (Map<?, ?>) llm;
                    return new String[] {
                        cleanConfigValue(m.get("provider")),
                        cleanConfigValue(m.get("model")),
                        cleanConfigValue(m.get("baseUrl")),
                        cleanConfigValue(m.get("apiKey")),
                    };
                }
            }
        } catch (Exception ignore) {
            // fall through to the per-field path (CLI fallback for pre-llm configs)
        }
        // No file / no llm block → per-field read (each falls back to the CLI).
        return new String[] {
            readLlmField("provider"),
            readLlmField("model"),
            readLlmField("baseUrl"),
            readLlmField("apiKey"),
        };
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
     * Apply the wizard's answers (sequential, fail-fast).
     * @return null on success, otherwise a user-facing error message
     */
    public static String applyConfig(String provider, String model, String apiKey, String baseUrl) {
        return applyConfig(provider, model, apiKey, baseUrl, null);
    }

    public static String applyConfig(String provider, String model, String apiKey,
                                     String baseUrl, String visionModel) {
        String[][] fields = {
            {"provider", provider}, {"model", model}, {"apiKey", apiKey},
            {"baseUrl", baseUrl}, {"visionModel", visionModel},
        };
        for (String[] f : fields) {
            if (notBlank(f[1]) && hasUnsafeShellChars(f[1])) {
                return "Value contains unsafe characters (" + f[0] + ") — remove spaces/quotes/& and retry";
            }
        }
        for (List<String> set : buildConfigSetArgs(provider, model, apiKey, baseUrl, visionModel)) {
            CliResult r = runCli(set);
            if (!r.ok) return tail(r.output, 200);
        }
        return null;
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
        while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }
}
