package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link MarkdownLite} tokenizer. */
class MarkdownLiteTest {

    @Test
    void plainTextYieldsOneTextSpan() {
        assertEquals(
                Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "hello world")),
                MarkdownLite.parse("hello world"));
    }

    @Test
    void inlineCodeIsTokenized() {
        assertEquals(
                Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "run "),
                        new MarkdownLite.Span(MarkdownLite.Kind.CODE, "npm test"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " now")),
                MarkdownLite.parse("run `npm test` now"));
    }

    @Test
    void boldIsTokenized() {
        assertEquals(
                Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a "),
                        new MarkdownLite.Span(MarkdownLite.Kind.BOLD, "bold"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " b")),
                MarkdownLite.parse("a **bold** b"));
    }

    @Test
    void fencedCodeDropsLanguageTagKeepsBody() {
        List<MarkdownLite.Span> fenced = MarkdownLite.parse("see:\n```java\nint x = 1;\n```\ndone");
        assertEquals(3, fenced.size());
        assertEquals(MarkdownLite.Kind.CODE, fenced.get(1).kind);
        assertEquals("int x = 1;\n", fenced.get(1).text);
    }

    @Test
    void unclosedInlineCodeDegradesToPlain() {
        assertEquals(
                Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a `b c")),
                MarkdownLite.parse("a `b c"));
    }

    @Test
    void unclosedBoldDegradesToPlain() {
        assertEquals(
                Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "x **y")),
                MarkdownLite.parse("x **y"));
    }

    @Test
    void spansLoseOnlyTheMarkers() {
        String md = "use `f()` and **g** in ```py\ncode\n```";
        StringBuilder rebuilt = new StringBuilder();
        for (MarkdownLite.Span s : MarkdownLite.parse(md)) rebuilt.append(s.text);
        assertEquals("use f() and g in code\n", rebuilt.toString());
    }

    @Test
    void emptyAndNullYieldNoSpans() {
        assertTrue(MarkdownLite.parse("").isEmpty());
        assertTrue(MarkdownLite.parse(null).isEmpty());
    }
}
