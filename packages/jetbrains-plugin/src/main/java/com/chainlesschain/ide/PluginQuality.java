package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Plugin / LSP quality board (gap #11) — the Java twin of the VS Code
 * extension's {@code plugin-quality.js}. Combines three CLI surfaces:
 *
 * <pre>
 *   cc plugin installed --json        → [{name, version, scope, dir, ok}]
 *   cc plugin validate &lt;dir&gt; --json   → {ok, errors, warnings, components,
 *                                        componentCounts:{skills,agents,hooks,
 *                                        mcp,lsp,monitors,bin,settings}, …}
 *   cc code-intel status --json       → {servers:[{languageId,id,available,
 *                                        command}], extensions:[…]}
 * </pre>
 *
 * into per-plugin quality rows: contributed component counts by type + flags:
 * <ul>
 *   <li>{@code broken} — validate reported errors / invalid manifest;</li>
 *   <li>{@code lsp} — {@code none | ok | unavailable | unknown}, derived from
 *       the live {@code code-intel status} probe; when the probe result can't
 *       be matched to the plugin's own declared server (plugin untrusted → not
 *       registered, or status unreadable) we say "unknown" instead of
 *       fabricating a verdict;</li>
 *   <li>{@code unused} — contributes NOTHING (every component count is zero).
 *       A plugin that only ships an LSP server is NOT unused.</li>
 * </ul>
 *
 * There is deliberately NO {@code slow} flag: the CLI plugin runtime records
 * no load/exec timing today, and we don't fake metrics we don't have.
 *
 * Pure JDK (no IntelliJ SDK, no process spawning) → JUnit + smoke tested; the
 * Swing glue (the "Quality" tab of the Plugins &amp; MCP manager) lives in
 * {@code intellij/PluginManagerAction}. Output is plain text for a monospace
 * area — no HTML, so no escaping is needed.
 */
public final class PluginQuality {

    private PluginQuality() {}

    /** Component types {@code plugin validate --json} counts (manifest summarizeComponents). */
    public static final List<String> COMPONENT_TYPES = List.of(
            "skills", "agents", "hooks", "mcp", "lsp", "monitors", "bin", "settings");

    // LSP availability verdicts (deriveLspAvailability).
    public static final String LSP_NONE = "none";
    public static final String LSP_OK = "ok";
    public static final String LSP_UNAVAILABLE = "unavailable";
    public static final String LSP_UNKNOWN = "unknown";

    // ------------------------------------------------------------- cc args

    public static List<String> buildPluginValidateArgs(String dir) {
        return Arrays.asList("plugin", "validate", String.valueOf(dir), "--json");
    }

    public static List<String> buildCodeIntelStatusArgs() {
        return Arrays.asList("code-intel", "status", "--json");
    }

    // --------------------------------------------------------------- model

    /** An LSP server a plugin declares (from validate's {@code components.lsp}). */
    public static final class LspEntry {
        public final String languageId;
        public final String id;

        public LspEntry(String languageId, String id) {
            this.languageId = nz(languageId);
            this.id = nz(id);
        }
    }

    /**
     * Parsed {@code plugin validate} output for one plugin, or a per-plugin
     * failure marker ({@link #failure}) when the CLI produced no usable JSON —
     * a failed validate NEVER fabricates flags, it degrades to "unknown".
     */
    public static final class Validation {
        public final boolean failed;
        public final String message;
        public final boolean ok;
        public final List<String> errors;
        public final List<String> warnings;
        /** Per-type component counts over {@link #COMPONENT_TYPES}; null when failed. */
        public final Map<String, Integer> counts;
        public final List<LspEntry> lsp;

        private Validation(boolean failed, String message, boolean ok,
                List<String> errors, List<String> warnings,
                Map<String, Integer> counts, List<LspEntry> lsp) {
            this.failed = failed;
            this.message = nz(message);
            this.ok = ok;
            this.errors = errors == null ? List.of() : errors;
            this.warnings = warnings == null ? List.of() : warnings;
            this.counts = counts;
            this.lsp = lsp == null ? List.of() : lsp;
        }

        /** Per-plugin tolerance marker: validate ran but yielded nothing usable. */
        public static Validation failure(String message) {
            return new Validation(true, message, false, null, null, null, null);
        }
    }

    /** One row of the live {@code code-intel status} probe. */
    public static final class StatusServer {
        public final String languageId;
        public final String id;
        public final boolean available;

        public StatusServer(String languageId, String id, boolean available) {
            this.languageId = nz(languageId);
            this.id = nz(id);
            this.available = available;
        }
    }

    // --------------------------------------------------------------- parse

    /**
     * {@code plugin validate <dir> --json} → {@link Validation}; null =
     * unreadable. The command prints the JSON even for an INVALID manifest (it
     * only sets the exit code), so null really means "no usable output".
     */
    public static Validation parsePluginValidate(String text) {
        Map<?, ?> parsed = parseObject(text);
        if (parsed == null) return null;
        Object rawCounts = parsed.get("componentCounts");
        Map<?, ?> countsMap = rawCounts instanceof Map ? (Map<?, ?>) rawCounts : Map.of();
        Map<String, Integer> counts = new LinkedHashMap<String, Integer>();
        for (String t : COMPONENT_TYPES) {
            Object v = countsMap.get(t);
            int n = v instanceof Number ? ((Number) v).intValue() : 0;
            counts.put(t, n > 0 ? n : 0);
        }
        Object components = parsed.get("components");
        Object lspRaw = components instanceof Map ? ((Map<?, ?>) components).get("lsp") : null;
        List<LspEntry> lsp = new ArrayList<LspEntry>();
        if (lspRaw instanceof List) {
            for (Object o : (List<?>) lspRaw) {
                if (!(o instanceof Map)) continue;
                Map<?, ?> m = (Map<?, ?>) o;
                if (!(m.get("languageId") instanceof String)) continue;
                String id = str(m.get("id"));
                if (id.isEmpty()) id = str(m.get("command"));
                lsp.add(new LspEntry((String) m.get("languageId"), id));
            }
        }
        return new Validation(false, "", Boolean.TRUE.equals(parsed.get("ok")),
                strList(parsed.get("errors")), strList(parsed.get("warnings")),
                counts, lsp);
    }

    /** {@code code-intel status --json} → server rows; null = unreadable. */
    public static List<StatusServer> parseCodeIntelStatus(String text) {
        Map<?, ?> parsed = parseObject(text);
        if (parsed == null || !(parsed.get("servers") instanceof List)) return null;
        List<StatusServer> out = new ArrayList<StatusServer>();
        for (Object o : (List<?>) parsed.get("servers")) {
            if (!(o instanceof Map)) continue;
            Map<?, ?> m = (Map<?, ?>) o;
            if (!(m.get("languageId") instanceof String)) continue;
            out.add(new StatusServer((String) m.get("languageId"),
                    str(m.get("id")), Boolean.TRUE.equals(m.get("available"))));
        }
        return out;
    }

    // ------------------------------------------------------------- derive

    /**
     * Derive a plugin's LSP availability from the live probe.
     *
     * <ul>
     *   <li>{@code none} — the plugin declares no LSP servers;</li>
     *   <li>{@code unknown} — no live status data, OR the status row for that
     *       languageId belongs to a DIFFERENT server (the plugin is
     *       untrusted/not registered, so its own binary was never probed) —
     *       we do not fabricate a verdict from someone else's probe;</li>
     *   <li>{@code unavailable} — the plugin's own registered server did not
     *       resolve a binary;</li>
     *   <li>{@code ok} — every declared server resolved.</li>
     * </ul>
     */
    public static String deriveLspAvailability(List<LspEntry> lspEntries,
            List<StatusServer> statusServers) {
        List<LspEntry> entries = lspEntries == null ? List.of() : lspEntries;
        if (entries.isEmpty()) return LSP_NONE;
        if (statusServers == null) return LSP_UNKNOWN;
        boolean sawUnknown = false;
        for (LspEntry e : entries) {
            StatusServer row = null;
            for (StatusServer s : statusServers) {
                if (s.languageId.equals(e.languageId)) { row = s; break; }
            }
            if (row == null || (!e.id.isEmpty() && !row.id.equals(e.id))) {
                sawUnknown = true;
                continue;
            }
            if (!row.available) return LSP_UNAVAILABLE;
        }
        return sawUnknown ? LSP_UNKNOWN : LSP_OK;
    }

    // ---------------------------------------------------------------- rows

    /**
     * One quality row. Tri-state {@code broken}/{@code unused} ({@code
     * Boolean.TRUE}/{@code FALSE}/null): null means "validate output
     * unavailable — unknown", never a fabricated verdict. There is no
     * {@code slow} field on purpose (no timing data exists).
     */
    public static final class Row {
        public final String name;
        public final String version;
        public final String scope;
        /** Component counts; null when validate output was unavailable. */
        public final Map<String, Integer> counts;
        public final Boolean broken;
        public final List<String> brokenReasons;
        /** {@link #LSP_NONE} | {@link #LSP_OK} | {@link #LSP_UNAVAILABLE} | {@link #LSP_UNKNOWN}. */
        public final String lsp;
        public final Boolean unused;
        public final boolean validateFailed;
        public final String validateMessage;

        Row(String name, String version, String scope, Map<String, Integer> counts,
                Boolean broken, List<String> brokenReasons, String lsp,
                Boolean unused, boolean validateFailed, String validateMessage) {
            this.name = nz(name);
            this.version = nz(version);
            this.scope = scope == null || scope.isEmpty() ? "user" : scope;
            this.counts = counts;
            this.broken = broken;
            this.brokenReasons = brokenReasons == null ? List.of() : brokenReasons;
            this.lsp = nz(lsp);
            this.unused = unused;
            this.validateFailed = validateFailed;
            this.validateMessage = nz(validateMessage);
        }
    }

    /**
     * Build quality rows from the three sources.
     *
     * @param plugins     rows from {@code PluginManager.parsePluginInstalled}
     *                    (name/version/scope/dir/ok maps); null = unreadable
     * @param validations per-plugin {@link Validation} by name (a missing or
     *                    failed entry degrades that row honestly)
     * @param lspStatus   {@link #parseCodeIntelStatus} result; null = no probe
     * @return rows, or null when the plugin list itself was unreadable.
     */
    public static List<Row> buildQualityRows(List<Map<String, Object>> plugins,
            Map<String, Validation> validations, List<StatusServer> lspStatus) {
        if (plugins == null) return null;
        List<Row> out = new ArrayList<Row>();
        for (Map<String, Object> p : plugins) {
            if (p == null) continue;
            String name = str(p.get("name"));
            String version = str(p.get("version"));
            String scope = str(p.get("scope"));
            boolean discoveredBad = Boolean.FALSE.equals(p.get("ok"));
            Validation v = validations == null ? null : validations.get(name);
            boolean failed = v == null || v.failed || v.counts == null;
            if (failed) {
                out.add(new Row(name, version, scope, null,
                        discoveredBad ? Boolean.TRUE : null, List.of(),
                        LSP_UNKNOWN, null, true,
                        v != null && !v.message.isEmpty()
                                ? v.message : "plugin validate produced no output"));
                continue;
            }
            boolean broken = !v.ok || !v.errors.isEmpty() || discoveredBad;
            boolean unused = true;
            for (String t : COMPONENT_TYPES) {
                Integer n = v.counts.get(t);
                if (n != null && n > 0) { unused = false; break; }
            }
            out.add(new Row(name, version, scope,
                    Collections.unmodifiableMap(v.counts), broken,
                    v.errors.subList(0, Math.min(5, v.errors.size())),
                    deriveLspAvailability(v.lsp, lspStatus), unused, false, ""));
        }
        return out;
    }

    // ------------------------------------------------------------- display

    /** {@code "skills 2 · lsp 1"} — only the non-zero component types. */
    public static String formatCounts(Map<String, Integer> counts) {
        if (counts == null) return "";
        StringBuilder sb = new StringBuilder();
        for (String t : COMPONENT_TYPES) {
            Integer n = counts.get(t);
            if (n == null || n <= 0) continue;
            if (sb.length() > 0) sb.append(" · ");
            sb.append(t).append(' ').append(n);
        }
        return sb.toString();
    }

    /**
     * The flag badges for one row (plain text, same rules as the VS twin's
     * pills): {@code ✖ broken} / {@code validity unknown}, the lsp verdict
     * (silent when {@code none}), and {@code unused}. Deliberately no
     * {@code slow} badge — the CLI has no timing.
     */
    public static List<String> flagsFor(Row r) {
        List<String> flags = new ArrayList<String>();
        if (r == null) return flags;
        if (Boolean.TRUE.equals(r.broken)) flags.add("✖ broken");
        else if (r.broken == null) flags.add("validity unknown");
        if (LSP_OK.equals(r.lsp)) flags.add("lsp ok");
        else if (LSP_UNAVAILABLE.equals(r.lsp)) flags.add("lsp unavailable");
        else if (LSP_UNKNOWN.equals(r.lsp)) flags.add("lsp unknown");
        if (Boolean.TRUE.equals(r.unused)) flags.add("unused");
        return flags;
    }

    /**
     * Plain-text quality board for a monospace area (the JB stand-in for the
     * VS twin's {@code renderQualityHtml}): probe warning, unreadable/empty
     * states, then one block per plugin — name/version/scope, component
     * counts (or the per-plugin validate failure), flags and broken reasons.
     */
    public static String describe(List<Row> rows, boolean lspStatusAvailable) {
        StringBuilder sb = new StringBuilder();
        if (!lspStatusAvailable) {
            sb.append("⚠ `cc code-intel status` unavailable — LSP availability shown as unknown.\n\n");
        }
        if (rows == null) {
            sb.append("could not read plugins (is cc installed?)");
            return sb.toString();
        }
        if (rows.isEmpty()) {
            sb.append("No runtime plugins installed.");
            return sb.toString();
        }
        boolean first = true;
        for (Row r : rows) {
            if (r == null) continue;
            if (!first) sb.append('\n');
            first = false;
            sb.append(r.name);
            if (!r.version.isEmpty()) sb.append(" v").append(r.version);
            sb.append("  [").append(r.scope).append("]\n");
            if (r.validateFailed) {
                sb.append("    components: validate failed: ")
                        .append(r.validateMessage).append('\n');
            } else {
                String counts = formatCounts(r.counts);
                sb.append("    components: ")
                        .append(counts.isEmpty() ? "(none)" : counts).append('\n');
            }
            List<String> flags = flagsFor(r);
            if (!flags.isEmpty()) {
                sb.append("    flags: ").append(String.join(", ", flags)).append('\n');
            }
            if (!r.brokenReasons.isEmpty()) {
                sb.append("    errors: ")
                        .append(String.join("; ", r.brokenReasons)).append('\n');
            }
        }
        return sb.toString();
    }

    /**
     * One-line counts summary for the board header:
     * {@code "plugins: 3 · broken: 1 · lsp unavailable: 1 · unknown: 1 · unused: 1"}
     * (plus the probe warning). {@code "plugins: n/a"} when unreadable.
     */
    public static String summaryLine(List<Row> rows, boolean lspStatusAvailable) {
        if (rows == null) return "plugins: n/a";
        int broken = 0, lspUnavailable = 0, unknown = 0, unused = 0;
        for (Row r : rows) {
            if (r == null) continue;
            if (Boolean.TRUE.equals(r.broken)) broken++;
            if (LSP_UNAVAILABLE.equals(r.lsp)) lspUnavailable++;
            if (r.broken == null || LSP_UNKNOWN.equals(r.lsp)) unknown++;
            if (Boolean.TRUE.equals(r.unused)) unused++;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("plugins: ").append(rows.size())
                .append(" · broken: ").append(broken)
                .append(" · lsp unavailable: ").append(lspUnavailable)
                .append(" · unknown: ").append(unknown)
                .append(" · unused: ").append(unused);
        if (!lspStatusAvailable) sb.append(" · lsp probe: unavailable");
        return sb.toString();
    }

    // -------------------------------------------------------------- helpers

    private static Map<?, ?> parseObject(String text) {
        try {
            Object parsed = MiniJson.parse(text == null ? "" : text.trim());
            return parsed instanceof Map ? (Map<?, ?>) parsed : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static List<String> strList(Object v) {
        List<String> out = new ArrayList<String>();
        if (v instanceof List) {
            for (Object o : (List<?>) v) {
                if (o == null) continue;
                String s = String.valueOf(o);
                if (!s.isEmpty()) out.add(s);
            }
        }
        return out;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String str(Object v) {
        return v == null ? "" : String.valueOf(v);
    }
}
