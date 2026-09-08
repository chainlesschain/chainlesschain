package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class EvolutionWorkbenchSessionTest {
    @Test
    void permitsOnlyOneOperationAndRejectsOldCompletionAfterRetry() {
        EvolutionWorkbenchSession session = new EvolutionWorkbenchSession();
        long review = session.begin();
        assertTrue(review > 0);
        assertEquals(0, session.begin());
        assertFalse(session.canBegin());
        assertTrue(session.finish(review));
        long refresh = session.begin();
        assertNotEquals(review, refresh);
        assertFalse(session.finish(review));
        assertTrue(session.isCurrent(refresh));
        assertFalse(session.canBegin());
        assertTrue(session.finish(refresh));
        assertTrue(session.canBegin());
    }

    @Test
    void closingPreventsLateUiPublicationAndFurtherPageReads() {
        EvolutionWorkbenchSession session = new EvolutionWorkbenchSession();
        long operation = session.begin();
        session.close();
        assertFalse(session.isCurrent(operation));
        assertFalse(session.finish(operation));
        assertFalse(session.canBegin());
        assertEquals(0, session.begin());
    }

    @Test
    void concurrentActionsCannotDispatchTwoMutations() throws Exception {
        EvolutionWorkbenchSession session = new EvolutionWorkbenchSession();
        CountDownLatch start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(8)) {
            ArrayList<Future<Long>> attempts = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                attempts.add(executor.submit(() -> {
                    start.await();
                    return session.begin();
                }));
            }
            start.countDown();
            int dispatched = 0;
            for (Future<Long> attempt : attempts) {
                if (attempt.get() != 0) dispatched++;
            }
            assertEquals(1, dispatched);
        }
    }
}
