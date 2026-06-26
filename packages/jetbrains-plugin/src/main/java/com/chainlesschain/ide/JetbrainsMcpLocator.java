package com.chainlesschain.ide;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Locates IntelliJ IDEA's built-in MCP server (IDEA 2025.2+) by probing the
 * candidate endpoints from {@link JetbrainsMcpProbe} with an MCP {@code
 * initialize} POST, and caches the first that answers. The plugin injects the
 * result as {@code CHAINLESSCHAIN_JETBRAINS_MCP_URL} into the {@code cc agent}
 * it spawns (see ConversationView); cc then connects it as server {@code idea}.
 *
 * If nothing answers (IDE &lt; 2025.2 or the MCP server is disabled) the cache
 * stays null and nothing is injected — cc does not connect (the product rule:
 * unsupported = don't connect).
 *
 * Pure JDK (java.net.http + a daemon thread) — NO IntelliJ SDK import — so it
 * compiles/type-checks with plain {@code javac}. The blocking probe runs off
 * the caller's thread via {@link #refreshAsync()}; callers read the cached
 * value with {@link #cachedUrl()} and never block the UI thread. The selection
 * loop and URL/response logic are unit-tested in PureLogicSmokeMain via
 * {@link JetbrainsMcpProbe}.
 */
public final class JetbrainsMcpLocator {

    private JetbrainsMcpLocator() {}

    /** Re-probe at most this often — the MCP server can be toggled on after IDE start. */
    private static final long TTL_MS = 60_000L;
    private static final Duration CONNECT_TIMEOUT = Duration.ofMillis(400);
    private static final Duration REQUEST_TIMEOUT = Duration.ofMillis(700);

    private static final String INIT_BODY =
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{"
        + "\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},"
        + "\"clientInfo\":{\"name\":\"chainlesschain-jetbrains-plugin\",\"version\":\"1\"}}}";

    private static volatile String cachedUrl = null;
    private static volatile long lastProbeMs = 0L;
    private static final AtomicBoolean probing = new AtomicBoolean(false);

    private static final HttpClient CLIENT = HttpClient.newBuilder()
        .connectTimeout(CONNECT_TIMEOUT)
        .version(HttpClient.Version.HTTP_1_1)
        .build();

    /** The last located endpoint, or null if none found yet / not supported. */
    public static String cachedUrl() {
        return cachedUrl;
    }

    /**
     * Kick off a background probe if the cache is stale and one isn't already
     * running. Non-blocking — returns immediately. Safe to call from the EDT.
     */
    public static void refreshAsync() {
        long now = System.currentTimeMillis();
        if (now - lastProbeMs < TTL_MS && cachedUrl != null) return;
        if (!probing.compareAndSet(false, true)) return;
        Thread t = new Thread(() -> {
            try {
                cachedUrl = probeOnce();
                lastProbeMs = System.currentTimeMillis();
            } finally {
                probing.set(false);
            }
        }, "chainlesschain-jetbrains-mcp-locator");
        t.setDaemon(true);
        t.start();
    }

    /**
     * Blocking probe of all candidates; returns the first live URL or null.
     * Exposed for a warm-up call site that already runs off the EDT.
     */
    public static String probeOnce() {
        List<String> candidates = JetbrainsMcpProbe.candidateUrls(cachedUrl);
        return JetbrainsMcpProbe.selectLiveUrl(candidates, JetbrainsMcpLocator::isLive);
    }

    /** One MCP initialize POST; true iff it looks like a real MCP server. */
    private static boolean isLive(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString(INIT_BODY, StandardCharsets.UTF_8))
                .build();
            HttpResponse<String> resp = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
            String body = resp.body();
            if (body != null && body.length() > 4096) body = body.substring(0, 4096);
            return JetbrainsMcpProbe.looksLikeMcpResponse(resp.statusCode(), body);
        } catch (Exception e) {
            return false; // connection refused / timeout / etc. → not live, keep scanning
        }
    }
}
