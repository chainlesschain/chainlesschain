package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link ConversationManager} layer. */
class ConversationManagerTest {

    @Test
    void firstConversationGetsStableIdTitleAndBecomesActive() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        assertEquals("conv-1", a.id);
        assertEquals("Chat 1", a.title);
        assertEquals("conv-1", m.activeId());
    }

    @Test
    void createWithTitleActivatesTheNewConversation() {
        ConversationManager m = new ConversationManager();
        m.create();
        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        assertEquals("Bugfix", b.title);
        assertEquals("conv-2", m.activeId());
    }

    @Test
    void createWithActivateFalseKeepsCurrentActive() {
        ConversationManager m = new ConversationManager();
        m.create();
        m.create("Bugfix", null, true);
        ConversationManager.Conversation c = m.create(null, null, false);
        assertEquals("conv-3", c.id);
        assertEquals("conv-2", m.activeId());
        assertEquals(3, m.count());
    }

    @Test
    void listReflectsOrderActiveFlagAndSessionPresence() {
        ConversationManager m = new ConversationManager();
        m.create();
        m.create("Bugfix", null, true);
        ConversationManager.Conversation c = m.create(null, null, false);
        List<ConversationManager.TabInfo> tabs = m.list();
        assertEquals(3, tabs.size());
        assertTrue(tabs.get(1).active);
        m.setSession(c.id, new Object());
        assertTrue(m.list().get(2).hasSession);
    }

    @Test
    void switchToUnknownReturnsNullAndLeavesActiveUnchanged() {
        ConversationManager m = new ConversationManager();
        m.create();
        m.create("Bugfix", null, true);
        assertNull(m.switchTo("nope"));
        assertEquals("conv-2", m.activeId());
    }

    @Test
    void closingActiveMiddleActivatesRightNeighbor() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        ConversationManager.Conversation c = m.create(null, null, false);
        m.switchTo(b.id);
        ConversationManager.CloseResult r = m.close(b.id);
        assertTrue(r.closed);
        assertEquals(c.id, m.activeId());
    }

    @Test
    void closingActiveLastActivatesLeftNeighborThenNullOnFinalClose() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        ConversationManager.Conversation c = m.create(null, null, false);
        m.close(b.id);
        m.switchTo(c.id);
        m.close(c.id);
        assertEquals(a.id, m.activeId());
        ConversationManager.CloseResult last = m.close(a.id);
        assertTrue(last.closed);
        assertNull(m.activeId());
        assertEquals(0, m.count());
    }

    @Test
    void idsAreNotReusedAfterCloses() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        ConversationManager.Conversation c = m.create(null, null, false);
        m.close(b.id);
        m.close(c.id);
        m.close(a.id);
        ConversationManager.Conversation d = m.create();
        assertEquals("conv-4", d.id);
        assertEquals("Chat 4", d.title);
    }

    @Test
    void setSessionIdNormalizesEmptyToNull() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation x = m.create();
        assertEquals("sess", m.setSessionId(x.id, "sess").sessionId);
        assertNull(m.setSessionId(x.id, "").sessionId);
    }

    @Test
    void allSessionsReturnsOnlyLiveHandlesInOrder() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation x = m.create();
        m.create();
        ConversationManager.Conversation z = m.create();
        Object hx = new Object();
        Object hz = new Object();
        m.setSession(x.id, hx);
        m.setSession(z.id, hz);
        assertEquals(Arrays.asList(hx, hz), m.allSessions());
    }

    @Test
    void setTitleIgnoresBlankTitle() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation x = m.create();
        assertEquals("Renamed", m.setTitle(x.id, "Renamed").title);
        assertEquals("Renamed", m.setTitle(x.id, "").title);
    }

    @Test
    void approvalModeDefaultsThenSetModeNormalizesBlankToDefault() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation x = m.create();
        assertEquals("default", x.mode);
        assertEquals("acceptEdits", m.setMode(x.id, "acceptEdits").mode);
        assertEquals("default", m.setMode(x.id, "").mode);
    }

    @Test
    void thinkingDefaultsThenSetThinkingNormalizesBlankToOff() {
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation x = m.create();
        assertEquals("off", x.thinking);
        assertEquals("ultra", m.setThinking(x.id, "ultra").thinking);
        assertEquals("off", m.setThinking(x.id, "").thinking);
    }

    @Test
    void closingUnknownIdReportsNotClosed() {
        ConversationManager m = new ConversationManager();
        m.create();
        ConversationManager.CloseResult r = m.close("missing");
        assertFalse(r.closed);
        assertNull(r.conv);
    }
}
