package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Pure JUnit 5 coverage for {@link CcCompletion}'s request-building and
 * response-parsing (the SDK-free glue behind the JetBrains ghost-text provider).
 * {@code fetch()} spawns a real process and is exercised by runtime/smoke, not here.
 */
class CcCompletionTest {

    @Test
    void buildRequestJson_roundTripsThroughMiniJson() {
        String json = CcCompletion.buildRequestJson("a", "b", "javascript");
        Map<String, Object> parsed = MiniJson.parseObject(json);
        assertEquals("a", parsed.get("prefix"));
        assertEquals("b", parsed.get("suffix"));
        assertEquals("javascript", parsed.get("language"));
    }

    @Test
    void buildRequestJson_nullFieldsBecomeEmptyStrings() {
        Map<String, Object> parsed = MiniJson.parseObject(
                CcCompletion.buildRequestJson(null, null, null));
        assertEquals("", parsed.get("prefix"));
        assertEquals("", parsed.get("suffix"));
        assertEquals("", parsed.get("language"));
    }

    @Test
    void buildRequestJson_escapesQuotesAndNewlines() {
        String json = CcCompletion.buildRequestJson("line1\n\"q\"", "}", "");
        // Must survive a round-trip rather than corrupt the body.
        Map<String, Object> parsed = MiniJson.parseObject(json);
        assertEquals("line1\n\"q\"", parsed.get("prefix"));
        assertEquals("}", parsed.get("suffix"));
    }

    @Test
    void parseCompletion_readsCompletionField() {
        assertEquals("foo()", CcCompletion.parseCompletion("{\"completion\":\"foo()\"}"));
    }

    @Test
    void parseCompletion_emptyOnBadShape() {
        assertEquals("", CcCompletion.parseCompletion("not json"));
        assertEquals("", CcCompletion.parseCompletion("{\"x\":1}"));
        assertEquals("", CcCompletion.parseCompletion(""));
        assertEquals("", CcCompletion.parseCompletion(null));
    }

    @Test
    void parseCompletion_nonStringCompletionYieldsEmpty() {
        assertEquals("", CcCompletion.parseCompletion("{\"completion\":123}"));
        assertEquals("", CcCompletion.parseCompletion("{\"completion\":null}"));
    }

    @Test
    void cleanCompletion_stripsMarkdownFence() {
        assertEquals("const x = 1;",
                CcCompletion.cleanCompletion("```js\nconst x = 1;\n```"));
    }

    @Test
    void cleanCompletion_dropsCursorSentinel() {
        assertEquals("ab", CcCompletion.cleanCompletion("a<CURSOR>b"));
    }

    @Test
    void cleanCompletion_capsLength() {
        StringBuilder huge = new StringBuilder();
        for (int i = 0; i < CcCompletion.MAX_COMPLETION_CHARS + 500; i++) huge.append('x');
        assertEquals(CcCompletion.MAX_COMPLETION_CHARS,
                CcCompletion.cleanCompletion(huge.toString()).length());
    }

    @Test
    void cleanCompletion_trimsTrailingWhitespaceButKeepsLeadingIndent() {
        assertEquals("    indented", CcCompletion.cleanCompletion("    indented   \n"));
    }

    @Test
    void cleanCompletion_emptyOnNullOrBlank() {
        assertEquals("", CcCompletion.cleanCompletion(null));
        assertEquals("", CcCompletion.cleanCompletion(""));
    }

    @Test
    void fetch_returnsEmptyWhenBothSidesBlank() {
        // No prefix and no suffix → nothing to complete; must short-circuit without
        // spawning a process.
        assertEquals("", CcCompletion.fetch("", "", "js", null, 1000));
        assertEquals("", CcCompletion.fetch(null, null, null, null, 1000));
    }

    @Test
    void cleanCompletion_leavesPlainCodeUntouched() {
        assertTrue(CcCompletion.cleanCompletion("return x + 1;").equals("return x + 1;"));
    }
}
