package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class PopupFocusHandoffTest {
    @Test void synchronousFocusSettlementCannotOpenInsideTheOldDispatchOrFocusCallback() {
        ArrayDeque<Runnable> edt = new ArrayDeque<>();
        AtomicBoolean openingInsideFocus = new AtomicBoolean();
        AtomicInteger opens = new AtomicInteger();
        PopupFocusHandoff.schedule(edt::add, callback -> {
            openingInsideFocus.set(true);
            callback.run();
            assertEquals(0, opens.get(), "native focus callback must return before opening");
            openingInsideFocus.set(false);
        }, () -> true, () -> {
            assertFalse(openingInsideFocus.get());
            opens.incrementAndGet();
        }, () -> fail("current popup was rejected"));
        assertEquals(0, opens.get(), "selection/disposal dispatch must return first");
        edt.remove().run();
        assertEquals(0, opens.get());
        edt.remove().run();
        assertEquals(1, opens.get());
        assertTrue(edt.isEmpty());
    }

    @Test void asynchronousFocusRestorationMustCompleteBeforeTheFinalUiDispatch() {
        ArrayDeque<Runnable> edt = new ArrayDeque<>();
        AtomicReference<Runnable> settled = new AtomicReference<>();
        AtomicInteger opens = new AtomicInteger();
        PopupFocusHandoff.schedule(edt::add, settled::set, () -> true,
                opens::incrementAndGet, () -> fail("current popup was rejected"));
        edt.remove().run();
        assertTrue(edt.isEmpty());
        assertEquals(0, opens.get());
        settled.get().run();
        assertEquals(0, opens.get());
        edt.remove().run();
        assertEquals(1, opens.get());
    }

    @Test void staleSelectionBeforeTheFirstDispatchDoesNotRequestFocus() {
        rejectsStaleAt(0);
    }

    @Test void sessionSwitchWhileFocusIsPendingDoesNotQueueAnotherMenu() {
        rejectsStaleAt(1);
    }

    @Test void closingOrStartingATurnAfterFocusSettlesPreventsOpening() {
        rejectsStaleAt(2);
    }

    private static void rejectsStaleAt(int phase) {
        ArrayDeque<Runnable> edt = new ArrayDeque<>();
        AtomicReference<Runnable> settled = new AtomicReference<>();
        AtomicBoolean current = new AtomicBoolean(true);
        AtomicInteger stale = new AtomicInteger();
        PopupFocusHandoff.schedule(edt::add, settled::set, current::get,
                () -> fail("stale context opened a menu"), stale::incrementAndGet);
        if (phase == 0) current.set(false);
        edt.remove().run();
        if (phase == 0) {
            assertNull(settled.get());
        } else {
            if (phase == 1) current.set(false);
            settled.get().run();
            if (phase == 2) {
                current.set(false);
                edt.remove().run();
            }
        }
        assertEquals(1, stale.get());
        assertTrue(edt.isEmpty());
    }
}
