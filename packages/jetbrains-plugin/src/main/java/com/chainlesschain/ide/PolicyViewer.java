package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Permission/policy viewer core (gap #10) — one picture of the policy,
 * actual-resource, side-effect, and recovery surfaces
 * surfaces the cc CLI exposes, plus validated argv builders for CLI-owned
 * workspace-scoped permission mutations:
 *
 * <ul>
 *   <li>{@code cc permissions list --json} → merged
 *       {@code permissions.{allow,ask,deny}} ruleset + per-rule source file +
 *       managed-policy flags;</li>
 *   <li>{@code cc permissions recent --json} → recent policy denials recorded
 *       by agent runs;</li>
 *   <li>{@code cc auto-mode config --json} → effective risk→decision matrix,
 *       fine-grained {@code autoMode.decisions} rules, customized flag;</li>
 *   <li>{@code cc auto-mode defaults} (always JSON) → the built-in decision
 *       precedence chain.</li>
 * </ul>
 *
 * Each {@code parse*} is tolerant: malformed/missing input yields {@code null}
 * and {@link #describe} renders a warning entry for that section while the
 * other sections still render (per-source failure tolerance, same contract as
 * {@link SessionsWorkbench}). Pure JDK — no IntelliJ SDK, no process spawning,
 * no clock reads (callers pass {@code now}); JUnit + smoke tested. The Swing
 * glue lives in {@code intellij/PolicyViewerAction}.
 */
public final class PolicyViewer {

    private PolicyViewer() {}

    private static final List<String> RULE_KINDS = List.of("deny", "ask", "allow");
    private static final List<String> RISK_LEVELS = List.of("low", "medium", "high");
    private static final Pattern SCOPED_RULE_ID =
            Pattern.compile("^spr_[0-9a-f]{32}$");
    private static final Pattern SCOPED_DURATION =
            Pattern.compile("^\\d+(s|m|h|d)$");
    private static final String SIDE_EFFECT_SCHEMA =
            "cc-permission-side-effect-center/v1";

    // ------------------------------------------------------------- sections

    /** One permission rule with its decision kind and source file. */
    public static final class RuleEntry {
        public final String kind;
        public final String rule;
        public final String source;

        RuleEntry(String kind, String rule, String source) {
            this.kind = nz(kind);
            this.rule = nz(rule);
            this.source = nz(source);
        }
    }

    /** One CLI-owned workspace rule with TTL/revocation authority metadata. */
    public static final class ScopedRule {
        public final String id;
        public final long revision;
        public final String decision;
        public final String rule;
        public final String status;
        public final long expiresAt;
        public final String reason;
        public final String source;
        public final String scope;

        ScopedRule(String id, long revision, String decision, String rule,
                String status, long expiresAt, String reason, String source,
                String scope) {
            this.id = nz(id);
            this.revision = Math.max(0L, revision);
            this.decision = nz(decision);
            this.rule = nz(rule);
            this.status = nz(status);
            this.expiresAt = Math.max(0L, expiresAt);
            this.reason = nz(reason);
            this.source = nz(source);
            this.scope = nz(scope);
        }
    }

    /** Parsed {@code cc permissions list --json}. */
    public static final class PermissionsSection {
        /** Rules grouped deny → ask → allow (render order). */
        public final List<RuleEntry> rules;
        public final List<String> files;
        public final String managedFile;
        /** Human-readable managed-policy restrictions in effect. */
        public final List<String> managedFlags;
        public final List<ScopedRule> scopedRules;
        public final long scopedGeneration;
        public final String scopedFile;

        PermissionsSection(List<RuleEntry> rules, List<String> files,
                String managedFile, List<String> managedFlags,
                List<ScopedRule> scopedRules, long scopedGeneration,
                String scopedFile) {
            this.rules = Collections.unmodifiableList(new ArrayList<RuleEntry>(rules));
            this.files = Collections.unmodifiableList(new ArrayList<String>(files));
            this.managedFile = nz(managedFile);
            this.managedFlags = Collections.unmodifiableList(new ArrayList<String>(managedFlags));
            this.scopedRules = Collections.unmodifiableList(
                    new ArrayList<ScopedRule>(scopedRules));
            this.scopedGeneration = Math.max(0L, scopedGeneration);
            this.scopedFile = nz(scopedFile);
        }

        public int count(String kind) {
            int n = 0;
            for (RuleEntry r : rules) if (r.kind.equals(kind)) n++;
            return n;
        }
    }

    /** One recorded policy denial ({@code cc permissions recent --json}). */
    public static final class Denial {
        /** Epoch ms; 0 when unknown. */
        public final long at;
        public final String tool;
        public final String summary;
        public final String reason;
        public final String via;
        public final String rule;
        public final long count;
        public final String permissionMode;

        Denial(long at, String tool, String summary, String reason, String via,
                String rule, long count, String permissionMode) {
            this.at = at;
            this.tool = nz(tool);
            this.summary = nz(summary);
            this.reason = nz(reason);
            this.via = nz(via);
            this.rule = nz(rule);
            this.count = Math.max(1L, count);
            this.permissionMode = nz(permissionMode);
        }
    }

    /** One actual CLI-ledger side effect with bounded resource identities. */
    public static final class SideEffectEntry {
        public final String tool;
        public final String kind;
        public final String state;
        public final boolean irreversible;
        public final Map<String, List<String>> resources;
        public final List<String> unresolvedResources;
        public final String decision;
        public final String decisionVia;
        public final String decisionRule;
        public final String decisionSource;
        public final String decisionReason;
        public final String turnId;
        public final String toolUseId;
        public final String coverage;
        public final String recoveryAction;
        public final String recoveryReason;
        public final String checkpointId;
        public final List<String> uncoveredResources;

        SideEffectEntry(String tool, String kind, String state,
                boolean irreversible, Map<String, List<String>> resources,
                List<String> unresolvedResources, String decision,
                String decisionVia, String decisionRule, String decisionSource,
                String decisionReason, String turnId, String toolUseId,
                String coverage, String recoveryAction, String recoveryReason,
                String checkpointId, List<String> uncoveredResources) {
            this.tool = nz(tool);
            this.kind = nz(kind);
            this.state = nz(state);
            this.irreversible = irreversible;
            Map<String, List<String>> copied = new LinkedHashMap<String, List<String>>();
            for (Map.Entry<String, List<String>> entry : resources.entrySet()) {
                copied.put(entry.getKey(), Collections.unmodifiableList(
                        new ArrayList<String>(entry.getValue())));
            }
            this.resources = Collections.unmodifiableMap(copied);
            this.unresolvedResources = Collections.unmodifiableList(
                    new ArrayList<String>(unresolvedResources));
            this.decision = nz(decision);
            this.decisionVia = nz(decisionVia);
            this.decisionRule = nz(decisionRule);
            this.decisionSource = nz(decisionSource);
            this.decisionReason = nz(decisionReason);
            this.turnId = nz(turnId);
            this.toolUseId = nz(toolUseId);
            this.coverage = nz(coverage);
            this.recoveryAction = nz(recoveryAction);
            this.recoveryReason = nz(recoveryReason);
            this.checkpointId = nz(checkpointId);
            this.uncoveredResources = Collections.unmodifiableList(
                    new ArrayList<String>(uncoveredResources));
        }
    }

    /** Parsed {@code cc permissions activity --json}. */
    public static final class SideEffectSection {
        public final String sessionId;
        public final List<SideEffectEntry> entries;

        SideEffectSection(String sessionId, List<SideEffectEntry> entries) {
            this.sessionId = nz(sessionId);
            this.entries = Collections.unmodifiableList(
                    new ArrayList<SideEffectEntry>(entries));
        }
    }

    /** One riskLevel → decision cell of the auto-mode matrix. */
    public static final class Decision {
        public final String decision;
        public final String reason;
        public final String source;

        Decision(String decision, String reason, String source) {
            this.decision = nz(decision);
            this.reason = nz(reason);
            this.source = nz(source);
        }
    }

    /** One fine-grained {@code autoMode.decisions} rule (tool/commandPattern). */
    public static final class FineRule {
        /** {@code k=v} rendering of the match object, declaration order. */
        public final String match;
        public final String decision;
        public final String reason;

        FineRule(String match, String decision, String reason) {
            this.match = nz(match);
            this.decision = nz(decision);
            this.reason = nz(reason);
        }
    }

    /** Parsed {@code cc auto-mode config --json}. */
    public static final class AutoModeSection {
        public final boolean customized;
        public final boolean classifyAllShell;
        /** riskLevel → decision, low/medium/high order. */
        public final Map<String, Decision> decisions;
        /** Fine-grained rules, tried in order before the risk map. */
        public final List<FineRule> rules;
        public final List<String> files;
        public final String managedFile;

        AutoModeSection(boolean customized, boolean classifyAllShell,
                Map<String, Decision> decisions, List<FineRule> rules,
                List<String> files, String managedFile) {
            this.customized = customized;
            this.classifyAllShell = classifyAllShell;
            this.decisions = Collections.unmodifiableMap(
                    new LinkedHashMap<String, Decision>(decisions));
            this.rules = Collections.unmodifiableList(new ArrayList<FineRule>(rules));
            this.files = Collections.unmodifiableList(new ArrayList<String>(files));
            this.managedFile = nz(managedFile);
        }
    }

    // ---------------------------------------------------------------- parse

    /** Parse {@code cc permissions list --json}; null on malformed/missing. */
    public static PermissionsSection parsePermissions(String stdout) {
        Map<String, Object> root = obj(stdout);
        if (root == null) return null;
        Object rulesObj = root.get("rules");
        if (!(rulesObj instanceof Map)) return null;
        Map<?, ?> rules = (Map<?, ?>) rulesObj;
        Map<?, ?> sources = root.get("sources") instanceof Map
                ? (Map<?, ?>) root.get("sources") : Map.of();
        List<RuleEntry> out = new ArrayList<RuleEntry>();
        for (String kind : RULE_KINDS) {
            Object arr = rules.get(kind);
            if (!(arr instanceof List)) continue;
            for (Object o : (List<?>) arr) {
                String rule = str(o);
                if (rule.isEmpty()) continue;
                out.add(new RuleEntry(kind, rule, str(sources.get(kind + ":" + rule))));
            }
        }
        List<String> files = strList(root.get("files"));
        String managedFile = str(root.get("managedFile"));
        List<String> flags = new ArrayList<String>();
        if (root.get("managed") instanceof Map) {
            Map<?, ?> managed = (Map<?, ?>) root.get("managed");
            if (isTrue(managed.get("allowManagedPermissionRulesOnly"))) {
                flags.add("user/project permission rules disabled");
            }
            Object bypass = managed.get("disableBypassPermissionsMode");
            if (Boolean.TRUE.equals(bypass) || "disable".equals(bypass)) {
                flags.add("bypassPermissions disabled");
            }
            if (isTrue(managed.get("allowManagedHooksOnly"))) {
                flags.add("only managed hooks may run");
            }
            if (isTrue(managed.get("allowManagedMcpServersOnly"))) {
                flags.add("only managed-allowed MCP servers may connect");
            }
            if (isTrue(managed.get("requireSignedPlugins"))) {
                flags.add("signed plugin manifests required");
            }
            if (managed.get("allowedPlugins") instanceof List
                    || managed.get("deniedPlugins") instanceof List
                    || managed.get("blockedMarketplaces") instanceof List) {
                flags.add("managed plugin supply-chain policy active");
            }
        }
        List<ScopedRule> scopedRules = new ArrayList<ScopedRule>();
        long scopedGeneration = 0L;
        String scopedFile = "";
        if (root.get("scoped") instanceof Map) {
            Map<?, ?> scoped = (Map<?, ?>) root.get("scoped");
            scopedGeneration = num(scoped.get("generation"));
            scopedFile = str(scoped.get("file"));
            if (scoped.get("rules") instanceof List) {
                for (Object value : (List<?>) scoped.get("rules")) {
                    if (!(value instanceof Map)) continue;
                    Map<?, ?> record = (Map<?, ?>) value;
                    String id = str(record.get("id"));
                    String decision = str(record.get("decision"));
                    String rule = str(record.get("rule"));
                    if (!SCOPED_RULE_ID.matcher(id).matches()
                            || !RULE_KINDS.contains(decision)
                            || rule.isEmpty()) continue;
                    String status = str(record.get("effectiveStatus"));
                    if (status.isEmpty()) status = str(record.get("status"));
                    scopedRules.add(new ScopedRule(id, num(record.get("revision")),
                            decision, rule, status, num(record.get("expiresAt")),
                            str(record.get("reason")), str(record.get("source")),
                            str(record.get("scope"))));
                }
            }
        }
        return new PermissionsSection(out, files, managedFile, flags,
                scopedRules, scopedGeneration, scopedFile);
    }

    /**
     * Parse {@code cc permissions recent --json}; null on malformed/missing.
     * Result keeps the store's order (oldest → newest); {@link #describe}
     * renders most-recent first, like the CLI.
     */
    public static List<Denial> parseDenials(String stdout) {
        Map<String, Object> root = obj(stdout);
        if (root == null) return null;
        Object arr = root.get("denials");
        if (!(arr instanceof List)) return null;
        List<Denial> out = new ArrayList<Denial>();
        for (Object o : (List<?>) arr) {
            if (!(o instanceof Map)) continue;
            Map<?, ?> m = (Map<?, ?>) o;
            out.add(new Denial(num(m.get("at")), str(m.get("tool")),
                    str(m.get("summary")), str(m.get("reason")), str(m.get("via")),
                    str(m.get("rule")), num(m.get("count")),
                    str(m.get("permissionMode"))));
        }
        return out;
    }

    /** Parse the versioned CLI-owned actual-resource/side-effect projection. */
    public static SideEffectSection parseSideEffects(String stdout) {
        Map<String, Object> root = obj(stdout);
        if (root == null || !SIDE_EFFECT_SCHEMA.equals(root.get("schema"))
                || !"cli".equals(root.get("authority"))
                || !(root.get("entries") instanceof List)) return null;
        List<SideEffectEntry> entries = new ArrayList<SideEffectEntry>();
        for (Object value : (List<?>) root.get("entries")) {
            if (!(value instanceof Map) || entries.size() >= 100) continue;
            Map<?, ?> entry = (Map<?, ?>) value;
            Map<?, ?> rawResources = entry.get("resources") instanceof Map
                    ? (Map<?, ?>) entry.get("resources") : Map.of();
            Map<String, List<String>> resources =
                    new LinkedHashMap<String, List<String>>();
            for (String kind : List.of("files", "network", "processes", "credentials")) {
                resources.put(kind, boundedStrList(rawResources.get(kind), 32, 512));
            }
            Map<?, ?> decision = entry.get("decision") instanceof Map
                    ? (Map<?, ?>) entry.get("decision") : Map.of();
            Map<?, ?> chain = entry.get("callChain") instanceof Map
                    ? (Map<?, ?>) entry.get("callChain") : Map.of();
            Map<?, ?> recovery = entry.get("recovery") instanceof Map
                    ? (Map<?, ?>) entry.get("recovery") : Map.of();
            String coverage = bounded(recovery.get("coverage"), 16);
            if (!List.of("full", "partial", "none", "unknown").contains(coverage)) {
                coverage = "unknown";
            }
            String action = bounded(recovery.get("action"), 16);
            if (!List.of("redo", "inspect", "skip").contains(action)) {
                action = "inspect";
            }
            entries.add(new SideEffectEntry(
                    bounded(entry.get("tool"), 128), bounded(entry.get("kind"), 80),
                    bounded(entry.get("state"), 32), isTrue(entry.get("irreversible")),
                    resources, boundedStrList(entry.get("unresolvedResources"), 32, 512),
                    bounded(decision.get("decision"), 32),
                    bounded(decision.get("via"), 120),
                    bounded(decision.get("rule"), 256),
                    bounded(decision.get("source"), 512),
                    bounded(decision.get("reason"), 500),
                    bounded(chain.get("turnId"), 320),
                    bounded(chain.get("toolUseId"), 320), coverage, action,
                    bounded(recovery.get("reason"), 500),
                    bounded(recovery.get("checkpointId"), 320),
                    boundedStrList(recovery.get("uncoveredResources"), 32, 512)));
        }
        return new SideEffectSection(bounded(root.get("sessionId"), 320), entries);
    }

    /** Parse {@code cc auto-mode config --json}; null on malformed/missing. */
    public static AutoModeSection parseAutoMode(String stdout) {
        Map<String, Object> root = obj(stdout);
        if (root == null) return null;
        Object decisionsObj = root.get("decisions");
        if (!(decisionsObj instanceof Map)) return null;
        Map<?, ?> decisions = (Map<?, ?>) decisionsObj;
        LinkedHashMap<String, Decision> map = new LinkedHashMap<String, Decision>();
        for (String risk : RISK_LEVELS) {
            Object cell = decisions.get(risk);
            if (cell instanceof Map) {
                Map<?, ?> c = (Map<?, ?>) cell;
                map.put(risk, new Decision(str(c.get("decision")),
                        str(c.get("reason")), str(c.get("source"))));
            }
        }
        List<FineRule> rules = new ArrayList<FineRule>();
        if (root.get("rules") instanceof List) {
            for (Object o : (List<?>) root.get("rules")) {
                if (!(o instanceof Map)) continue;
                Map<?, ?> m = (Map<?, ?>) o;
                StringBuilder match = new StringBuilder();
                if (m.get("match") instanceof Map) {
                    for (Map.Entry<?, ?> e : ((Map<?, ?>) m.get("match")).entrySet()) {
                        if (match.length() > 0) match.append(' ');
                        match.append(e.getKey()).append('=').append(str(e.getValue()));
                    }
                }
                rules.add(new FineRule(match.toString(), str(m.get("decision")),
                        str(m.get("reason"))));
            }
        }
        boolean classifyAllShell = false;
        if (root.get("effective") instanceof Map) {
            classifyAllShell =
                    isTrue(((Map<?, ?>) root.get("effective")).get("classifyAllShell"));
        }
        return new AutoModeSection(isTrue(root.get("customized")), classifyAllShell,
                map, rules, strList(root.get("files")), str(root.get("managedFile")));
    }

    /**
     * Precedence chain from {@code cc auto-mode defaults} (built-in defaults
     * document); null on malformed/missing.
     */
    public static List<String> parsePrecedence(String stdout) {
        Map<String, Object> root = obj(stdout);
        if (root == null) return null;
        Object arr = root.get("precedence");
        if (!(arr instanceof List)) return null;
        List<String> out = strList(arr);
        return out.isEmpty() ? null : out;
    }

    // -------------------------------------------------------------- display

    /**
     * One-line counts summary: rule counts per decision, recent denial count,
     * auto-mode classifier state. Missing sections show {@code n/a}.
     */
    public static String summaryLine(PermissionsSection perm, List<Denial> denials,
            AutoModeSection auto) {
        return summaryLineInternal(perm, denials, null, auto, false);
    }

    public static String summaryLine(PermissionsSection perm, List<Denial> denials,
            SideEffectSection sideEffects, AutoModeSection auto) {
        return summaryLineInternal(perm, denials, sideEffects, auto, true);
    }

    private static String summaryLineInternal(PermissionsSection perm,
            List<Denial> denials, SideEffectSection sideEffects,
            AutoModeSection auto, boolean includeSideEffects) {
        StringBuilder sb = new StringBuilder();
        if (perm == null) {
            sb.append("permissions: n/a");
        } else {
            sb.append("permissions: ").append(perm.count("allow")).append(" allow / ")
                    .append(perm.count("ask")).append(" ask / ")
                    .append(perm.count("deny")).append(" deny");
            if (!perm.scopedRules.isEmpty()) {
                long active = perm.scopedRules.stream()
                        .filter(r -> "active".equals(r.status)).count();
                sb.append(" · ").append(active).append('/')
                        .append(perm.scopedRules.size()).append(" scoped active");
            }
        }
        sb.append(" · ");
        sb.append(denials == null ? "denials: n/a" : denials.size() + " recent denials");
        if (includeSideEffects) {
            sb.append(" · ");
            if (sideEffects == null) {
                sb.append("effects: n/a");
            } else {
                long inspect = sideEffects.entries.stream()
                        .filter(entry -> "inspect".equals(entry.recoveryAction)).count();
                sb.append(sideEffects.entries.size()).append(" actual effects / ")
                        .append(inspect).append(" inspect");
            }
        }
        sb.append(" · ");
        if (auto == null) {
            sb.append("auto-mode: n/a");
        } else {
            sb.append("auto-mode: ").append(auto.customized ? "customized" : "defaults");
            if (!auto.rules.isEmpty()) {
                sb.append(" (+").append(auto.rules.size()).append(" fine-grained)");
            }
        }
        return sb.toString();
    }

    private static final String WARN = "⚠ ";

    /**
     * Plain-text render of all four sections for a read-only monospace view.
     * A {@code null} section becomes a warning entry; the others still render.
     */
    public static String describe(PermissionsSection perm, List<Denial> denials,
            AutoModeSection auto, List<String> precedence, long nowMs) {
        return describeInternal(perm, denials, null, auto, precedence, nowMs,
                false);
    }

    public static String describe(PermissionsSection perm, List<Denial> denials,
            SideEffectSection sideEffects, AutoModeSection auto,
            List<String> precedence, long nowMs) {
        return describeInternal(perm, denials, sideEffects, auto, precedence,
                nowMs, true);
    }

    private static String describeInternal(PermissionsSection perm,
            List<Denial> denials, SideEffectSection sideEffects,
            AutoModeSection auto, List<String> precedence, long nowMs,
            boolean includeSideEffects) {
        StringBuilder sb = new StringBuilder();

        sb.append("== Permission rules (permissions.{allow,ask,deny}) ==\n");
        if (perm == null) {
            sb.append(WARN).append("unavailable (cc permissions list failed"
                    + " or returned malformed JSON)\n");
        } else {
            if (perm.rules.isEmpty()) {
                sb.append("  (no permission rules)\n");
            }
            for (String kind : RULE_KINDS) {
                int n = perm.count(kind);
                if (n == 0) continue;
                sb.append(kind).append(" (").append(n).append("):\n");
                for (RuleEntry r : perm.rules) {
                    if (!r.kind.equals(kind)) continue;
                    sb.append("  ").append(pad(r.rule, 36));
                    if (!r.source.isEmpty()) sb.append("  [").append(r.source).append(']');
                    sb.append('\n');
                }
            }
            if (!perm.files.isEmpty()) {
                sb.append("sources: ").append(String.join(", ", perm.files)).append('\n');
            }
            if (!perm.managedFile.isEmpty()) {
                sb.append("managed policy: ").append(perm.managedFile).append(" [managed]\n");
                for (String flag : perm.managedFlags) {
                    sb.append("  - ").append(flag).append('\n');
                }
            }
            sb.append("\n== Workspace-scoped authority ==\n");
            if (perm.scopedRules.isEmpty()) {
                sb.append("  (no scoped rules)\n");
            } else {
                for (ScopedRule rule : perm.scopedRules) {
                    sb.append("  ").append(rule.decision).append(' ')
                            .append(rule.rule).append("  [")
                            .append(rule.status).append("; ")
                            .append(rule.id).append(" r").append(rule.revision)
                            .append("; expires ").append(rule.expiresAt)
                            .append("]\n");
                    if (!rule.reason.isEmpty()) {
                        sb.append("      ").append(rule.reason).append('\n');
                    }
                }
            }
            if (!perm.scopedFile.isEmpty()) {
                sb.append("CLI authority: ").append(perm.scopedFile)
                        .append(" · generation ").append(perm.scopedGeneration)
                        .append('\n');
            }
        }

        sb.append("\n== Recent policy denials ==\n");
        if (denials == null) {
            sb.append(WARN).append("unavailable (cc permissions recent failed"
                    + " or returned malformed JSON)\n");
        } else if (denials.isEmpty()) {
            sb.append("  (no recent policy denials)\n");
        } else {
            for (int i = denials.size() - 1; i >= 0; i--) { // most recent first
                Denial d = denials.get(i);
                sb.append("  - ").append(d.tool.isEmpty() ? "?" : d.tool);
                if (!d.summary.isEmpty()) sb.append(' ').append(d.summary);
                if (d.count > 1) sb.append("  x").append(d.count);
                sb.append("  [").append(d.rule.isEmpty()
                        ? (d.via.isEmpty() ? "policy" : d.via)
                        : d.via + ":" + d.rule);
                if (!d.permissionMode.isEmpty()) {
                    sb.append(" · mode ").append(d.permissionMode);
                }
                String rel = SessionsWorkbench.formatRelativeTime(nowMs, d.at);
                if (!rel.isEmpty()) sb.append(" · ").append(rel);
                sb.append("]\n");
                if (!d.reason.isEmpty()) sb.append("      ").append(d.reason).append('\n');
            }
        }

        if (includeSideEffects) {
            sb.append("\n== Actual resources & side effects ==\n");
        }
        if (includeSideEffects && sideEffects == null) {
            sb.append(WARN).append("unavailable (cc permissions activity failed"
                    + " or returned unsupported JSON)\n");
        } else if (includeSideEffects && sideEffects.entries.isEmpty()) {
            sb.append("  (no side-effect evidence for session ")
                    .append(sideEffects.sessionId.isEmpty()
                            ? "default" : sideEffects.sessionId)
                    .append(")\n");
        } else if (includeSideEffects) {
            for (SideEffectEntry entry : sideEffects.entries) {
                sb.append("  - ").append(entry.tool.isEmpty() ? "?" : entry.tool)
                        .append(' ').append(entry.kind).append(' ')
                        .append(entry.state);
                if (entry.irreversible) sb.append("  [irreversible]");
                sb.append('\n');
                for (Map.Entry<String, List<String>> resource :
                        entry.resources.entrySet()) {
                    if (!resource.getValue().isEmpty()) {
                        sb.append("      ").append(resource.getKey()).append(": ")
                                .append(String.join(", ", resource.getValue()))
                                .append('\n');
                    }
                }
                for (String unresolved : entry.unresolvedResources) {
                    sb.append(WARN).append("    unresolved: ")
                            .append(unresolved).append('\n');
                }
                sb.append("      decision: ").append(entry.decision)
                        .append(" via ").append(entry.decisionVia);
                if (!entry.decisionRule.isEmpty()) {
                    sb.append(" · rule ").append(entry.decisionRule);
                }
                if (!entry.decisionSource.isEmpty()) {
                    sb.append(" · source ").append(entry.decisionSource);
                }
                sb.append('\n');
                if (!entry.decisionReason.isEmpty()) {
                    sb.append("        ").append(entry.decisionReason).append('\n');
                }
                sb.append("      recovery: ").append(entry.coverage).append(" / ")
                        .append(entry.recoveryAction);
                if (!entry.checkpointId.isEmpty()) {
                    sb.append(" · checkpoint ").append(entry.checkpointId);
                }
                sb.append('\n');
                if (!entry.recoveryReason.isEmpty()) {
                    sb.append("        ").append(entry.recoveryReason).append('\n');
                }
                if (!entry.uncoveredResources.isEmpty()) {
                    sb.append(WARN).append("    not restored: ")
                            .append(String.join(", ", entry.uncoveredResources))
                            .append('\n');
                }
                if (!entry.turnId.isEmpty() || !entry.toolUseId.isEmpty()) {
                    sb.append("      call chain:");
                    if (!sideEffects.sessionId.isEmpty()) {
                        sb.append(" session ").append(sideEffects.sessionId);
                    }
                    if (!entry.turnId.isEmpty()) {
                        sb.append(" · turn ").append(entry.turnId);
                    }
                    if (!entry.toolUseId.isEmpty()) {
                        sb.append(" · call ").append(entry.toolUseId);
                    }
                    sb.append('\n');
                }
            }
        }

        sb.append("\n== Auto mode (--permission-mode auto) ==\n");
        if (auto == null) {
            sb.append(WARN).append("unavailable (cc auto-mode config failed"
                    + " or returned malformed JSON)\n");
        } else {
            sb.append("classifier: ").append(auto.customized
                    ? "autoMode.decisions (customized)"
                    : "trusted policy (defaults)").append('\n');
            sb.append("classifyAllShell: ").append(auto.classifyAllShell).append('\n');
            for (FineRule r : auto.rules) {
                sb.append("  rule ").append(r.match).append(" → ").append(r.decision);
                if (!r.reason.isEmpty()) sb.append("  (").append(r.reason).append(')');
                sb.append('\n');
            }
            for (Map.Entry<String, Decision> e : auto.decisions.entrySet()) {
                Decision d = e.getValue();
                sb.append("  ").append(pad(e.getKey(), 6)).append(" risk → ")
                        .append(pad(d.decision, 5));
                sb.append("  (").append(d.source.isEmpty() ? "default" : d.source);
                if (!d.reason.isEmpty()) sb.append(": ").append(d.reason);
                sb.append(")\n");
            }
            sb.append(auto.files.isEmpty()
                    ? "sources: defaults only\n"
                    : "sources: " + String.join(", ", auto.files) + "\n");
            if (!auto.managedFile.isEmpty()) {
                sb.append("managed: ").append(auto.managedFile).append(" [managed]\n");
            }
        }

        sb.append("\n== Decision precedence ==\n");
        if (precedence == null) {
            sb.append(WARN).append("unavailable (cc auto-mode defaults failed"
                    + " or returned malformed JSON)\n");
        } else {
            sb.append("  ").append(String.join(" > ", precedence)).append('\n');
        }
        return sb.toString();
    }

    // -------------------------------------------------------------- helpers

    private static Map<String, Object> obj(String stdout) {
        String s = stdout == null ? "" : stdout.trim();
        if (s.isEmpty()) return null;
        try {
            Object parsed = MiniJson.parse(s);
            if (parsed instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> m = (Map<String, Object>) parsed;
                return m;
            }
        } catch (RuntimeException ignored) {
            // fall through — malformed input is a warning entry, not a crash
        }
        return null;
    }

    private static List<String> strList(Object v) {
        List<String> out = new ArrayList<String>();
        if (v instanceof List) {
            for (Object o : (List<?>) v) {
                String s = str(o);
                if (!s.isEmpty()) out.add(s);
            }
        }
        return out;
    }

    private static List<String> boundedStrList(Object value, int limit, int length) {
        List<String> out = new ArrayList<String>();
        if (!(value instanceof List)) return out;
        for (Object item : (List<?>) value) {
            String text = bounded(item, length);
            if (!text.isEmpty() && !out.contains(text)) out.add(text);
            if (out.size() >= limit) break;
        }
        return out;
    }

    private static String bounded(Object value, int limit) {
        String text = str(value);
        return text.length() <= limit ? text : text.substring(0, limit);
    }

    private static boolean isTrue(Object v) {
        return Boolean.TRUE.equals(v);
    }

    private static String pad(String s, int width) {
        StringBuilder sb = new StringBuilder(s);
        while (sb.length() < width) sb.append(' ');
        return sb.toString();
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String str(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v).trim();
        return "null".equals(s) ? "" : s;
    }

    private static long num(Object v) {
        return v instanceof Number ? ((Number) v).longValue() : 0L;
    }

    /** Risk levels in render order (for the glue / tests). */
    public static List<String> riskLevels() {
        return RISK_LEVELS;
    }

    /** Rule kinds in render order (for the glue / tests). */
    public static List<String> ruleKinds() {
        return RULE_KINDS;
    }

    // ------------------------------------------------------------- cc args

    public static List<String> buildPermissionsListArgs() {
        return Arrays.asList("permissions", "list", "--json");
    }

    public static List<String> buildRecentDenialsArgs(int limit) {
        return Arrays.asList("permissions", "recent", "--json",
                "-n", String.valueOf(Math.max(1, limit)));
    }

    public static List<String> buildPermissionActivityArgs(String sessionId,
            int limit) {
        String session = nz(sessionId).trim();
        if (session.isEmpty()) session = "default";
        if (session.length() > 320 || containsControlLine(session)) {
            throw new IllegalArgumentException("invalid session id");
        }
        return Arrays.asList("permissions", "activity", "--session", session,
                "--limit", String.valueOf(Math.max(1, Math.min(100, limit))),
                "--json");
    }

    public static List<String> buildScopedPermissionCreateArgs(String decision,
            String rule, String expiresIn, String reason,
            long expectedGeneration) {
        String kind = nz(decision).trim().toLowerCase(Locale.ROOT);
        String normalizedRule = nz(rule).trim();
        String duration = nz(expiresIn).trim().toLowerCase(Locale.ROOT);
        String normalizedReason = nz(reason).trim();
        if (!RULE_KINDS.contains(kind)) {
            throw new IllegalArgumentException("invalid decision");
        }
        if (normalizedRule.isEmpty() || containsControlLine(normalizedRule)) {
            throw new IllegalArgumentException("a single-line rule is required");
        }
        if (!SCOPED_DURATION.matcher(duration).matches()) {
            throw new IllegalArgumentException("invalid TTL");
        }
        if (normalizedReason.length() > 500 || containsControlLine(normalizedReason)) {
            throw new IllegalArgumentException("invalid reason");
        }
        if (expectedGeneration < 0) {
            throw new IllegalArgumentException("invalid expected generation");
        }
        List<String> args = new ArrayList<String>(Arrays.asList("permissions",
                "scoped", kind, normalizedRule, "--expires-in", duration));
        if (!normalizedReason.isEmpty()) {
            args.add("--reason");
            args.add(normalizedReason);
        }
        args.add("--expected-generation");
        args.add(String.valueOf(expectedGeneration));
        args.add("--json");
        return Collections.unmodifiableList(args);
    }

    public static List<String> buildScopedPermissionRevokeArgs(String id,
            long revision) {
        String normalizedId = nz(id).trim();
        if (!SCOPED_RULE_ID.matcher(normalizedId).matches() || revision < 1) {
            throw new IllegalArgumentException("invalid scoped rule authority");
        }
        return Arrays.asList("permissions", "revoke", normalizedId,
                "--revision", String.valueOf(revision), "--json");
    }

    private static boolean containsControlLine(String value) {
        return value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0
                || value.indexOf('\0') >= 0;
    }

    public static List<String> buildAutoModeConfigArgs() {
        return Arrays.asList("auto-mode", "config", "--json");
    }

    /** {@code cc auto-mode defaults} always prints JSON (no --json flag). */
    public static List<String> buildAutoModeDefaultsArgs() {
        return Arrays.asList("auto-mode", "defaults");
    }
}
