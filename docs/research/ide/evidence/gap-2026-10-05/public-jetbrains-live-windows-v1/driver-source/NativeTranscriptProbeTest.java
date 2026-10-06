package com.chainlesschain.ide.uitest;

import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Tests the test-only admission probe without starting an IDE or a CLI. */
final class NativeTranscriptProbeTest {
    public static final class Identity {
        public final String output;
        public final String version;
        private final boolean current;

        Identity(String output, String version, boolean current) {
            this.output = output;
            this.version = version;
            this.current = current;
        }

        public boolean isCurrent() { return current; }
    }

    @Test void acceptsOnlyTheCurrentValidatedFixtureIdentity() throws Exception {
        assertTrue(NativeTranscriptProbe.fixtureIdentityObserved(
                new Identity("0.999.0-ui-journey\n", "0.999.0-ui-journey", true)));
        assertFalse(NativeTranscriptProbe.fixtureIdentityObserved(
                new Identity("0.999.0-ui-journey", "0.999.0-ui-journey", false)));
        assertFalse(NativeTranscriptProbe.fixtureIdentityObserved(
                new Identity("0.999.0-ui-journey", null, true)));
        assertFalse(NativeTranscriptProbe.fixtureIdentityObserved(
                new Identity("gcc 15.2.0", null, true)));
        assertFalse(NativeTranscriptProbe.fixtureIdentityObserved(
                new Identity("0.166.89", "0.166.89", true)));
    }

    @Test void rejectsEdtInvocationBeforeAttemptingAnyCliProbe() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            IllegalStateException error = assertThrows(IllegalStateException.class,
                    () -> NativeTranscriptProbe.readiness(new Object()));
            assertEquals("CLI identity must be observed off EDT", error.getMessage());
        });
    }
}
