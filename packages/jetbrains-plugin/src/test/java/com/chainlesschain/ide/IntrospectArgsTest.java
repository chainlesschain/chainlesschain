package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link IntrospectArgs} builder + parser. */
class IntrospectArgsTest {

    @Test
    void contextBuildAddsJsonFlag() {
        assertEquals(Arrays.asList("context", "s1", "--json"),
                IntrospectArgs.build("context", "s1", null, null, true));
    }

    @Test
    void contextBuildIncludesModelProviderJsonInOrder() {
        assertEquals(Arrays.asList("context", "s1", "--model", "m", "--provider", "p", "--json"),
                IntrospectArgs.build("context", "s1", "m", "p", true));
    }

    @Test
    void costBuildIgnoresJsonFlag() {
        assertEquals(Arrays.asList("cost", "s1"),
                IntrospectArgs.build("cost", "s1", null, null, true));
    }

    @Test
    void parseContextStatusDerivesPercentAndNoOverflow() {
        IntrospectArgs.ContextStatus ok = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":200000,\"totalTokens\":12000}");
        assertNotNull(ok);
        assertEquals(12000L, ok.total);
        assertEquals(200000L, ok.window);
        assertEquals(6, ok.pct);
        assertFalse(ok.overflow);
    }

    @Test
    void parseContextStatusFlagsOverflowByRatio() {
        IntrospectArgs.ContextStatus over = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":1500}");
        assertNotNull(over);
        assertEquals(150, over.pct);
        assertTrue(over.overflow);
    }

    @Test
    void parseContextStatusFlagsOverflowByOverflowsField() {
        IntrospectArgs.ContextStatus flag = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":10,\"overflows\":true}");
        assertNotNull(flag);
        assertTrue(flag.overflow);
    }

    @Test
    void parseContextStatusReturnsNullForBadOrIncompleteInput() {
        assertNull(IntrospectArgs.parseContextStatus("not json"));
        assertNull(IntrospectArgs.parseContextStatus(""));
        assertNull(IntrospectArgs.parseContextStatus("{\"totalTokens\":5}"));
        assertNull(IntrospectArgs.parseContextStatus("{\"contextWindow\":0,\"totalTokens\":5}"));
    }
}
