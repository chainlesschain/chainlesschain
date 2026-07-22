package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class PrStatusTest {
    @Test
    void buildsReadOnlyStatusArgs() {
        assertEquals(Arrays.asList("session", "pr-status", "last", "--json"),
                PrStatus.buildArgs());
    }

    @Test
    void parsesAndRendersLines() {
        Map<String, Object> value = PrStatus.parse(
                "{\"source\":\"gh:org/repo#42\",\"lines\":[\"checks: 2/2\",\"merge: blocked\"]}");
        assertNotNull(value);
        String rendered = PrStatus.render(value);
        assertTrue(rendered.contains("Source: gh:org/repo#42"));
        assertTrue(rendered.contains("- checks: 2/2"));
        assertTrue(rendered.contains("- merge: blocked"));
    }

    @Test
    void malformedOrEmptyOutputFailsClosed() {
        assertNull(PrStatus.parse("not-json"));
        assertNull(PrStatus.parse("{}"));
        assertNull(PrStatus.render(null));
    }
}
