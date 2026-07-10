package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Plugin / MCP manager (P1 #7) — the Java twin of the VS Code extension's
 * plugin-manager.js. Argv builders + tolerant parsers + list-row formatting
 * over the CLI's --json surface (unified plugin runtime `plugin installed/
 * add/trust/uninstall`, policy-annotated `mcp servers`, read-only
 * `skill list`). The DB-backed `plugin list/install/enable/disable` family is
 * the legacy bookkeeping store and is deliberately not surfaced.
 */
public final class PluginManager {

    private PluginManager() {}

    public static List<String> buildPluginInstalledArgs() {
        return new ArrayList<String>(Arrays.asList("plugin", "installed", "--json"));
    }

    public static List<String> buildPluginTrustArgs(String name, boolean trusted) {
        return new ArrayList<String>(Arrays.asList(
                "plugin", trusted ? "trust" : "untrust", String.valueOf(name)));
    }

    public static List<String> buildPluginUninstallArgs(String name, String scope) {
        return new ArrayList<String>(Arrays.asList(
                "plugin", "uninstall", String.valueOf(name),
                "--scope", scope == null || scope.isEmpty() ? "user" : scope));
    }

    public static List<String> buildPluginAddArgs(String source, String registry) {
        List<String> args = new ArrayList<String>(Arrays.asList(
                "plugin", "add", String.valueOf(source)));
        if (registry != null && !registry.isEmpty()) {
            args.add("--registry");
            args.add(registry);
        }
        args.add("--json");
        return args;
    }

    public static List<String> buildMcpServersArgs() {
        return new ArrayList<String>(Arrays.asList("mcp", "servers", "--json"));
    }

    public static List<String> buildMcpRemoveArgs(String name) {
        return new ArrayList<String>(Arrays.asList("mcp", "remove", String.valueOf(name)));
    }

    public static List<String> buildMcpConnectArgs(String name) {
        return new ArrayList<String>(Arrays.asList(
                "mcp", "connect", String.valueOf(name), "--json"));
    }

    public static List<String> buildSkillListArgs() {
        return new ArrayList<String>(Arrays.asList("skill", "list", "--json"));
    }

    private static List<Map<String, Object>> parseArray(String text) {
        try {
            Object parsed = MiniJson.parse(text == null ? "" : text.trim());
            if (!(parsed instanceof List)) return null;
            List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
            for (Object row : (List<?>) parsed) {
                if (row instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> m = (Map<String, Object>) row;
                    out.add(m);
                }
            }
            return out;
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** {@code plugin installed --json} → rows; null = unreadable. */
    public static List<Map<String, Object>> parsePluginInstalled(String text) {
        List<Map<String, Object>> rows = parseArray(text);
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            if (!(r.get("name") instanceof String) || ((String) r.get("name")).isEmpty()) continue;
            Map<String, Object> p = new LinkedHashMap<String, Object>();
            p.put("name", r.get("name"));
            p.put("version", str(r.get("version")));
            p.put("scope", r.get("scope") == null ? "user" : String.valueOf(r.get("scope")));
            p.put("ok", Boolean.TRUE.equals(r.get("ok")));
            out.add(p);
        }
        return out;
    }

    /** {@code mcp servers --json} → policy-annotated rows; null = unreadable. */
    public static List<Map<String, Object>> parseMcpServers(String text) {
        List<Map<String, Object>> rows = parseArray(text);
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            if (!(r.get("name") instanceof String) || ((String) r.get("name")).isEmpty()) continue;
            Map<String, Object> s = new LinkedHashMap<String, Object>();
            s.put("name", r.get("name"));
            s.put("url", str(r.get("url")));
            s.put("command", str(r.get("command")));
            Object transport = r.get("_transport") != null ? r.get("_transport") : r.get("transport");
            s.put("transport", str(transport));
            Object auto = r.get("autoConnect");
            s.put("autoConnect", Boolean.TRUE.equals(auto)
                    || (auto instanceof Number && ((Number) auto).intValue() == 1));
            s.put("allowed", !Boolean.FALSE.equals(r.get("_allowed")));
            s.put("reason", str(r.get("_reason")));
            out.add(s);
        }
        return out;
    }

    /** {@code skill list --json} → rows; null = unreadable. */
    public static List<Map<String, Object>> parseSkillList(String text) {
        List<Map<String, Object>> rows = parseArray(text);
        if (rows == null) return null;
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> r : rows) {
            Object id = r.get("id") != null ? r.get("id") : r.get("name");
            if (id == null || String.valueOf(id).isEmpty()) continue;
            Map<String, Object> s = new LinkedHashMap<String, Object>();
            s.put("id", String.valueOf(id));
            s.put("name", r.get("name") == null ? String.valueOf(id) : String.valueOf(r.get("name")));
            s.put("category", str(r.get("category")));
            s.put("source", str(r.get("source")));
            s.put("description", str(r.get("description")));
            out.add(s);
        }
        return out;
    }

    /** One JList row for a plugin: {@code "✔ name v1.2.3  [user]"}. */
    public static String formatPluginLine(Map<String, Object> p) {
        return (Boolean.TRUE.equals(p.get("ok")) ? "✔ " : "✖ ")
                + p.get("name")
                + (str(p.get("version")).isEmpty() ? "" : " v" + p.get("version"))
                + "  [" + p.get("scope") + "]";
    }

    /** One JList row for an MCP server: {@code "name (http) url  [blocked: …]"}. */
    public static String formatMcpLine(Map<String, Object> s) {
        StringBuilder sb = new StringBuilder(String.valueOf(s.get("name")));
        if (Boolean.TRUE.equals(s.get("autoConnect"))) sb.append(" [auto]");
        String transport = str(s.get("transport"));
        if (!transport.isEmpty()) sb.append(" (").append(transport).append(')');
        String endpoint = !str(s.get("url")).isEmpty()
                ? str(s.get("url")) : str(s.get("command"));
        if (!endpoint.isEmpty()) sb.append("  ").append(endpoint);
        if (!Boolean.TRUE.equals(s.get("allowed"))) {
            sb.append("  [blocked");
            if (!str(s.get("reason")).isEmpty()) sb.append(": ").append(s.get("reason"));
            sb.append(']');
        }
        return sb.toString();
    }

    /** One JList row for a skill: {@code "name — category [source]"}. */
    public static String formatSkillLine(Map<String, Object> s) {
        StringBuilder sb = new StringBuilder(String.valueOf(s.get("name")));
        if (!str(s.get("category")).isEmpty()) sb.append(" — ").append(s.get("category"));
        if (!str(s.get("source")).isEmpty()) sb.append(" [").append(s.get("source")).append(']');
        return sb.toString();
    }

    /** Case-insensitive substring filter over id/name/category/description. */
    public static List<Map<String, Object>> filterSkills(
            List<Map<String, Object>> skills, String query) {
        if (skills == null) return new ArrayList<Map<String, Object>>();
        String q = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return new ArrayList<Map<String, Object>>(skills);
        List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
        for (Map<String, Object> s : skills) {
            String hay = (s.get("id") + " " + s.get("name") + " "
                    + s.get("category") + " " + s.get("description"))
                    .toLowerCase(Locale.ROOT);
            if (hay.contains(q)) out.add(s);
        }
        return out;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
