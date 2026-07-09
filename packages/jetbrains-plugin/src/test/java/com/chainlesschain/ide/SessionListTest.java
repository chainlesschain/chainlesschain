package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link SessionList} (/sessions) layer. */
class SessionListTest {

    @Test
    void buildListArgsCapsWithLimit() {
        assertEquals("session list --json -n 30", String.join(" ", SessionList.buildListArgs(30)));
    }

    private static List<SessionList.SessionItem> sample() {
        return SessionList.parseSessionList(
                "[{\"id\":\"s-agent\",\"title\":\"fix bug\",\"updated_at\":\"2026-07-05\",\"_store\":\"jsonl\"},"
                        + "{\"id\":\"s-chat\",\"updatedAt\":\"2026-07-04\"},"
                        + "{\"title\":\"no id -> dropped\"},{\"id\":\"\"}]");
    }

    @Test
    void parseSessionListDropsRowsWithoutId() {
        assertEquals(2, sample().size());
    }

    @Test
    void storeMapsFromJsonlStoreMarker() {
        List<SessionList.SessionItem> items = sample();
        assertEquals("agent", items.get(0).store);
        assertEquals("chat", items.get(1).store);
    }

    @Test
    void updatedAtSupportsBothCaseConventions() {
        List<SessionList.SessionItem> items = sample();
        assertEquals("2026-07-05", items.get(0).updatedAt);
        assertEquals("2026-07-04", items.get(1).updatedAt);
    }

    @Test
    void itemLabelIncludesTitleWhenPresent() {
        assertTrue(SessionList.itemLabel(sample().get(0)).contains("fix bug"));
    }

    @Test
    void itemLabelForUntitledIsIdAndStore() {
        assertTrue(SessionList.itemLabel(sample().get(1)).startsWith("s-chat  ·  chat"));
    }

    @Test
    void parseSessionListToleratesBadInput() {
        assertTrue(SessionList.parseSessionList("nope").isEmpty());
        assertTrue(SessionList.parseSessionList("{}").isEmpty());
    }
}
