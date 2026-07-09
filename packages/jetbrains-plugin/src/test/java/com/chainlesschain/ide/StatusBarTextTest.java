package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link StatusBarText} layer. */
class StatusBarTextTest {

    @Test
    void labelRunningDefaultShowsPortOnly() {
        assertEquals("CC :63412", StatusBarText.label(63412, "default"));
    }

    @Test
    void labelRunningWithElevatedModesAppendsMarker() {
        assertEquals("CC :63412 ✓auto", StatusBarText.label(63412, "acceptEdits"));
        assertEquals("CC :63412 ⚠bypass", StatusBarText.label(63412, "bypassPermissions"));
    }

    @Test
    void labelStoppedWhenPortNonPositive() {
        assertEquals("CC off", StatusBarText.label(-1, "default"));
        assertEquals("CC off", StatusBarText.label(0, "default"));
    }

    @Test
    void labelStoppedStillSurfacesElevatedMode() {
        assertEquals("CC off ⚠bypass", StatusBarText.label(-1, "bypassPermissions"));
    }

    @Test
    void modeSuffixIsQuietForDefaultNullAndUnknown() {
        assertEquals("", StatusBarText.modeSuffix("default"));
        assertEquals("", StatusBarText.modeSuffix(null));
        assertEquals("", StatusBarText.modeSuffix("plan"));
    }

    @Test
    void tooltipRunningBypassHasEndpointLoudFlagRestoreHintAndClickLast() {
        String tip = StatusBarText.tooltip(63412, "bypassPermissions");
        assertTrue(tip.contains("127.0.0.1:63412"), tip);
        assertTrue(tip.contains("BYPASSED"), tip);
        assertTrue(tip.contains("/normal"), tip);
        assertTrue(tip.endsWith("Click for bridge status"), tip);
    }

    @Test
    void tooltipStoppedDefaultDescribesStoppedAndNormalMode() {
        String tipOff = StatusBarText.tooltip(-1, "default");
        assertTrue(tipOff.contains("stopped"), tipOff);
        assertTrue(tipOff.contains("confirm each step"), tipOff);
    }
}
