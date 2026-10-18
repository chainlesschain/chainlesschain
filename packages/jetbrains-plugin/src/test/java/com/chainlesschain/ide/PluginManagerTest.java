package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class PluginManagerTest {
    private static final String DRAFT_STORE = "project-goals-12345678-1234-1234-1234-123456789abc";
    private static final String DRAFT_SOURCE = "goal-proposal-" + "a".repeat(64);
    private static final String DRAFT_RECORD = "C:/exports/submission.json";
    private static Map<String, Object> onlineBinding() {
        Map<String, Object> raw = new java.util.LinkedHashMap<>();
        raw.put("goalRef", Map.of("id", "g1", "storeId", DRAFT_STORE, "revision", 2L, "controlGeneration", 1L));
        raw.put("plugin", Map.of("name", "drafter", "scope", "project", "version", "1.0.0"));
        raw.put("declarationDigest", "sha256:" + "b".repeat(64));
        raw.put("grantRef", Map.of("id", "goal-external-grant-" + "c".repeat(64), "epoch", 1L));
        return raw;
    }
    private static Map<String, Object> onlineSources() {
        Map<String, Object> raw = onlineBinding();
        raw.put("schema", "chainlesschain.goal-draft-source-page/v1");
        Map<String, Object> sources = new java.util.LinkedHashMap<>();
        sources.put("entries", List.of(Map.of("id", DRAFT_SOURCE, "sourceTaskId", "task-1", "reviewId", "review-1", "reviewDigest", "sha256:" + "d".repeat(64))));
        sources.put("scannedCount", 1L); sources.put("unavailableCount", 0L); sources.put("nextCursor", null);
        raw.put("sources", sources); return raw;
    }
    private static Map<String, Object> onlineSubmission(String state) {
        Map<String, Object> raw = onlineBinding();
        raw.put("schema", "chainlesschain.goal-draft-submission/v1"); raw.put("state", state);
        raw.put("requestId", "stable-request"); raw.put("inputDigest", "sha256:" + "e".repeat(64));
        raw.put("proposalId", "saved".equals(state) ? "goal-extension-" + "f".repeat(64) : null);
        raw.put("record", DRAFT_RECORD); return raw;
    }
    private static Map<String, Object> parseOnlineSubmission(Map<String, Object> raw) {
        return PluginManager.parseCliGoalDraftSubmission(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, DRAFT_RECORD, "stable-request", onlineBinding());
    }
    @Test
    void onlineDraftBuildersKeepNativePathsInSingleArgumentsAndRequireReferences() {
        assertEquals(Arrays.asList("goal", "draft-access", "--plugin=drafter", "--scope=project", "--out=C:/new access.json", "--json"),
                PluginManager.buildCliGoalDraftAccessArgs("drafter", "project", "C:/new access.json"));
        List<String> send = PluginManager.buildCliGoalDraftSendArgs("g1", "drafter", "project", DRAFT_STORE, "C:/private connection.json", DRAFT_SOURCE,
                "stable-request", "Pending body", "C:/body file.txt", DRAFT_RECORD);
        assertTrue(send.contains("--connection=C:/private connection.json"));
        assertTrue(send.contains("--record=" + DRAFT_RECORD)); assertTrue(send.contains("--description-file=C:/body file.txt"));
        List<String> receipt = PluginManager.buildCliGoalDraftReceiptArgs("g1", "drafter", "project", DRAFT_STORE, "connection.json", DRAFT_RECORD);
        assertEquals("draft-receipt", receipt.get(1)); assertFalse(receipt.stream().anyMatch(value -> value.startsWith("--description-file")));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalDraftSendArgs("g1", "drafter", "project", DRAFT_STORE, "connection.json", DRAFT_SOURCE,
                "stable-request", "Title", "body.txt", null));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalDraftAccessArgs("drafter", "desktop-builtin", "file.json"));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalDraftSourcesArgs("g1", "drafter", "project", DRAFT_STORE, "connection.json", "../cursor"));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalDraftReceiptArgs("g1", "drafter", "project", DRAFT_STORE, "connection.json", "bad\npath"));
    }
    @Test
    void draftAccessExportsAreLabelsAndNeverSavedSubmissions() {
        Map<String, Object> raw = new java.util.LinkedHashMap<>();
        raw.put("schema", "chainlesschain.goal-draft-access-export/v1"); raw.put("state", "access-exported");
        raw.put("plugin", onlineBinding().get("plugin")); raw.put("declarationDigest", onlineBinding().get("declarationDigest")); raw.put("file", "C:/access.json");
        assertNotNull(PluginManager.parseCliGoalDraftAccess(MiniJson.stringify(raw), "drafter", "project", "C:/access.json"));
        raw.put("state", "saved"); assertNull(PluginManager.parseCliGoalDraftAccess(MiniJson.stringify(raw), "drafter", "project", "C:/access.json"));
        raw.put("state", "access-exported"); raw.put("key", "secret");
        assertNull(PluginManager.parseCliGoalDraftAccess(MiniJson.stringify(raw), "drafter", "project", "C:/access.json"));
    }
    @Test
    void sourcePagesAreBoundedAndPinTheExactGrantAcrossNativeSelection() {
        Map<String, Object> raw = onlineSources();
        assertNotNull(PluginManager.parseCliGoalDraftSources(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, null));
        assertNotNull(PluginManager.parseCliGoalDraftSources(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, onlineBinding()));
        Map<String, Object> expected = onlineBinding(); expected.put("grantRef", Map.of("id", "goal-external-grant-" + "c".repeat(64), "epoch", 2L));
        assertNull(PluginManager.parseCliGoalDraftSources(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, expected));
        @SuppressWarnings("unchecked") Map<String, Object> sources = (Map<String, Object>) raw.get("sources");
        sources.put("scannedCount", 21L); assertNull(PluginManager.parseCliGoalDraftSources(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, null));
        sources.put("scannedCount", 1L); sources.put("nextCursor", "../escape");
        assertNull(PluginManager.parseCliGoalDraftSources(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, null));
        assertNull(PluginManager.parseCliGoalDraftSources("x".repeat(32769), "g1", "drafter", "project", DRAFT_STORE, null));
    }
    @Test
    void savedNotFoundAndUnknownAreDistinctAndRetainTheOriginalReference() {
        for (String state : List.of("saved", "not-found", "unknown")) {
            Map<String, Object> result = parseOnlineSubmission(onlineSubmission(state));
            assertNotNull(result); assertEquals(state, result.get("state")); assertEquals(DRAFT_RECORD, result.get("record"));
            String text = PluginManager.formatCliGoalDraftSubmission(result);
            assertTrue(text.contains("stable-request")); assertTrue(text.contains(DRAFT_RECORD));
            if ("saved".equals(state)) assertTrue(text.contains("native preview and confirmation"));
            else assertTrue(text.contains("No automatic resend"));
            if ("not-found".equals(state)) assertTrue(text.contains("at query time"));
        }
    }
    @Test
    void submissionParsersRejectCrossGoalPluginPathRequestAndImpossibleStates() {
        Map<String, Object> raw = onlineSubmission("saved");
        assertNull(PluginManager.parseCliGoalDraftSubmission(MiniJson.stringify(raw), "g2", "drafter", "project", DRAFT_STORE, DRAFT_RECORD, "stable-request", null));
        assertNull(PluginManager.parseCliGoalDraftSubmission(MiniJson.stringify(raw), "g1", "other", "project", DRAFT_STORE, DRAFT_RECORD, "stable-request", null));
        assertNull(PluginManager.parseCliGoalDraftSubmission(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, "wrong.json", "stable-request", null));
        assertNull(PluginManager.parseCliGoalDraftSubmission(MiniJson.stringify(raw), "g1", "drafter", "project", DRAFT_STORE, DRAFT_RECORD, "other-request", null));
        raw.put("state", "succeeded"); assertNull(parseOnlineSubmission(raw));
        raw.put("state", "unknown"); assertNull(parseOnlineSubmission(raw));
        raw.put("proposalId", null); assertNotNull(parseOnlineSubmission(raw));
        raw.put("key", "secret"); assertNull(parseOnlineSubmission(raw));
    }
    @Test
    void submissionParsersRejectChangedDeclarationVersionAndGrantDuringSend() {
        Map<String, Object> raw = onlineSubmission("saved");
        raw.put("declarationDigest", "sha256:" + "9".repeat(64)); assertNull(parseOnlineSubmission(raw));
        raw = onlineSubmission("saved"); raw.put("plugin", Map.of("name", "drafter", "scope", "project", "version", "2.0.0")); assertNull(parseOnlineSubmission(raw));
        raw = onlineSubmission("saved"); raw.put("grantRef", Map.of("id", "goal-external-grant-" + "c".repeat(64), "epoch", 2L)); assertNull(parseOnlineSubmission(raw));
    }
    @Test
    void draftRequestsUsePinnedNativePathsAndCannotMasqueradeAsSavedActions() {
        String store="project-goals-12345678-1234-1234-1234-123456789abc",connection="C:/private/connection.json",source="goal-proposal-"+"a".repeat(64),out="C:/exports/request.json";
        List<String> args=PluginManager.buildCliGoalDraftRequestArgs("g1","drafter","project",store,connection,source,"stable","Follow up","C:/input/body.txt",out);
        assertTrue(args.contains("--description-file=C:/input/body.txt"));assertTrue(args.contains("--out="+out));assertTrue(args.contains("--expected-store="+store));
        assertThrows(IllegalArgumentException.class,()->PluginManager.buildCliGoalDraftRequestArgs("g1","drafter","project",store,null,source,"stable","Follow up","body.txt",out));
        assertThrows(IllegalArgumentException.class,()->PluginManager.buildCliGoalDraftRequestArgs("g1","drafter","project",store,connection,source,"stable","bad\ntitle","body.txt",out));
        String result="{\"schema\":\"chainlesschain.goal-draft-export/v1\",\"state\":\"request-exported\",\"goalRef\":{\"id\":\"g1\",\"storeId\":\""+store+"\"},\"declaredPlugin\":{\"name\":\"drafter\",\"scope\":\"project\"},\"file\":\""+out+"\",\"requestId\":\"stable\",\"contentDigest\":\"sha256:"+"b".repeat(64)+"\"}";
        assertNotNull(PluginManager.parseCliGoalDraftExport(result,"g1","drafter","project",store,out,"stable"));
        assertNull(PluginManager.parseCliGoalDraftExport(result.replace("request-exported","succeeded"),"g1","drafter","project",store,out,"stable"));
        assertNull(PluginManager.parseCliGoalDraftExport(result,"g1","drafter","project",store,"other","stable"));
    }
    @Test
    void desktopConnectionRequiresExplicitSelectionAndPinsNativeStore() {
        String store = "project-goals-12345678-1234-1234-1234-123456789abc";
        String file = "C:/private/goal connection.json";
        String fixture = "{\"schema\":\"chainlesschain.goal-catalog.v1\",\"source\":\"desktop-project\",\"snapshot\":true,"
                + "\"storeId\":\"" + store + "\",\"observedAt\":\"2026-10-18T00:00:00Z\","
                + "\"scannedCount\":1,\"skippedCount\":0,\"invalidNameCount\":0,\"nextCursor\":null,"
                + "\"entries\":[{\"id\":\"goal-1\",\"title\":\"Delivery\",\"status\":\"active\",\"revision\":1,\"controlGeneration\":0}]}";
        assertNull(PluginManager.parseCliGoalCatalog(fixture, null));
        assertNotNull(PluginManager.parseCliGoalCatalog(fixture, store, file));
        assertTrue(PluginManager.buildCliGoalCatalogArgs(null, file).contains("--connection=" + file));
        assertTrue(PluginManager.buildCliGoalPanelsArgs("goal-1", "viewer", "project", store, file).contains("--expected-store=" + store));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalCatalogArgs(null, "bad\nfile"));
        assertNull(PluginManager.parseCliGoalCatalog(fixture, "other", file));
    }

    @Test
    void boundedCatalogProjectsMetadataAndPinsTheStore() {
        String store = "cli-goals-" + "a".repeat(64);
        String fixture = "{\"schema\":\"chainlesschain.goal-catalog.v1\",\"snapshot\":true,"
                + "\"storeId\":\"" + store + "\",\"observedAt\":\"2026-10-18T00:00:00Z\","
                + "\"scannedCount\":1,\"skippedCount\":0,\"invalidNameCount\":0,\"nextCursor\":null,"
                + "\"entries\":[{\"id\":\"goal-1\",\"title\":\"Delivery\",\"status\":\"active\","
                + "\"revision\":1,\"controlGeneration\":0,\"memory\":\"secret\"}],\"receipt\":\"fake\"}";
        Map<String, Object> result = PluginManager.parseCliGoalCatalog(fixture, store);
        assertNotNull(result);
        assertFalse(result.containsKey("receipt"));
        assertFalse(((Map<?, ?>) ((List<?>) result.get("entries")).get(0)).containsKey("memory"));
        assertNull(PluginManager.parseCliGoalCatalog(fixture, "another-store"));
        assertEquals(Arrays.asList("goal", "catalog", "--json", "--after=abc"), PluginManager.buildCliGoalCatalogArgs("abc"));
        assertThrows(IllegalArgumentException.class, () -> PluginManager.buildCliGoalCatalogArgs("../path"));
        assertTrue(PluginManager.buildCliGoalPanelsArgs("goal-1", "viewer", "project", store).contains("--expected-store=" + store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"scannedCount\":1", "\"scannedCount\":21"), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"scannedCount\":1", "\"scannedCount\":4294967297"), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"skippedCount\":0", "\"skippedCount\":1"), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"revision\":1", "\"revision\":1.5"), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"title\":\"Delivery\"", "\"title\":\"bad\\nlabel\""), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"nextCursor\":null", "\"nextCursor\":\"../path\""), store));
        assertNull(PluginManager.parseCliGoalCatalog(fixture.replace("\"nextCursor\":null,", ""), store));
        assertNull(PluginManager.parseCliGoalCatalog("x".repeat(32769), store));
    }

    @Test
    void cliGoalPanelsAreScopedPlainTextSnapshots() {
        assertEquals(Arrays.asList("goal", "panels", "goal-1", "--plugin=viewer", "--scope", "project", "--json"),
                PluginManager.buildCliGoalPanelsArgs("goal-1", "viewer", "project"));
        assertThrows(IllegalArgumentException.class,
                () -> PluginManager.buildCliGoalPanelsArgs("../goal", "viewer", "project"));
        assertThrows(IllegalArgumentException.class,
                () -> PluginManager.buildCliGoalPanelsArgs("--help", "viewer", "project"));
        String fixture = "{\"schema\":\"chainlesschain.goal-extension-panels.v1\",\"snapshot\":true,"
                + "\"observedAt\":\"2026-10-18T00:00:00.000Z\",\"goalRef\":{\"id\":\"goal-1\","
                + "\"storeId\":\"cli-store\",\"revision\":2,\"controlGeneration\":0},"
                + "\"panels\":[{\"plugin\":{\"name\":\"viewer\",\"scope\":\"project\",\"version\":\"0.1.0\"},"
                + "\"id\":\"progress\",\"slot\":\"goal.summary\",\"format\":\"text\",\"text\":\"<b>plain</b>\"}],"
                + "\"dropped\":[],\"approved\":true,\"receipt\":\"forged\"}";
        Map<String, Object> result = PluginManager.parseCliGoalPanels(fixture, "goal-1", "viewer", "project");
        assertNotNull(result);
        assertNull(PluginManager.parseCliGoalPanels(fixture, "goal-1", "viewer", "project", "another-store"));
        assertFalse(result.containsKey("receipt"));
        assertTrue(PluginManager.formatCliGoalPanels(result).contains("<b>plain</b>"));
        assertNull(PluginManager.parseCliGoalPanels(fixture, "another", "viewer", "project"));
        assertNull(PluginManager.parseCliGoalPanels(fixture, "goal-1", "viewer", "user"));
        assertNull(PluginManager.parseCliGoalPanels(fixture.replace("\"snapshot\":true", "\"snapshot\":false"), "goal-1", "viewer", "project"));
        assertNull(PluginManager.parseCliGoalPanels(fixture.replace("\"format\":\"text\"", "\"format\":\"html\""), "goal-1", "viewer", "project"));
        assertNull(PluginManager.parseCliGoalPanels(fixture.replace("\"revision\":2", "\"revision\":2.5"), "goal-1", "viewer", "project"));
        String evidence = fixture.replace("\"snapshot\":true", "\"snapshot\":true,\"source\":\"desktop-project\"")
                .replace("\"slot\":\"goal.summary\"", "\"slot\":\"goal.evidence\"");
        assertNotNull(PluginManager.parseCliGoalPanels(evidence, "goal-1", "viewer", "project", "cli-store", "private.json"));
        assertNull(PluginManager.parseCliGoalPanels(evidence, "goal-1", "viewer", "project"));
    }

    @Test
    void goalDeclarationsNeverImplyRuntimeAdmission() {
        List<Map<String, Object>> rows = PluginManager.parsePluginInstalled(
                "[{\"name\":\"p\",\"goalExtension\":{\"status\":\"declaration-only\","
                        + "\"apiVersion\":\"1.0.0\",\"apiCompatible\":true,"
                        + "\"runtimeAvailable\":true,\"approved\":true,"
                        + "\"hosts\":{\"jetbrains\":\">=0.37.149\",\"mobile\":\"*\"}}},"
                        + "{\"name\":\"unknown\",\"goalExtension\":{\"status\":\"active\"}},"
                        + "{\"name\":\"legacy\"}]");
        Map<?, ?> goal = (Map<?, ?>) rows.get(0).get("goalExtension");
        assertEquals(false, goal.get("runtimeAvailable"));
        assertFalse(goal.containsKey("approved"));
        assertFalse(((Map<?, ?>) goal.get("hosts")).containsKey("mobile"));
        assertTrue(PluginManager.formatPluginLine(rows.get(0))
                .contains("declared for JetBrains; runtime unavailable"));
        assertEquals("unknown", ((Map<?, ?>) rows.get(1).get("goalExtension")).get("status"));
        assertFalse(rows.get(2).containsKey("goalExtension"));
    }

    @Test
    void targetsUnifiedRuntimeCommands() {
        assertEquals(Arrays.asList("plugin", "installed", "--json"),
                PluginManager.buildPluginInstalledArgs());
        // The row's install scope rides along — CLI trust/untrust default to
        // scope project, so without it Trust errors on user-scope installs and
        // Untrust silently no-ops (VS Code twin buildPluginTrustArgs parity).
        assertEquals(Arrays.asList("plugin", "trust", "p1", "--scope", "user"),
                PluginManager.buildPluginTrustArgs("p1", true, "user"));
        assertEquals(Arrays.asList("plugin", "untrust", "p1", "--scope", "project"),
                PluginManager.buildPluginTrustArgs("p1", false, "project"));
        assertEquals(Arrays.asList("plugin", "trust", "p1"),
                PluginManager.buildPluginTrustArgs("p1", true, null));
        assertEquals(Arrays.asList("plugin", "untrust", "p1"),
                PluginManager.buildPluginTrustArgs("p1", false, ""));
        assertEquals(Arrays.asList("plugin", "uninstall", "p1", "--scope", "project"),
                PluginManager.buildPluginUninstallArgs("p1", "project"));
        assertEquals(Arrays.asList("plugin", "uninstall", "p1", "--scope", "user"),
                PluginManager.buildPluginUninstallArgs("p1", null));
        assertEquals(Arrays.asList(
                        "plugin", "use", "p1", "1.0.0", "--scope", "project"),
                PluginManager.buildPluginUseArgs("p1", "1.0.0", "project"));
        assertEquals(Arrays.asList(
                        "plugin", "disable", "p1", "--scope", "local", "--json"),
                PluginManager.buildPluginLifecycleArgs("p1", false, "local"));
        assertEquals(Arrays.asList(
                        "plugin", "enable", "p1", "--scope", "user", "--json"),
                PluginManager.buildPluginLifecycleArgs("p1", true, "user"));
        assertEquals(Arrays.asList(
                        "plugin", "upgrade", "p1", "--scope", "project",
                        "--registry", "https://registry.example/plugins.json",
                        "--grant-capabilities",
                        "--json"),
                PluginManager.buildPluginUpgradeArgs(
                        "ignored", "project",
                        "https://registry.example/plugins.json", "p1", true));
        assertEquals(Arrays.asList(
                        "plugin", "consent", "p1", "--scope", "user", "--json"),
                PluginManager.buildPluginConsentArgs("p1", "status", "user"));
        assertEquals(Arrays.asList(
                        "plugin", "consent", "p1", "--scope", "user",
                        "--grant", "--json"),
                PluginManager.buildPluginConsentArgs("p1", "grant", "user"));
        assertEquals(Arrays.asList(
                        "plugin", "consent", "p1", "--scope", "user", "--revoke"),
                PluginManager.buildPluginConsentArgs("p1", "revoke", "user"));
        assertEquals(Arrays.asList("plugin", "add", "./dir", "--json"),
                PluginManager.buildPluginAddArgs("./dir", ""));
        assertEquals(Arrays.asList("plugin", "add", "pkg",
                        "--registry", "https://r.example", "--json"),
                PluginManager.buildPluginAddArgs("pkg", "https://r.example"));
        assertEquals(Arrays.asList("mcp", "servers", "--json"),
                PluginManager.buildMcpServersArgs());
        assertEquals(Arrays.asList("mcp", "remove", "srv"),
                PluginManager.buildMcpRemoveArgs("srv"));
        assertEquals(Arrays.asList("mcp", "connect", "srv", "--json"),
                PluginManager.buildMcpConnectArgs("srv"));
        assertEquals(Arrays.asList("skill", "list", "--json"),
                PluginManager.buildSkillListArgs());
    }

    @Test
    void distinguishesUnreadableFromEmpty() {
        assertNull(PluginManager.parsePluginInstalled("not json"));
        assertTrue(PluginManager.parsePluginInstalled("[]").isEmpty());
        assertNull(PluginManager.parseMcpServers("nope"));
        assertNull(PluginManager.parseSkillList("{}"));
        assertNull(PluginManager.parsePluginUpgradeResult("not json"));
    }

    @Test
    void parsesTransactionalUpgradeActivationAndRollback() {
        Map<String, Object> activated = PluginManager.parsePluginUpgradeResult(
                "{\"name\":\"a\",\"version\":\"2.0.0\","
                        + "\"previousVersion\":\"1.0.0\",\"updated\":true}");
        assertNotNull(activated);
        assertEquals("activated", activated.get("activationStatus"));
        assertEquals("2.0.0", activated.get("version"));

        Map<String, Object> rolledBack = PluginManager.parsePluginUpgradeResult(
                "{\"name\":\"a\",\"version\":\"2.0.0\","
                        + "\"activationStatus\":\"rolled_back\","
                        + "\"rollbackVersion\":\"1.0.0\","
                        + "\"rollbackReason\":\"capability_consent_required\","
                        + "\"capabilities\":{\"consented\":false,"
                        + "\"reason\":\"capabilities widened\","
                        + "\"declared\":[\"process\",\"network:*\"],"
                        + "\"added\":[\"network:*\"]}}");
        assertNotNull(rolledBack);
        assertEquals("rolled_back", rolledBack.get("activationStatus"));
        assertEquals("1.0.0", rolledBack.get("rollbackVersion"));
        assertEquals("capability_consent_required",
                rolledBack.get("rollbackReason"));
        assertTrue(rolledBack.get("capabilities") instanceof Map);
        assertNull(PluginManager.parsePluginUpgradeResult(
                "{\"activationStatus\":\"partially_active\"}"));
    }

    @Test
    void parsesPluginRowsAndFormatsLines() {
        List<Map<String, Object>> rows = PluginManager.parsePluginInstalled(
                "[{\"name\":\"a\",\"version\":\"1.0.0\","
                        + "\"versions\":[\"2.0.0\",\"1.0.0\"],"
                        + "\"scope\":\"user\",\"ok\":true,\"enabled\":false,"
                        + "\"source\":{\"type\":\"registry\","
                        + "\"source\":\"https://registry.example/plugins.json\","
                        + "\"package\":\"a\",\"ref\":\"v1.0.0\"},"
                        + "\"integrity\":{\"signature\":{\"present\":true,"
                        + "\"verified\":true,\"publicKeySha256\":\"key\"},"
                        + "\"sbom\":{\"present\":true,\"fileCount\":4,"
                        + "\"totalBytes\":123,\"digest\":\"sbom\"}},"
                        + "\"policy\":{\"managed\":true,\"allowed\":false,"
                        + "\"source\":\"/managed.json\",\"reason\":\"denied\"}},"
                        + "{\"name\":\"b\",\"scope\":\"project\",\"ok\":false},"
                        + "{\"noName\":true}]");
        assertEquals(2, rows.size());
        assertEquals(Arrays.asList("2.0.0", "1.0.0"), rows.get(0).get("versions"));
        assertEquals("✔ a v1.0.0  [user] disabled signed policy-blocked",
                PluginManager.formatPluginLine(rows.get(0)));
        assertEquals("registry",
                ((Map<?, ?>) rows.get(0).get("source")).get("type"));
        assertEquals(4L, ((Map<?, ?>) ((Map<?, ?>)
                rows.get(0).get("integrity")).get("sbom")).get("fileCount"));
        assertEquals("✖ b  [project] enabled unsigned",
                PluginManager.formatPluginLine(rows.get(1)));
    }

    @Test
    void parsesMcpServersWithPolicyAnnotations() {
        List<Map<String, Object>> rows = PluginManager.parseMcpServers(
                "[{\"name\":\"good\",\"url\":\"https://x\",\"_transport\":\"https\","
                        + "\"autoConnect\":1,\"_allowed\":true},"
                        + "{\"name\":\"blocked\",\"command\":\"node srv.js\","
                        + "\"_allowed\":false,\"_reason\":\"http not allowed\"}]");
        assertEquals(2, rows.size());
        String good = PluginManager.formatMcpLine(rows.get(0));
        assertTrue(good.contains("good"));
        assertTrue(good.contains("[auto]"));
        assertTrue(good.contains("(https)"));
        assertTrue(good.contains("https://x"));
        assertFalse(good.contains("blocked"));
        String blocked = PluginManager.formatMcpLine(rows.get(1));
        assertTrue(blocked.contains("[blocked: http not allowed]"));
        assertTrue(blocked.contains("node srv.js"));
    }

    @Test
    void parsesAndFiltersSkills() {
        List<Map<String, Object>> rows = PluginManager.parseSkillList(
                "[{\"id\":\"s1\",\"name\":\"Skill One\",\"category\":\"ai\","
                        + "\"source\":\"bundled\",\"description\":\"does AI things\"},"
                        + "{\"name\":\"only-name\"},{\"neither\":true}]");
        assertEquals(2, rows.size());
        assertEquals("Skill One — ai [bundled]",
                PluginManager.formatSkillLine(rows.get(0)));
        assertEquals("only-name", PluginManager.formatSkillLine(rows.get(1)));

        // Filter matches id/name/category/description, case-insensitive.
        assertEquals(1, PluginManager.filterSkills(rows, "AI things").size());
        assertEquals(1, PluginManager.filterSkills(rows, "ONLY-NAME").size());
        assertEquals(2, PluginManager.filterSkills(rows, "").size());
        assertEquals(0, PluginManager.filterSkills(rows, "zzz").size());
        assertTrue(PluginManager.filterSkills(null, "x").isEmpty());
    }
}
