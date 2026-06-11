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
                LlmConfig.buildConfigSetArgs("deepseek", "deepseek-chat", "k", "https://x");
        check("4 sets", sets.size() == 4);
        check("provider first",
                String.join(" ", sets.get(0)).equals("config set llm.provider deepseek"));
        check("key last", String.join(" ", sets.get(3)).equals("config set llm.apiKey k"));
        check("blank skipped",
                LlmConfig.buildConfigSetArgs("ollama", null, "", null).size() == 1);

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
