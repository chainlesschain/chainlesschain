package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

    private static Map<String, String> params(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
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

    @Test
    void resumesValidSessionAndRejectsJunk() {
        assertEquals("panel-1720-a9f",
                DeepLink.parse("open", params("session", "panel-1720-a9f")).session);
        assertNull(DeepLink.parse("open", params("session", "../etc/passwd")).session);
        assertNull(DeepLink.parse("open", params("session", "a".repeat(200))).session);
    }

    @Test
    void carriesFileWithLineAndDropsLoneLine() {
        DeepLink.Action a = DeepLink.parse("open", params("file", "src/app.ts", "line", "42"));
        assertEquals("src/app.ts", a.file);
        assertEquals(42, a.line);
        // line with no file → no file, line stays 0
        DeepLink.Action b = DeepLink.parse("open", params("line", "9"));
        assertNull(b.file);
        assertEquals(0, b.line);
        // bad lines ignored, file still present
        for (String bad : new String[] {"0", "-3", "abc", ""}) {
            DeepLink.Action x = DeepLink.parse("open", params("file", "a.ts", "line", bad));
            assertEquals("a.ts", x.file);
            assertEquals(0, x.line);
        }
    }

    @Test
    void roundTripsWindowsSpacedAndCjkPaths() {
        for (String p : new String[] {
                "C:\\Users\\me\\My Project\\src\\index.ts",
                "/home/me/项目/文件.ts",
                "D:\\代码\\a b\\主文件.rs"}) {
            assertEquals(p, DeepLink.parse("open", params("file", p)).file);
        }
    }

    @Test
    void returnsWorkspaceVerbatim() {
        assertEquals("C:\\code\\repo a",
                DeepLink.parse("open", params("workspace", "C:\\code\\repo a")).workspace);
    }

    @Test
    void acceptsSafeModesButNeverBypass() {
        assertEquals("default", DeepLink.parse("open", params("mode", "default")).mode);
        assertEquals("acceptEdits", DeepLink.parse("open", params("mode", "acceptEdits")).mode);
        assertEquals("plan", DeepLink.parse("open", params("mode", "plan")).mode);
        assertFalse(DeepLink.SAFE_MODES.contains("bypassPermissions"));
        assertNull(DeepLink.parse("open", params("mode", "bypassPermissions")).mode);
        assertNull(DeepLink.parse("open", params("mode", "garbage")).mode);
    }

    @Test
    void combinesAllParamsInOneLink() {
        DeepLink.Action a = DeepLink.parse("open", params(
                "prompt", "fix the crash",
                "session", "panel-9-x",
                "file", "C:\\r\\a.ts",
                "line", "7",
                "mode", "acceptEdits"));
        assertEquals("fix the crash", a.prompt);
        assertEquals("panel-9-x", a.session);
        assertEquals("C:\\r\\a.ts", a.file);
        assertEquals(7, a.line);
        assertEquals("acceptEdits", a.mode);
    }
}
