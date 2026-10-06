package com.chainlesschain.ide.uitest;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Startup admission must wait for a loader without hiding a broken plugin. */
final class PluginStartupContractTest {
    private static final String CONTRACT = "false|650|60|240000|30000|800|12|2000|5000|20";

    @Test void waitsForThePluginLoaderAfterTheFrameAppears() throws Exception {
        AtomicInteger attempts = new AtomicInteger();
        IdeUiSmokeTest.awaitAutomaticCompletionContract(
                () -> attempts.incrementAndGet() < 3
                        ? IdeUiSmokeTest.PLUGIN_CLASSLOADER_PENDING : CONTRACT, Duration.ofSeconds(2));
        assertEquals(3, attempts.get());
    }

    @Test void failsWithAReadinessDiagnosticIfTheLoaderNeverAppears() {
        AssertionError error = assertThrows(AssertionError.class,
                () -> IdeUiSmokeTest.awaitAutomaticCompletionContract(
                        () -> IdeUiSmokeTest.PLUGIN_CLASSLOADER_PENDING, Duration.ZERO));
        assertTrue(error.getMessage().contains("plugin classloader did not become ready"));
    }

    @Test void propagatesRemoteClassLoadingFailuresWithoutRetry() {
        AtomicInteger attempts = new AtomicInteger();
        RuntimeException missingClass = new RuntimeException("ClassNotFoundException: CcSettings");
        RuntimeException actual = assertThrows(RuntimeException.class,
                () -> IdeUiSmokeTest.awaitAutomaticCompletionContract(() -> {
                    attempts.incrementAndGet();
                    throw missingClass;
                }, Duration.ofSeconds(2)));
        assertSame(missingClass, actual);
        assertEquals(1, attempts.get());
    }

    @Test void rejectsContractDriftImmediatelyAfterStartup() {
        AtomicInteger attempts = new AtomicInteger();
        AssertionError error = assertThrows(AssertionError.class,
                () -> IdeUiSmokeTest.awaitAutomaticCompletionContract(() -> {
                    attempts.incrementAndGet();
                    return CONTRACT.replace("false", "true");
                }, Duration.ofSeconds(2)));
        assertTrue(error.getMessage().contains("contract drifted"));
        assertEquals(1, attempts.get());
    }

    @Test void doesNotTreatAnUnexpectedNullResponseAsStartupReadiness() {
        AssertionError error = assertThrows(AssertionError.class,
                () -> IdeUiSmokeTest.awaitAutomaticCompletionContract(() -> null, Duration.ofSeconds(2)));
        assertTrue(error.getMessage().contains("contract drifted"));
    }
}
