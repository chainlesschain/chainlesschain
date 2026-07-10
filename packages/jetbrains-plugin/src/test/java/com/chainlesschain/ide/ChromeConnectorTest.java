package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

final class ChromeConnectorTest {

    private static final String STATE_JSON = "{"
            + "\"ok\":true,\"port\":9222,\"tab\":0,"
            + "\"url\":\"http://localhost:5173/\",\"title\":\"My App\","
            + "\"tabs\":[{\"index\":0,\"url\":\"http://localhost:5173/\"},"
            + "         {\"index\":1,\"url\":\"https://example.com\"}],"
            + "\"console\":[{\"type\":\"error\",\"text\":\"Uncaught TypeError\"}],"
            + "\"network\":[{\"kind\":\"http-error\",\"url\":\"http://localhost:5173/api\",\"status\":500}],"
            + "\"html\":\"<html>x</html>\",\"htmlTruncated\":true,"
            + "\"screenshotPath\":\"C:/tmp/shot.png\"}";

    @Test
    void buildsCliArgv() {
        assertEquals(Arrays.asList(
                "browse", "chrome", "status", "--port", "9222", "--json"),
                ChromeConnector.buildStatusArgs(9222));
        assertEquals(Arrays.asList(
                "browse", "chrome", "launch", "--port", "9300",
                "--url", "http://x", "--json"),
                ChromeConnector.buildLaunchArgs(9300, "http://x"));
        assertEquals(Arrays.asList(
                "browse", "chrome", "state", "--port", "9222", "--tab", "0",
                "--watch-ms", "3000", "--reload", "--screenshot", "C:/s.png", "--json"),
                ChromeConnector.buildStateArgs(9222, 0, 3000, true, "C:/s.png"));
    }

    @Test
    void parsesTolerantly() {
        assertNull(ChromeConnector.parseJson("nope"));
        Map<String, Object> parsed = ChromeConnector.parseJson("{\"ok\":false}");
        assertNotNull(parsed);
        assertEquals(Boolean.FALSE, parsed.get("ok"));
    }

    @Test
    void rendersStateReport() {
        Map<String, Object> state = ChromeConnector.parseJson(STATE_JSON);
        String report = ChromeConnector.stateToReport(state);
        assertNotNull(report);
        assertTrue(report.contains("My App"));
        assertTrue(report.contains("http://localhost:5173/"));
        assertTrue(report.contains("DOM 14+ (truncated) chars"));
        assertTrue(report.contains("screenshot: C:/tmp/shot.png"));
        assertTrue(report.contains("[error] Uncaught TypeError"));
        assertTrue(report.contains("-> 500"));
        assertTrue(report.contains("[1] https://example.com"));
        assertTrue(report.contains("cc browse chrome state"));

        // Empty captures are explained, not blank.
        Map<String, Object> empty = ChromeConnector.parseJson(
                "{\"ok\":true,\"tab\":0,\"url\":\"x\",\"title\":\"t\",\"tabs\":[]}");
        String emptyReport = ChromeConnector.stateToReport(empty);
        assertTrue(emptyReport.contains("observed from attach time"));
        assertTrue(emptyReport.contains("no failed or 4xx/5xx"));

        assertNull(ChromeConnector.stateToReport(
                ChromeConnector.parseJson("{\"ok\":false,\"error\":\"x\"}")));
        assertNull(ChromeConnector.stateToReport(null));
    }
}
