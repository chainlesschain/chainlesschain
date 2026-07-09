package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link PreviewDetect} layer. */
class PreviewDetectTest {

    @Test
    void pickDevScriptPrefersConventionalNameByPriority() {
        Map<String, String> s1 = new LinkedHashMap<>();
        s1.put("build", "vite build");
        s1.put("dev", "vite");
        s1.put("start", "node .");
        PreviewDetect.DevScript d1 = PreviewDetect.pickDevScript(s1);
        assertEquals("dev", d1.script);
        assertEquals("vite", d1.command);
    }

    @Test
    void pickDevScriptFallsBackToRecognizedDevTool() {
        Map<String, String> s2 = new LinkedHashMap<>();
        s2.put("ui:watch", "vite --host");
        s2.put("build", "tsc");
        PreviewDetect.DevScript d2 = PreviewDetect.pickDevScript(s2);
        assertEquals("ui:watch", d2.script);
    }

    @Test
    void pickDevScriptReturnsNullWhenNothingFits() {
        Map<String, String> s3 = new LinkedHashMap<>();
        s3.put("build", "vite build");
        s3.put("test", "vitest");
        assertNull(PreviewDetect.pickDevScript(s3));
        assertNull(PreviewDetect.pickDevScript(new LinkedHashMap<>()));
        assertNull(PreviewDetect.pickDevScript(null));
    }

    @Test
    void detectServerUrlParsesViteBanner() {
        assertEquals("http://localhost:5173/",
                PreviewDetect.detectServerUrl("  Local:   http://localhost:5173/"));
    }

    @Test
    void detectServerUrlParsesNextBanner() {
        assertEquals("http://localhost:3000",
                PreviewDetect.detectServerUrl("ready - started server on http://localhost:3000"));
    }
    @Test
    void detectServerUrlStripsAnsiColors() {
        String esc = String.valueOf((char) 27); // ANSI escape
        String line =
                esc + "[32m  Local:" + esc + "[39m " + esc + "[36mhttp://localhost:4321/" + esc + "[39m";
        assertEquals("http://localhost:4321/", PreviewDetect.detectServerUrl(line));
    }

    @Test
    void detectServerUrlTrimsTrailingPunctuation() {
        assertEquals("http://localhost:3000",
                PreviewDetect.detectServerUrl("see (http://localhost:3000)."));
    }

    @Test
    void detectServerUrlRewritesWildcardHostToLocalhost() {
        assertEquals("http://localhost:5000/",
                PreviewDetect.detectServerUrl("Network: http://0.0.0.0:5000/"));
    }

    @Test
    void detectServerUrlReturnsNullForNonMatches() {
        assertNull(PreviewDetect.detectServerUrl("building for production..."));
        assertNull(PreviewDetect.detectServerUrl("see https://example.com/docs"));
        assertNull(PreviewDetect.detectServerUrl(null));
    }

    @Test
    void detectServerUrlInTextReturnsFirstMatch() {
        String out = "VITE v5.0  ready\n\n  ➜  Local:   http://localhost:5173/\n"
                + "  ➜  Network: http://192.168.1.10:5173/";
        assertEquals("http://localhost:5173/", PreviewDetect.detectServerUrlInText(out));
    }

    @Test
    void detectServerUrlInTextReturnsNullWhenNoUrl() {
        assertNull(PreviewDetect.detectServerUrlInText("compiling...\nstill..."));
    }
}
