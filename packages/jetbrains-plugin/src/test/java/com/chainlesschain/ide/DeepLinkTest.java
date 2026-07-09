package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link DeepLink} URI parser. */
class DeepLinkTest {

    private static Map<String, String> params(String key, String value) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put(key, value);
        return m;
    }

    @Test
    void openWithPromptCarriesTheDecodedPrompt() {
        DeepLink.Action a = DeepLink.parse("open", params("prompt", "fix the bug"));
        assertNotNull(a);
        assertEquals("open", a.action);
        assertEquals("fix the bug", a.prompt);
    }

    @Test
    void bareNullOrBlankTargetMapsToOpen() {
        assertEquals("open", DeepLink.parse(null, null).action);
        assertEquals("open", DeepLink.parse("", null).action);
    }

    @Test
    void leadingSlashStrippedAndCaseInsensitive() {
        assertEquals("open", DeepLink.parse("/open", null).action);
        assertEquals("open", DeepLink.parse("OPEN", null).action);
    }

    @Test
    void noParamsOrBlankPromptYieldsNullPrompt() {
        assertNull(DeepLink.parse("open", null).prompt);
        assertNull(DeepLink.parse("open", params("prompt", "   ")).prompt);
    }

    @Test
    void unsupportedActionReturnsNull() {
        assertNull(DeepLink.parse("delete", params("prompt", "fix the bug")));
        assertNull(DeepLink.parse("close", null));
    }
}
