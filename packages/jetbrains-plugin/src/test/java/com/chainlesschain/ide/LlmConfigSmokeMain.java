package com.chainlesschain.ide;

import java.util.List;

/**
 * SDK-free self-test for the LlmConfig core (same pattern as
 * InteropSmokeMain): compile with javac and RUN — asserts the pure logic and
 * does one REAL `cc config get` round-trip through ProcessBuilder (cmd /c on
 * Windows), proving the spawn path the wizard uses.
 *
 *   javac --release 8 -encoding UTF-8 -d out src/main/java/com/chainlesschain/ide/LlmConfig.java \
 *         src/test/java/com/chainlesschain/ide/LlmConfigSmokeMain.java
 *   java -cp out com.chainlesschain.ide.LlmConfigSmokeMain
 */
public final class LlmConfigSmokeMain {
    private static int failures = 0;

    public static void main(String[] argv) {
        // presets: 10 providers, sane shapes, ollama keyless
        check("10 presets", LlmConfig.PRESETS.length == 10);
        boolean ollamaKeyless = false;
        for (LlmConfig.Preset p : LlmConfig.PRESETS) {
            check("preset url " + p.id, p.baseUrl.startsWith("http"));
            check("preset model " + p.id, !p.defaultModel.isEmpty());
            if ("ollama".equals(p.id)) ollamaKeyless = !p.needsKey;
        }
        check("ollama keyless", ollamaKeyless);

        // set-arg builder
        List<List<String>> sets =
                LlmConfig.buildConfigSetArgs("deepseek", "deepseek-chat", "k", "https://x", null);
        check("4 sets", sets.size() == 4);
        check("provider first",
                String.join(" ", sets.get(0)).equals("config set llm.provider deepseek"));
        check("key last", String.join(" ", sets.get(3)).equals("config set llm.apiKey k"));
        check("blank skipped",
                LlmConfig.buildConfigSetArgs("ollama", null, "", null, null).size() == 1);
        // blank apiKey is OMITTED so the stored key is kept (the "更新后又要重配
        // key" fix): model/baseUrl still update, llm.apiKey is never re-written.
        List<List<String>> keepKey = LlmConfig.buildConfigSetArgs(
                "volcengine", "doubao-seed-2-1-pro-260628", "",
                "https://ark.cn-beijing.volces.com/api/v3", null);
        boolean noKeyWrite = true;
        for (List<String> s : keepKey) if (s.contains("llm.apiKey")) noKeyWrite = false;
        check("blank key keeps existing (no apiKey write)", keepKey.size() == 3 && noKeyWrite);

        // unsafe-char gate
        check("safe key ok", !LlmConfig.hasUnsafeShellChars("bce-v3/ALTAK-abc_123=+"));
        check("space unsafe", LlmConfig.hasUnsafeShellChars("has space"));
        check("amp unsafe", LlmConfig.hasUnsafeShellChars("a&b"));
        check("apply rejects unsafe",
                LlmConfig.applyConfig("x", null, "bad key", null) != null);

        // config-get parser (both output styles + unset states)
        check("kv style", "volcengine".equals(LlmConfig.parseConfigGet("llm.provider = volcengine\n")));
        check("bare style", "ollama".equals(LlmConfig.parseConfigGet("ollama\n")));
        check("undefined → null", LlmConfig.parseConfigGet("undefined") == null);
        check("empty → null", LlmConfig.parseConfigGet("  ") == null);

        // file-first detection parser (robust to a broken cc post-update) —
        // read llm.<field> straight from config.json text.
        String cfg = "{\"llm\":{\"provider\":\"volcengine\",\"model\":\"doubao-x\","
                + "\"baseUrl\":\"https://ark.example/v1?a=b&c=d\",\"apiKey\":\"sk-secret\"}}";
        boolean[] present = new boolean[1];
        check("file provider", "volcengine".equals(LlmConfig.llmFieldFromConfigJson(cfg, "provider", present)));
        check("file llm present flag", present[0]);
        check("file baseUrl with = intact",
                "https://ark.example/v1?a=b&c=d".equals(LlmConfig.llmFieldFromConfigJson(cfg, "baseUrl", null)));
        check("file apiKey present", LlmConfig.llmFieldFromConfigJson(cfg, "apiKey", null) != null);
        check("file unset field → null", LlmConfig.llmFieldFromConfigJson(cfg, "visionModel", null) == null);
        boolean[] p2 = new boolean[1];
        check("no-llm-block → null + not present",
                LlmConfig.llmFieldFromConfigJson("{\"other\":1}", "provider", p2) == null && !p2[0]);
        check("corrupt json → null", LlmConfig.llmFieldFromConfigJson("{ not json", "provider", null) == null);
        check("cleanConfigValue trims/maps", LlmConfig.cleanConfigValue(" x ").equals("x")
                && LlmConfig.cleanConfigValue("undefined") == null && LlmConfig.cleanConfigValue(null) == null);

        // REAL spawn round-trip (needs cc on PATH — true on dev/CI boxes)
        LlmConfig.CliResult r = LlmConfig.runCli(java.util.Arrays.asList("--version"));
        check("real cc --version runs", r.ok && r.output.trim().matches("\\d+\\.\\d+\\.\\d+.*"));
        String provider = LlmConfig.getConfiguredProvider();
        System.out.println("configured provider on this box: " + provider);

        if (failures > 0) {
            System.err.println(failures + " FAILURES");
            System.exit(1);
        }
        System.out.println("LlmConfig smoke: ALL OK");
    }

    private static void check(String name, boolean ok) {
        System.out.println((ok ? "  ok  " : "  FAIL ") + name);
        if (!ok) failures++;
    }
}
