package com.chainlesschain.ide;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure helpers for the App Preview feature (Claude-Code desktop preview-pane
 * parity) — a direct port of the VS Code extension's preview-detect.js. Pick
 * the project's dev-server script and recognize the URL it prints when it comes
 * up. No IntelliJ SDK — pure string/regex logic — so it compiles + tests with
 * plain {@code javac}. The IntelliJ glue spawns the chosen script, scans output
 * through {@link #detectServerUrl}, then opens the URL in an embedded JCEF
 * browser; the dev server's own HMR handles live reload.
 */
public final class PreviewDetect {

    private PreviewDetect() {}

    /** Conventional dev-script names, most-specific first. */
    public static final String[] DEV_SCRIPT_PRIORITY =
            {"dev", "start", "serve", "develop", "dev:web", "preview"};

    /** Commands that ARE a dev server even under an unconventional script name. */
    private static final Pattern DEV_TOOL_RE = Pattern.compile(
            "\\b(vite|next(\\s+dev)?|nuxt|react-scripts|vue-cli-service|"
          + "webpack(-dev-server|\\s+serve)?|ng\\s+serve|astro|remix|gatsby|parcel|"
          + "snowpack|svelte-kit|vitepress|vuepress|docusaurus|http-server|\\bserve\\b|"
          + "ember\\s+serve|quasar\\s+dev|umi\\s+dev|rsbuild)\\b");

    /** Build commands we should NOT auto-pick as a preview server. */
    private static final Pattern NOT_DEV_RE =
            Pattern.compile("\\b(build|test|lint|format|typecheck|tsc|clean|prepare)\\b");

    private static final Pattern ANSI_RE = Pattern.compile("\\x1B\\[[0-9;]*m");
    private static final Pattern LOCAL_URL_RE = Pattern.compile(
            "https?://(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1\\])"
          + "(?::\\d+)?(?:/[^\\s'\"`]*)?",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern TRAILING_PUNCT = Pattern.compile("[)\\].,;:'\"`]+$");

    /** A chosen dev script. */
    public static final class DevScript {
        public final String script;
        public final String command;
        DevScript(String script, String command) {
            this.script = script;
            this.command = command;
        }
    }

    /**
     * Choose the best dev-server script from a package.json "scripts" map.
     * @return the chosen script, or null when nothing fits.
     */
    public static DevScript pickDevScript(Map<String, String> scripts) {
        if (scripts == null || scripts.isEmpty()) return null;
        // 1) by conventional name (skip ones that are clearly a build/test).
        for (String name : DEV_SCRIPT_PRIORITY) {
            String cmd = scripts.get(name);
            if (cmd != null && !cmd.trim().isEmpty() && !NOT_DEV_RE.matcher(name).find()) {
                return new DevScript(name, cmd);
            }
        }
        // 2) by a recognized dev tool inside the command.
        for (Map.Entry<String, String> e : scripts.entrySet()) {
            String name = e.getKey();
            String cmd = e.getValue();
            if (cmd != null && DEV_TOOL_RE.matcher(cmd).find()
                    && !NOT_DEV_RE.matcher(name).find()) {
                return new DevScript(name, cmd);
            }
        }
        return null;
    }

    /**
     * Extract the first browsable localhost dev-server URL from a line, or null.
     * Strips ANSI colors + trailing punctuation; rewrites 0.0.0.0 → localhost.
     */
    public static String detectServerUrl(String line) {
        if (line == null) return null;
        String clean = ANSI_RE.matcher(line).replaceAll("");
        Matcher m = LOCAL_URL_RE.matcher(clean);
        if (!m.find()) return null;
        String url = TRAILING_PUNCT.matcher(m.group()).replaceAll("");
        return url.replace("://0.0.0.0", "://localhost");
    }

    /** Scan accumulated output and return the first detected URL, or null. */
    public static String detectServerUrlInText(String text) {
        if (text == null) return null;
        for (String line : text.split("\\r?\\n")) {
            String url = detectServerUrl(line);
            if (url != null) return url;
        }
        return null;
    }
}
