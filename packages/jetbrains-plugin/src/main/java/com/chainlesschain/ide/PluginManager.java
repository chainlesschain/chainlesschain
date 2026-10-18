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

    public static List<String> buildCliGoalPanelsArgs(String id, String name, String scope) {
        return buildCliGoalPanelsArgs(id, name, scope, null);
    }

    public static List<String> buildCliGoalCatalogArgs(String after) {
        return buildCliGoalCatalogArgs(after, null);
    }

    private static void addConnection(List<String> args, String connection) {
        if (connection == null) return;
        if (connection.isEmpty() || connection.length() > 4096 || java.util.regex.Pattern.compile("[\\x00-\\x1f]").matcher(connection).find())
            throw new IllegalArgumentException("Invalid goal connection file");
        args.add("--connection=" + connection);
    }

    public static List<String> buildCliGoalCatalogArgs(String after, String connection) {
        List<String> args = new ArrayList<String>(Arrays.asList("goal", "catalog", "--json"));
        if (after != null) {
            if (!after.matches("[A-Za-z0-9_-]{1,1024}")) throw new IllegalArgumentException("Invalid goal catalog cursor");
            args.add("--after=" + after);
        }
        addConnection(args, connection);
        return args;
    }

    public static Map<String, Object> parseCliGoalCatalog(String text, String expectedStore) {
        return parseCliGoalCatalog(text, expectedStore, null);
    }

    public static Map<String, Object> parseCliGoalCatalog(String text, String expectedStore, String connection) {
        if (text == null || text.length() > 32768
                || text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 32768) return null;
        try {
            Map<?, ?> raw = map(MiniJson.parse(text));
            if (raw == null || !"chainlesschain.goal-catalog.v1".equals(raw.get("schema"))
                    || !Boolean.TRUE.equals(raw.get("snapshot"))
                    || !validText(raw.get("storeId"), 256) || !(connection == null
                        ? raw.get("source") == null && ((String) raw.get("storeId")).matches("cli-goals-[a-f0-9]{64}")
                        : "desktop-project".equals(raw.get("source")) && ((String) raw.get("storeId")).matches("project-goals-[a-f0-9-]{36}"))
                    || (expectedStore != null && !expectedStore.equals(raw.get("storeId")))
                    || !validText(raw.get("observedAt"), 64)
                    || !(raw.get("entries") instanceof List) || ((List<?>) raw.get("entries")).size() > 20
                    || !validCounter(raw.get("scannedCount"), 0) || ((Number) raw.get("scannedCount")).longValue() > 20
                    || !validCounter(raw.get("skippedCount"), 0) || ((Number) raw.get("skippedCount")).longValue() > 20
                    || ((Number) raw.get("scannedCount")).intValue() != ((List<?>) raw.get("entries")).size() + ((Number) raw.get("skippedCount")).intValue()
                    || !validCounter(raw.get("invalidNameCount"), 0) || ((Number) raw.get("invalidNameCount")).longValue() > 2048
                    || !raw.containsKey("nextCursor") || (raw.get("nextCursor") != null && (!validText(raw.get("nextCursor"), 1024)
                        || !((String) raw.get("nextCursor")).matches("[A-Za-z0-9_-]+") || ((Number) raw.get("scannedCount")).intValue() == 0))) return null;
            java.time.Instant.parse((String) raw.get("observedAt"));
            List<Map<String, Object>> entries = new ArrayList<Map<String, Object>>();
            String prior = "";
            for (Object value : (List<?>) raw.get("entries")) {
                Map<?, ?> entry = map(value);
                if (entry == null || !validText(entry.get("id"), 256)
                        || !((String) entry.get("id")).matches("[A-Za-z0-9][A-Za-z0-9._-]{0,255}")
                        || ((String) entry.get("id")).contains("..") || ((String) entry.get("id")).compareTo(prior) <= 0
                        || !(entry.get("title") instanceof String) || ((String) entry.get("title")).length() > 160
                        || java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f-\\x9f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]").matcher((String) entry.get("title")).find()
                        || !Arrays.asList("active", "paused", "done", "abandoned").contains(entry.get("status"))
                        || !validCounter(entry.get("revision"), 1) || !validCounter(entry.get("controlGeneration"), 0)) return null;
                prior = (String) entry.get("id");
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                for (String key : Arrays.asList("id", "title", "status", "revision", "controlGeneration")) row.put(key, entry.get(key));
                entries.add(row);
            }
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            for (String key : Arrays.asList("storeId", "observedAt", "scannedCount", "skippedCount", "invalidNameCount", "nextCursor")) result.put(key, raw.get(key));
            result.put("entries", entries);
            return result;
        } catch (RuntimeException error) { return null; }
    }

    public static List<String> buildCliGoalPanelsArgs(String id, String name, String scope, String expectedStore) {
        return buildCliGoalPanelsArgs(id, name, scope, expectedStore, null);
    }

    public static List<String> buildCliGoalPanelsArgs(String id, String name, String scope, String expectedStore, String connection) {
        if (id == null || !id.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,255}") || id.contains(".."))
            throw new IllegalArgumentException("Enter a standalone CLI goal ID");
        if (name == null || name.isEmpty() || name.length() > 256
                || !Arrays.asList("user", "project", "local").contains(scope))
            throw new IllegalArgumentException("Invalid plugin selection");
        if (expectedStore != null && !expectedStore.matches(connection == null ? "cli-goals-[a-f0-9]{64}" : "project-goals-[a-f0-9-]{36}"))
            throw new IllegalArgumentException("Invalid selected goal store");
        List<String> args = new ArrayList<String>(Arrays.asList("goal", "panels", id,
                "--plugin=" + name, "--scope", scope, "--json"));
        if (expectedStore != null) args.add("--expected-store=" + expectedStore);
        addConnection(args, connection);
        return args;
    }

    /** Bounded snapshot parser. CLI authorization is never inferred locally. */
    public static Map<String, Object> parseCliGoalPanels(
            String text, String goalId, String pluginName, String scope) {
        return parseCliGoalPanels(text, goalId, pluginName, scope, null);
    }

    public static Map<String, Object> parseCliGoalPanels(
            String text, String goalId, String pluginName, String scope, String expectedStore) {
        return parseCliGoalPanels(text, goalId, pluginName, scope, expectedStore, null);
    }

    public static Map<String, Object> parseCliGoalPanels(
            String text, String goalId, String pluginName, String scope, String expectedStore, String connection) {
        if (text == null || text.length() > 131072
                || text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 131072) return null;
        try {
            Map<?, ?> raw = map(MiniJson.parse(text));
            Map<?, ?> ref = raw == null ? null : map(raw.get("goalRef"));
            if (raw == null || ref == null
                    || !"chainlesschain.goal-extension-panels.v1".equals(raw.get("schema"))
                    || !Boolean.TRUE.equals(raw.get("snapshot"))
                    || (connection == null ? raw.get("source") != null : !"desktop-project".equals(raw.get("source")))
                    || !validText(ref.get("id"), 256) || !validText(ref.get("storeId"), 256)
                    || !validCounter(ref.get("revision"), 1) || !validCounter(ref.get("controlGeneration"), 0)
                    || !goalId.equals(ref.get("id")) || !validText(raw.get("observedAt"), 64)
                    || (expectedStore != null && !expectedStore.equals(ref.get("storeId")))
                    || !(raw.get("panels") instanceof List) || ((List<?>) raw.get("panels")).size() > 16
                    || !(raw.get("dropped") instanceof List) || ((List<?>) raw.get("dropped")).size() > 256) return null;
            java.time.Instant.parse((String) raw.get("observedAt"));
            List<Map<String, Object>> panels = new ArrayList<Map<String, Object>>();
            for (Object value : (List<?>) raw.get("panels")) {
                Map<?, ?> panel = map(value);
                Map<?, ?> plugin = panel == null ? null : map(panel.get("plugin"));
                if (plugin == null || !pluginName.equals(plugin.get("name")) || !scope.equals(plugin.get("scope"))
                        || !validText(plugin.get("name"), 256) || !validText(plugin.get("version"), 256)
                        || !Arrays.asList("user", "project", "local").contains(plugin.get("scope"))
                        || !validText(panel.get("id"), 64) || !((String) panel.get("id")).matches("[a-z][a-z0-9-]{0,63}")
                        || !("goal.summary".equals(panel.get("slot")) || (connection != null && "goal.evidence".equals(panel.get("slot")))) || !"text".equals(panel.get("format"))
                        || !(panel.get("text") instanceof String) || ((String) panel.get("text")).length() > 32768) return null;
                Map<String, Object> pluginRef = new LinkedHashMap<String, Object>();
                for (String key : Arrays.asList("name", "scope", "version")) pluginRef.put(key, plugin.get(key));
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                row.put("plugin", pluginRef);
                row.put("id", panel.get("id"));
                row.put("text", panel.get("text"));
                panels.add(row);
            }
            List<Map<String, Object>> dropped = new ArrayList<Map<String, Object>>();
            for (Object value : (List<?>) raw.get("dropped")) {
                Map<?, ?> entry = map(value);
                Map<String, Object> row = new LinkedHashMap<String, Object>();
                row.put("name", bounded(entry == null ? null : entry.get("name"), 256));
                row.put("reason", bounded(entry == null ? null : entry.get("reason"), 128));
                dropped.add(row);
            }
            Map<String, Object> goalRef = new LinkedHashMap<String, Object>();
            for (String key : Arrays.asList("id", "storeId", "revision", "controlGeneration")) goalRef.put(key, ref.get(key));
            Map<String, Object> result = new LinkedHashMap<String, Object>();
            result.put("goalRef", goalRef);
            result.put("observedAt", raw.get("observedAt"));
            result.put("panels", panels);
            result.put("dropped", dropped);
            return result;
        } catch (RuntimeException error) { return null; }
    }

    public static List<String> buildCliGoalDraftRequestArgs(String id,String name,String scope,String expectedStore,String connection,String source,String requestId,String title,String descriptionFile,String out) {
        buildCliGoalPanelsArgs(id,name,scope,expectedStore,connection);
        if(connection==null || source==null || !source.matches("goal-proposal-[a-f0-9]{64}") || !validText(requestId,128) || !validText(title,256) || !validText(descriptionFile,4096) || !validText(out,4096))throw new IllegalArgumentException("Invalid draft request selection");
        for(String value:Arrays.asList(requestId,title,descriptionFile,out))if(java.util.regex.Pattern.compile("[\\x00-\\x1f]").matcher(value).find())throw new IllegalArgumentException("Invalid draft request selection");
        List<String> args=new ArrayList<String>(Arrays.asList("goal","draft-request",id,"--plugin="+name,"--scope",scope,"--connection="+connection,"--source="+source,"--request-id="+requestId,"--title="+title,"--description-file="+descriptionFile,"--out="+out,"--json"));
        if(expectedStore!=null)args.add("--expected-store="+expectedStore);
        return args;
    }
    public static Map<String,Object> parseCliGoalDraftExport(String text,String goalId,String name,String scope,String store,String out,String requestId) {
        if(text==null||text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16384)return null;
        try {
            Map<?,?> value=map(MiniJson.parse(text));
            Map<?,?> goal=value==null?null:map(value.get("goalRef")),plugin=value==null?null:map(value.get("declaredPlugin"));
            if(goal==null||plugin==null||!"chainlesschain.goal-draft-export/v1".equals(value.get("schema"))||!"request-exported".equals(value.get("state"))||!goalId.equals(goal.get("id"))||!store.equals(goal.get("storeId"))||!name.equals(plugin.get("name"))||!scope.equals(plugin.get("scope"))||!out.equals(value.get("file"))||!requestId.equals(value.get("requestId"))||!validText(value.get("contentDigest"),71)||!((String)value.get("contentDigest")).matches("sha256:[a-f0-9]{64}"))return null;
            Map<String,Object> result=new LinkedHashMap<String,Object>();for(String key:Arrays.asList("file","requestId","contentDigest"))result.put(key,value.get(key));return result;
        } catch(RuntimeException error){return null;}
    }
    private static boolean draftText(Object value, int max) {
        return validText(value, max) && !((String) value).trim().isEmpty()
                && !java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f-\\x9f]").matcher((String) value).find();
    }

    private static boolean draftHash(Object value) {
        return value instanceof String && ((String) value).matches("sha256:[a-f0-9]{64}");
    }

    private static boolean exactDraftKeys(Map<?, ?> value, String... keys) {
        return value != null && value.size() == keys.length && value.keySet().containsAll(Arrays.asList(keys));
    }

    private static Map<String, Object> draftJson(String text) {
        if (text == null || text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 32768) return null;
        Object value = MiniJson.parse(text);
        if (!(value instanceof Map)) return null;
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
            if (!(entry.getKey() instanceof String)) return null;
            result.put((String) entry.getKey(), entry.getValue());
        }
        return result;
    }

    private static boolean draftPlugin(Object value, String name, String scope) {
        Map<?, ?> plugin = map(value);
        return exactDraftKeys(plugin, "name", "scope", "version") && name.equals(plugin.get("name"))
                && scope.equals(plugin.get("scope")) && draftText(plugin.get("name"), 256)
                && draftText(plugin.get("version"), 256) && Arrays.asList("user", "project", "local").contains(scope);
    }

    private static boolean draftBinding(Map<?, ?> raw, String id, String name, String scope, String store, Map<String, Object> expected) {
        Map<?, ?> ref = raw == null ? null : map(raw.get("goalRef"));
        Map<?, ?> grant = raw == null ? null : map(raw.get("grantRef"));
        if (!exactDraftKeys(ref, "id", "storeId", "revision", "controlGeneration")
                || !id.equals(ref.get("id")) || !store.equals(ref.get("storeId"))
                || !validCounter(ref.get("revision"), 1) || !validCounter(ref.get("controlGeneration"), 0)
                || !draftPlugin(raw.get("plugin"), name, scope) || !draftHash(raw.get("declarationDigest"))
                || !exactDraftKeys(grant, "id", "epoch") || !draftText(grant.get("id"), 256)
                || !((String) grant.get("id")).matches("goal-external-grant-[a-f0-9]{64}")
                || !validCounter(grant.get("epoch"), 1)) return false;
        if (expected != null) for (String key : Arrays.asList("goalRef", "plugin", "grantRef", "declarationDigest"))
            if (!raw.get(key).equals(expected.get(key))) return false;
        return true;
    }

    public static List<String> buildCliGoalDraftAccessArgs(String name, String scope, String out) {
        if (!draftText(name, 256) || !Arrays.asList("user", "project", "local").contains(scope) || !draftText(out, 4096))
            throw new IllegalArgumentException("Invalid draft access selection");
        return new ArrayList<>(Arrays.asList("goal", "draft-access", "--plugin=" + name, "--scope=" + scope, "--out=" + out, "--json"));
    }

    private static List<String> draftCommand(String command, String id, String name, String scope, String store, String connection) {
        if (!draftText(name, 256) || !draftText(connection, 4096) || store == null)
            throw new IllegalArgumentException("Select a native v3 draft connection");
        buildCliGoalPanelsArgs(id, name, scope, store, connection);
        return new ArrayList<>(Arrays.asList("goal", command, id, "--plugin=" + name, "--scope=" + scope,
                "--expected-store=" + store, "--connection=" + connection, "--json"));
    }

    public static List<String> buildCliGoalDraftSourcesArgs(String id, String name, String scope, String store, String connection, String after) {
        List<String> args = draftCommand("draft-sources", id, name, scope, store, connection);
        if (after != null) {
            if (!after.matches("goal-proposal-[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid draft source cursor");
            args.add("--after=" + after);
        }
        return args;
    }

    public static List<String> buildCliGoalDraftSendArgs(String id, String name, String scope, String store, String connection,
            String source, String requestId, String title, String descriptionFile, String record) {
        List<String> args = draftCommand("draft-send", id, name, scope, store, connection);
        if (source == null || !source.matches("goal-proposal-[a-f0-9]{64}") || !draftText(requestId, 128)
                || !draftText(title, 256) || !draftText(descriptionFile, 4096) || !draftText(record, 4096))
            throw new IllegalArgumentException("Invalid pending draft submission");
        args.addAll(Arrays.asList("--source=" + source, "--request-id=" + requestId, "--title=" + title,
                "--description-file=" + descriptionFile, "--record=" + record));
        return args;
    }

    public static List<String> buildCliGoalDraftReceiptArgs(String id, String name, String scope, String store, String connection, String record) {
        List<String> args = draftCommand("draft-receipt", id, name, scope, store, connection);
        if (!draftText(record, 4096)) throw new IllegalArgumentException("Select the original submission reference");
        args.add("--record=" + record);
        return args;
    }

    public static Map<String, Object> parseCliGoalDraftAccess(String text, String name, String scope, String out) {
        try {
            Map<String, Object> raw = draftJson(text);
            if (!exactDraftKeys(raw, "schema", "state", "plugin", "declarationDigest", "file")
                    || !"chainlesschain.goal-draft-access-export/v1".equals(raw.get("schema"))
                    || !"access-exported".equals(raw.get("state")) || !out.equals(raw.get("file"))
                    || !draftPlugin(raw.get("plugin"), name, scope) || !draftHash(raw.get("declarationDigest"))) return null;
            return raw;
        } catch (RuntimeException error) { return null; }
    }

    public static Map<String, Object> parseCliGoalDraftSources(String text, String id, String name, String scope, String store, Map<String, Object> expected) {
        try {
            Map<String, Object> raw = draftJson(text);
            if (!exactDraftKeys(raw, "schema", "goalRef", "plugin", "declarationDigest", "grantRef", "sources")
                    || !"chainlesschain.goal-draft-source-page/v1".equals(raw.get("schema")) || !draftBinding(raw, id, name, scope, store, expected)) return null;
            Map<?, ?> sources = map(raw.get("sources"));
            if (!exactDraftKeys(sources, "entries", "scannedCount", "unavailableCount", "nextCursor")
                    || !(sources.get("entries") instanceof List) || ((List<?>) sources.get("entries")).size() > 20
                    || !validCounter(sources.get("scannedCount"), 0) || ((Number) sources.get("scannedCount")).longValue() > 20
                    || !validCounter(sources.get("unavailableCount"), 0) || ((Number) sources.get("unavailableCount")).longValue() > 20
                    || ((Number) sources.get("scannedCount")).longValue() != ((List<?>) sources.get("entries")).size() + ((Number) sources.get("unavailableCount")).longValue()) return null;
            String previous = "";
            for (Object item : (List<?>) sources.get("entries")) {
                Map<?, ?> row = map(item);
                if (!exactDraftKeys(row, "id", "sourceTaskId", "reviewId", "reviewDigest") || !draftText(row.get("id"), 256)
                        || !((String) row.get("id")).matches("goal-proposal-[a-f0-9]{64}") || ((String) row.get("id")).compareTo(previous) <= 0
                        || !draftText(row.get("sourceTaskId"), 256) || !draftText(row.get("reviewId"), 256) || !draftHash(row.get("reviewDigest"))) return null;
                previous = (String) row.get("id");
            }
            if (sources.get("nextCursor") != null && (!(sources.get("nextCursor") instanceof String)
                    || !((String) sources.get("nextCursor")).matches("goal-proposal-[a-f0-9]{64}")
                    || ((Number) sources.get("scannedCount")).longValue() == 0)) return null;
            return raw;
        } catch (RuntimeException error) { return null; }
    }

    public static Map<String, Object> parseCliGoalDraftSubmission(String text, String id, String name, String scope, String store,
            String record, String requestId, Map<String, Object> expected) {
        try {
            Map<String, Object> raw = draftJson(text);
            if (!exactDraftKeys(raw, "schema", "state", "goalRef", "plugin", "declarationDigest", "grantRef", "requestId", "inputDigest", "proposalId", "record")
                    || !"chainlesschain.goal-draft-submission/v1".equals(raw.get("schema")) || !draftBinding(raw, id, name, scope, store, expected)
                    || !record.equals(raw.get("record")) || !draftText(raw.get("requestId"), 128)
                    || (requestId != null && !requestId.equals(raw.get("requestId"))) || !draftHash(raw.get("inputDigest"))
                    || !Arrays.asList("saved", "not-found", "unknown").contains(raw.get("state"))) return null;
            if ("saved".equals(raw.get("state")) ? !(raw.get("proposalId") instanceof String)
                    || !((String) raw.get("proposalId")).matches("goal-extension-[a-f0-9]{64}") : raw.get("proposalId") != null) return null;
            return raw;
        } catch (RuntimeException error) { return null; }
    }

    public static String formatCliGoalDraftSubmission(Map<String, Object> result) {
        String lead = "saved".equals(result.get("state"))
                ? "Pending suggestion saved: " + result.get("proposalId") + ". Task modification still requires native preview and confirmation."
                : "not-found".equals(result.get("state")) ? "No matching submission existed at query time. No automatic resend was performed."
                : "Submission result unknown. No automatic resend was performed.";
        return lead + "\nReference: " + result.get("record") + "\nRequest ID: " + result.get("requestId")
                + "\nInput digest: " + result.get("inputDigest") + "\nUse Look up draft receipt with this same reference to reconcile.";
    }

    public static String formatCliGoalPanels(Map<String, Object> result) {
        Map<?, ?> ref = map(result.get("goalRef"));
        StringBuilder out = new StringBuilder("CLI goal snapshot: ")
                .append(ref.get("id")).append(" (revision ").append(ref.get("revision")).append(")\nObserved: ")
                .append(result.get("observedAt"));
        List<?> panels = (List<?>) result.get("panels");
        for (Object value : panels) {
            Map<?, ?> panel = map(value);
            Map<?, ?> plugin = map(panel.get("plugin"));
            out.append("\n\n").append(plugin.get("name")).append(" [").append(plugin.get("scope"))
                    .append("]\n").append(panel.get("text"));
        }
        if (panels.isEmpty()) out.append("\nNo authorized goal panels are available.");
        for (Object value : (List<?>) result.get("dropped")) {
            Map<?, ?> entry = map(value);
            out.append('\n').append(str(entry.get("name")).isEmpty() ? "plugins" : entry.get("name"))
                    .append(": ").append(entry.get("reason"));
        }
        return out.toString();
    }

    private static boolean validText(Object value, int max) {
        return value instanceof String && !((String) value).isEmpty() && ((String) value).length() <= max;
    }

    private static boolean validCounter(Object value, long minimum) {
        if (!(value instanceof Number)) return false;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) && number >= minimum && number <= 9007199254740991d && number == Math.floor(number);
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
            if (r.containsKey("goalExtension")) {
                p.put("goalExtension", parseGoalExtension(r.get("goalExtension")));
            }
            out.add(p);
        }
        return out;
    }

    private static Map<String, Object> parseGoalExtension(Object value) {
        Map<?, ?> raw = map(value);
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        String status = raw == null ? "unknown" : str(raw.get("status"));
        out.put("status", Arrays.asList("legacy", "invalid", "declaration-only").contains(status)
                ? status : "unknown");
        out.put("apiVersion", raw == null ? "" : bounded(raw.get("apiVersion"), 128));
        out.put("apiCompatible", raw != null && Boolean.TRUE.equals(raw.get("apiCompatible")));
        out.put("runtimeAvailable", false); // management data is never admission
        Map<?, ?> rawHosts = raw == null ? null : map(raw.get("hosts"));
        Map<String, Object> hosts = new LinkedHashMap<String, Object>();
        for (String host : Arrays.asList("cli", "vscode", "jetbrains", "desktop")) {
            if (rawHosts != null && rawHosts.get(host) instanceof String) {
                hosts.put(host, bounded(rawHosts.get(host), 128));
            }
        }
        out.put("hosts", hosts);
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
        Map<?, ?> goal = map(p.get("goalExtension"));
        String goalState = "";
        if (goal != null && !"legacy".equals(goal.get("status"))) {
            Map<?, ?> hosts = map(goal.get("hosts"));
            String support = !"declaration-only".equals(goal.get("status"))
                    ? str(goal.get("status"))
                    : !Boolean.TRUE.equals(goal.get("apiCompatible")) ? "unsupported API"
                    : hosts != null && hosts.containsKey("jetbrains")
                            ? "declared for JetBrains" : "JetBrains undeclared";
            goalState = " Goal SDK " + str(goal.get("apiVersion")) + " (" + support
                    + "; runtime unavailable)";
        }
        return (Boolean.TRUE.equals(p.get("ok")) ? "✔ " : "✖ ")
                + p.get("name")
                + (str(p.get("version")).isEmpty() ? "" : " v" + p.get("version"))
                + "  [" + p.get("scope") + "] " + state + " " + signed + managed + goalState;
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

    private static List<String> boundedStrings(
            Object value, int maxItems, int maxLength) {
        List<String> out = new ArrayList<String>();
        if (!(value instanceof List)) return out;
        for (Object item : (List<?>) value) {
            if (out.size() >= maxItems) break;
            if (item instanceof String && !((String) item).isEmpty()) {
                out.add(bounded(item, maxLength));
            }
        }
        return out;
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
