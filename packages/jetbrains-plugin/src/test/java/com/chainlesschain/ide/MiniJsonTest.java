package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link MiniJson} parser + serializer. */
class MiniJsonTest {

    private static String repeat(char c, int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) b.append(c);
        return b.toString();
    }

    @Test
    void nestingAtTheCapParses() {
        String ok = repeat('[', 512) + repeat(']', 512);
        // Should not throw.
        MiniJson.parse(ok);
    }

    @Test
    void arrayOnePastCapThrowsCatchableIllegalArgument() {
        String deep = repeat('[', 513) + repeat(']', 513);
        assertThrows(IllegalArgumentException.class, () -> MiniJson.parse(deep));
    }

    @Test
    void objectPastCapThrowsCatchableIllegalArgument() {
        StringBuilder deepObj = new StringBuilder();
        for (int i = 0; i < 600; i++) deepObj.append("{\"a\":");
        deepObj.append("1");
        for (int i = 0; i < 600; i++) deepObj.append('}');
        assertThrows(IllegalArgumentException.class, () -> MiniJson.parse(deepObj.toString()));
    }

    @Test
    void wideFlatSiblingsParseBecauseDepthResets() {
        StringBuilder wide = new StringBuilder("[");
        for (int i = 0; i < 700; i++) wide.append(i > 0 ? ",{}" : "{}");
        wide.append("]");
        // 700 flat sibling objects: nesting depth stays shallow → parses.
        MiniJson.parse(wide.toString());
    }

    @Test
    void stringifyNaNAndInfinityBecomeNull() {
        Map<String, Object> nan = MiniJson.obj();
        nan.put("v", Double.NaN);
        assertEquals("{\"v\":null}", MiniJson.stringify(nan));

        Map<String, Object> inf = MiniJson.obj();
        inf.put("v", Double.POSITIVE_INFINITY);
        assertEquals("{\"v\":null}", MiniJson.stringify(inf));
    }

    @Test
    void stringifyFiniteDoublesRenderWholeNumbersWithoutDecimal() {
        Map<String, Object> fin = MiniJson.obj();
        fin.put("i", 3.0);
        fin.put("f", 2.5);
        assertEquals("{\"i\":3,\"f\":2.5}", MiniJson.stringify(fin));
    }

    @Test
    void parseIntegerYieldsLongAndDecimalYieldsDouble() {
        assertEquals(Long.valueOf(123L), MiniJson.parse("123"));
        assertEquals(Double.valueOf(1.5), MiniJson.parse("1.5"));
    }

    @Test
    void parseObjectExposesTypedValues() {
        Map<String, Object> m = MiniJson.parseObject("{\"a\":1,\"b\":\"x\",\"c\":true,\"d\":null}");
        assertEquals(Long.valueOf(1L), m.get("a"));
        assertEquals("x", m.get("b"));
        assertEquals(Boolean.TRUE, m.get("c"));
        assertTrue(m.containsKey("d"));
        assertEquals(null, m.get("d"));
    }

    @Test
    void parseArrayYieldsList() {
        Object v = MiniJson.parse("[1,2,3]");
        assertTrue(v instanceof List);
        assertEquals(3, ((List<?>) v).size());
    }

    @Test
    void parseTrailingContentThrows() {
        assertThrows(IllegalArgumentException.class, () -> MiniJson.parse("{} junk"));
    }

    @Test
    void stringifyEscapesSpecialCharacters() {
        Map<String, Object> m = MiniJson.obj();
        m.put("q", "a\"b\\c\n");
        assertEquals("{\"q\":\"a\\\"b\\\\c\\n\"}", MiniJson.stringify(m));
    }
}
