package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.io.IOException;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class ProcessTreeTerminationTest {
    private static final class Target implements ProcessTreeTermination.Target {
        final long id;
        boolean alive = true;
        boolean stubborn;
        boolean deny;
        boolean enumerationFailure;
        int forceCalls;
        List<ProcessTreeTermination.Target> children = List.of();
        Target(long id) { this.id = id; }
        public long id() { return id; }
        public boolean alive() { return alive; }
        public List<ProcessTreeTermination.Target> descendants() {
            if (enumerationFailure) throw new IllegalStateException("access denied");
            return alive ? children : List.of();
        }
        public void terminate(boolean force) {
            if (force) forceCalls++;
            if (!deny && (!stubborn || force)) alive = false;
        }
    }

    @Test void waitsForTheObservedDescendantAfterTheWrapperExitsAndEscalates() throws Exception {
        Target root = new Target(1); Target child = new Target(2); child.stubborn = true;
        root.children = List.of(child);
        new ProcessTreeTermination(root).await(30, 500);
        assertFalse(root.alive); assertFalse(child.alive); assertTrue(child.forceCalls > 0);
    }

    @Test void failedTerminationRetainsOrphanHandlesForAnExplicitRetry() throws Exception {
        Target root = new Target(1); Target child = new Target(2); child.deny = true;
        root.children = List.of(child);
        ProcessTreeTermination stop = new ProcessTreeTermination(root);
        assertThrows(IOException.class, () -> stop.await(0, 50));
        assertFalse(root.alive); assertTrue(child.alive);
        child.deny = false;
        stop.await(0, 500);
        assertFalse(child.alive);
    }

    @Test void inabilityToInspectTheTreeCannotClaimSuccessfulExit() {
        Target root = new Target(1); root.enumerationFailure = true;
        ProcessTreeTermination stop = new ProcessTreeTermination(root);
        assertThrows(IOException.class, () -> stop.await(0, 50));
        assertTrue(root.forceCalls > 0);
        assertThrows(IOException.class, () -> stop.await(0, 50));
    }
}
