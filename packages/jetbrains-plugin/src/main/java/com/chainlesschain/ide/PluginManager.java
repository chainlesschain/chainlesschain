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

    public static List<String> buildPluginTrustArgs(String name, boolean trusted, String scope) {
        List<String> args = new ArrayList<String>(Arrays.asList(
                "plugin", trusted ? "trust" : "untrust", String.valueOf(name)));
        // The CLI defaults trust/untrust to --scope project, but the panel's Add
        // installs at user scope — without the row's scope, Trust errors ("not
        // installed at project scope") and Untrust silently no-ops (exit 0,
        // trust kept), i.e. the security control appears to succeed without
        // revoking. Mirrors the VS Code twin's buildPluginTrustArgs.
        if (scope != null && !scope.isEmpty()) {
            args.add("--scope");
            args.add(scope);
        }
        return args;
    }

    public static List<String> buildPluginUninstallArgs(String name, String scope) {
        return new ArrayList<String>(Arrays.asList(
                "plugin", "uninstall", String.valueOf(name),
                "--scope", scope == null || scope.isEmpty() ? "user" : scope));
    }

    public static List<String> buildPluginUseArgs(
            String name, String version, String scope) {
        return new ArrayList<String>(Arrays.asList(
                "plugin", "use", String.valueOf(name), String.valueOf(version),
                "--scope", scope == null || scope.isEmpty() ? "user" : scope));
    }

    public static List<String> buildPluginLifecycleArgs(
            String name, boolean enabled, String scope) {
        return new ArrayList<String>(Arrays.asList(
                "plugin", enabled ? "enable" : "disable", String.valueOf(name),
                "--scope", scope == null || scope.isEmpty() ? "user" : scope,
                "--json"));
    }

    public static List<String> buildPluginUpgradeArgs(
            String source, String scope, String registry, String packageName) {
        return buildPluginUpgradeArgs(
                source, scope, registry, packageName, false);
    }

    public static List<String> buildPluginUpgradeArgs(
            String source, String scope, String registry, String packageName,
            boolean grantCapabilities) {
        String target = registry != null && !registry.isEmpty()
                ? packageName : source;
        List<String> args = new ArrayList<String>(Arrays.asList(
                "plugin", "upgrade", target == null ? "" : target,
                "--scope", scope == null || scope.isEmpty() ? "user" : scope));
        if (registry != null && !registry.isEmpty()) {
            args.add("--registry");
            args.add(registry);
        }
        if (grantCapabilities) args.add("--grant-capabilities");
        args.add("--json");
        return args;
    }

    public static List<String> buildPluginConsentArgs(
            String name, String action, String scope) {
        List<String> args = new ArrayList<String>(Arrays.asList(
                "plugin", "consent", String.valueOf(name),
                "--scope", scope == null || scope.isEmpty() ? "user" : scope));
        if ("grant".equals(action)) args.add("--grant");
        else if ("revoke".equals(action)) args.add("--revoke");
        if (!"revoke".equals(action)) args.add("--json");
        return args;
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

    /**
     * Transactional {@code plugin upgrade --json} result. Unknown activation
     * states fail closed so the IDE never reloads sessions against an ambiguous
     * install. Older CLIs infer activated/unchanged from their result flags.
     */
    public static Map<String, Object> parsePluginUpgradeResult(String text) {
        final Map<?, ?> raw;
        try {
            Object parsed = MiniJson.parse(text == null ? "" : text.trim());
            if (!(parsed instanceof Map)) return null;
            raw = (Map<?, ?>) parsed;
        } catch (RuntimeException e) {
            return null;
        }
        String status = str(raw.get("activationStatus"));
        if (status.isEmpty()) {
            status = Boolean.TRUE.equals(raw.get("updated"))
                    || Boolean.TRUE.equals(raw.get("reinstalled"))
                            ? "activated" : "unchanged";
        }
        if (!Arrays.asList("activated", "rolled_back", "unchanged").contains(status)) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("name", bounded(raw.get("name"), 256));
        out.put("version", bounded(raw.get("version"), 128));
        out.put("previousVersion", bounded(raw.get("previousVersion"), 128));
        out.put("activationStatus", status);
        out.put("rollbackVersion", bounded(raw.get("rollbackVersion"), 128));
        String reason = str(raw.get("rollbackReason"));
        out.put("rollbackReason",
                "capability_consent_required".equals(reason)
                        || "capability_consent_failed".equals(reason)
                                ? reason : "");
        out.put("capabilitiesGranted",
                Boolean.TRUE.equals(raw.get("capabilitiesGranted")));
        Object rawCapabilities = raw.get("capabilities");
        if (rawCapabilities instanceof Map) {
            Map<?, ?> capabilities = (Map<?, ?>) rawCapabilities;
            Map<String, Object> safe = new LinkedHashMap<String, Object>();
            safe.put("consented", Boolean.TRUE.equals(capabilities.get("consented")));
            safe.put("reason", bounded(capabilities.get("reason"), 512));
            safe.put("declared", boundedStrings(capabilities.get("declared"), 32, 256));
            safe.put("added", boundedStrings(capabilities.get("added"), 32, 256));
            out.put("capabilities", safe);
        } else {
            out.put("capabilities", null);
        }
        return out;
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
            List<String> versions = new ArrayList<String>();
            if (r.get("versions") instanceof List) {
                for (Object version : (List<?>) r.get("versions")) {
                    if (versions.size() >= 64) break;
                    if (version instanceof String
                            && !((String) version).isEmpty()
                            && ((String) version).length() <= 128) {
                        versions.add((String) version);
                    }
                }
            } else if (!str(r.get("version")).isEmpty()) {
                versions.add(str(r.get("version")));
            }
            p.put("versions", versions);
            p.put("scope", r.get("scope") == null ? "user" : String.valueOf(r.get("scope")));
            p.put("dir", str(r.get("dir"))); // quality board runs `plugin validate <dir>`
            p.put("ok", Boolean.TRUE.equals(r.get("ok")));
            p.put("enabled", !Boolean.FALSE.equals(r.get("enabled")));
            p.put("source", parsePluginSource(r.get("source")));
            p.put("integrity", parsePluginIntegrity(r.get("integrity")));
            p.put("policy", parsePluginPolicy(r.get("policy")));
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
        Map<?, ?> integrity = map(p.get("integrity"));
        Map<?, ?> signature = map(integrity == null ? null : integrity.get("signature"));
        Map<?, ?> policy = map(p.get("policy"));
        String state = Boolean.FALSE.equals(p.get("enabled")) ? "disabled" : "enabled";
        String signed = signature != null && Boolean.TRUE.equals(signature.get("verified"))
                ? "signed" : "unsigned";
        String managed = policy != null && Boolean.TRUE.equals(policy.get("managed"))
                ? (Boolean.FALSE.equals(policy.get("allowed"))
                        ? " policy-blocked" : " managed")
                : "";
        return (Boolean.TRUE.equals(p.get("ok")) ? "✔ " : "✖ ")
                + p.get("name")
                + (str(p.get("version")).isEmpty() ? "" : " v" + p.get("version"))
                + "  [" + p.get("scope") + "] " + state + " " + signed + managed;
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

    private static String bounded(Object value, int max) {
        String text = str(value);
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static Map<?, ?> map(Object value) {
        return value instanceof Map ? (Map<?, ?>) value : null;
    }

    private static Map<String, Object> parsePluginSource(Object value) {
        Map<?, ?> source = map(value);
        if (source == null) return null;
        String type = bounded(source.get("type"), 32);
        String location = bounded(source.get("source"), 4096);
        if (!Arrays.asList("local", "git", "registry").contains(type)
                || location.isEmpty()) return null;
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("type", type);
        out.put("source", location);
        out.put("ref", bounded(source.get("ref"), 256));
        out.put("registry", bounded(source.get("registry"), 4096));
        out.put("resolvedSource", bounded(source.get("resolvedSource"), 4096));
        out.put("package", bounded(source.get("package"), 256));
        out.put("offline", Boolean.TRUE.equals(source.get("offline")));
        return out;
    }

    private static Map<String, Object> parsePluginIntegrity(Object value) {
        Map<?, ?> integrity = map(value);
        Map<?, ?> signature = map(integrity == null ? null : integrity.get("signature"));
        Map<?, ?> sbom = map(integrity == null ? null : integrity.get("sbom"));
        Map<String, Object> sig = new LinkedHashMap<String, Object>();
        sig.put("present", signature != null && Boolean.TRUE.equals(signature.get("present")));
        sig.put("verified", signature != null && Boolean.TRUE.equals(signature.get("verified")));
        sig.put("reason", bounded(signature == null ? null : signature.get("reason"), 512));
        sig.put("manifestSha256", bounded(
                signature == null ? null : signature.get("manifestSha256"), 128));
        sig.put("publicKeySha256", bounded(
                signature == null ? null : signature.get("publicKeySha256"), 128));
        Map<String, Object> bill = new LinkedHashMap<String, Object>();
        bill.put("present", sbom != null && Boolean.TRUE.equals(sbom.get("present")));
        bill.put("digest", bounded(sbom == null ? null : sbom.get("digest"), 128));
        bill.put("fileCount", boundedNumber(
                sbom == null ? null : sbom.get("fileCount"), 100000L));
        bill.put("totalBytes", boundedNumber(
                sbom == null ? null : sbom.get("totalBytes"), Long.MAX_VALUE));
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("signature", sig);
        out.put("sbom", bill);
        return out;
    }

    private static Map<String, Object> parsePluginPolicy(Object value) {
        Map<?, ?> policy = map(value);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("managed", policy != null && Boolean.TRUE.equals(policy.get("managed")));
        out.put("source", bounded(policy == null ? null : policy.get("source"), 4096));
        out.put("allowed", policy == null || !Boolean.FALSE.equals(policy.get("allowed")));
        out.put("reason", bounded(policy == null ? null : policy.get("reason"), 1024));
        out.put("requireSigned",
                policy != null && Boolean.TRUE.equals(policy.get("requireSigned")));
        return out;
    }

    private static long boundedNumber(Object value, long max) {
        if (!(value instanceof Number)) return 0L;
        long number = ((Number) value).longValue();
        return Math.max(0L, Math.min(max, number));
    }
}
