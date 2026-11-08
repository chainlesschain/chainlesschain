package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class SessionModelInputsTest {
    private static final String HASH = "a".repeat(64);
    private static final String ID = "12345678-1234-1234-1234-123456789abc";
    private Map<String, Object> event(boolean logical) {
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("schema", "chainlesschain.model-input-diagnostic/v1");
        event.put("requestId", ID);
        event.put("usageCallId", "mdl-" + ID);
        event.put("billingVerified", false);
        event.put("phase", logical ? "logical-input" : "body-prepared");
        event.put("bytes", 200L);
        event.put("rawBody", "PRIVATE-SOURCE");
        if (logical) {
            Map<String, Object> planningSource = new LinkedHashMap<>();
            planningSource.put("ordinal", 0L); planningSource.put("digest", HASH); planningSource.put("kind", "message");
            planningSource.put("disposition", "selected"); planningSource.put("reason", null);
            event.put("logicalDigest", HASH);
            event.put("messageCount", 2L);
            event.put("toolCount", 0L);
            event.put("planning", Map.of("covered", true, "digest", "sha256:" + HASH, "selectedCount", 2L,
                    "dropped", Map.of("input_budget", 1L, "PRIVATE-PATH", 999L),
                    "sourceDetailsCovered", true, "sourceCount", 1L, "sourcesTruncated", false,
                    "sources", List.of(planningSource)));
            event.put("projection", Map.of("covered", true, "manifestDigest", HASH, "projectionDigest", HASH,
                    "rulesetDigest", HASH, "tenantId", "PRIVATE-TENANT"));
            event.put("sourceMapping", Map.of("covered", true, "reason", "complete", "sourceCount", 1L,
                    "sourcesTruncated", false, "sources", List.of(Map.of("ordinal", 0L,
                            "input", List.of(Map.of("kind", "message", "index", 0L, "digest", HASH)),
                            "logical", List.of(Map.of("kind", "message", "index", 0L, "digest", HASH)),
                            "changed", false, "redactionTouched", false, "injectionTouched", false, "derived", false))));
        } else {
            Map<String, Object> fragment = new LinkedHashMap<>();
            fragment.put("path", "/messages/0"); fragment.put("start", null); fragment.put("end", null);
            fragment.put("digest", HASH); fragment.put("bytes", 12L);
            event.put("stage", "fetch-body");
            event.put("attempt", 1L);
            event.put("bodyCovered", true);
            event.put("bodyDigest", HASH);
            event.put("providerAcceptanceVerified", false);
            event.put("sourceMapping", Map.of("covered", true, "reason", "complete", "sourceCount", 1L,
                    "sourcesTruncated", false, "protocol", "openai-chat", "sources", List.of(Map.of("ordinal", 0L,
                            "status", "mapped", "fragments", List.of(fragment)))));
        }
        return event;
    }
    private String report(List<Map<String, Object>> events) {
        return MiniJson.stringify(Map.of("schema", "chainlesschain.session-model-inputs/v1", "sessionId", "session-1",
                "total", events.size(), "truncated", false, "billingVerified", false,
                "rawBody", "PRIVATE-REPORT", "records", events.stream().map(event -> Map.of("eventHash", HASH, "diagnostic", event)).toList()));
    }
    @Test void usesCanonicalBoundedQueryAndSeparatesOptionLikeSessionIds() {
        assertEquals(List.of("session", "show", "--json", "--model-inputs", "--limit", "50", "--", "session-1"),
                SessionModelInputs.arguments("session-1"));
        assertEquals("--option", SessionModelInputs.arguments("--option").get(7));
        for (String invalid : List.of("", "a b", "../session", "s\n--json"))
            assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.arguments(invalid));
    }
    @Test void rendersOnlyKnownSummariesAndPreservesUnknownBilling() {
        SessionModelInputs parsed = SessionModelInputs.parse(report(List.of(event(true), event(false))), "session-1");
        assertEquals(2, parsed.records().size());
        String text = parsed.describe();
        assertTrue(text.contains("input_budget=1"));
        assertTrue(text.contains("planDigest: sha256:" + HASH));
        assertTrue(text.contains("bodyDigest: " + HASH));
        assertTrue(text.contains("sourceMapping"));
        assertTrue(text.contains("Billing / actual token usage: unknown"));
        assertFalse(text.contains("PRIVATE"));
        assertFalse(text.contains("rawBody"));
    }
    @Test void rejectsWrongSessionSchemaBoundsAndUntrustedLabels() {
        assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.parse(report(List.of(event(false))), "other"));
        assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.parse("{\"schema\":\"old-cli\"}", "session-1"));
        assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.parse("x".repeat(SessionModelInputs.MAX_RESPONSE_BYTES + 1), "session-1"));
        for (String field : List.of("requestId", "usageCallId", "bodyDigest", "stage", "bytes")) {
            Map<String, Object> invalid = event(false);
            invalid.put(field, "PRIVATE-SOURCE");
            assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.parse(report(List.of(invalid)), "session-1"));
        }
        Map<String, Object> invalid = event(false);
        invalid.put("providerAcceptanceVerified", true);
        assertThrows(IllegalArgumentException.class, () -> SessionModelInputs.parse(report(List.of(invalid)), "session-1"));
    }
    @Test void emptySessionIsExplicitAndNeverInventsTokenCounts() {
        String text = SessionModelInputs.parse(report(List.of()), "session-1").describe();
        assertTrue(text.contains("No model input diagnostics"));
        assertTrue(text.contains("usage: unknown"));
    }
    @Test void actionIsRegisteredInToolsMenuWithLocalizedLabelsAndSafeUiWiring() throws Exception {
        Path resources = Path.of("src/main/resources");
        var document = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(resources.resolve("META-INF/plugin.xml").toFile());
        var actions = document.getElementsByTagName("action");
        org.w3c.dom.Element found = null;
        for (int i = 0; i < actions.getLength(); i++) {
            var action = (org.w3c.dom.Element) actions.item(i);
            if ("chainlesschain.session.ModelInputs".equals(action.getAttribute("id"))) found = action;
        }
        assertNotNull(found);
        assertEquals("com.chainlesschain.ide.intellij.ModelInputDiagnosticsAction", found.getAttribute("class"));
        assertEquals("ToolsMenu", ((org.w3c.dom.Element) found.getElementsByTagName("add-to-group").item(0)).getAttribute("group-id"));
        for (String bundle : List.of("CcBundle.properties", "CcBundle_zh.properties"))
            assertTrue(Files.readString(resources.resolve("messages/" + bundle)).contains("action.chainlesschain.session.ModelInputs.text="));
        String action = Files.readString(Path.of("src/main/java/com/chainlesschain/ide/intellij/ModelInputDiagnosticsAction.java"));
        assertTrue(action.contains("activeSessionIdOrNullFor(project)"));
        assertTrue(action.contains("AgentChatSession.runCapture(SessionModelInputs.arguments(sessionId)"));
        assertTrue(action.contains("new JTextArea(captured.describe()"));
        assertFalse(action.contains("failure.getMessage()"));
    }
}
