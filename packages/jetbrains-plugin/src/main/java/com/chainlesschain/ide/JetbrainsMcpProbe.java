package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Pure helpers for locating IntelliJ IDEA's built-in MCP server (IDEA 2025.2+).
 *
 * IDEA's MCP server has NO discovery lockfile and IDEA does not publish its
 * endpoint in the docs — but it binds a loopback port and answers MCP over
 * Streamable-HTTP. Observed default on this codebase's reference install:
 * {@code http://127.0.0.1:64342/stream}. The actual port can vary per instance,
 * so {@link com.chainlesschain.ide.intellij.JetbrainsMcpLocator} probes the
 * candidates produced here (an MCP {@code initialize} POST) and keeps the first
 * that answers — then injects it as {@code CHAINLESSCHAIN_JETBRAINS_MCP_URL}
 * into the {@code cc agent} it spawns. If nothing answers (IDE &lt; 2025.2 or
 * the MCP server is disabled), nothing is injected and cc does not connect.
 *
 * This class is pure (no IntelliJ SDK, no network) so it is unit-tested by
 * PureLogicSmokeMain. The network probe itself lives in the SDK-bound locator.
 */
public final class JetbrainsMcpProbe {

    private JetbrainsMcpProbe() {}

    /** IDEA 2025.2+ native MCP server port range (observed default 64342). */
    static final int NATIVE_PORT_LO = 64342;
    static final int NATIVE_PORT_HI = 64352;
    /** Built-in webserver range — a fallback in case a build serves MCP there. */
    static final int BUILTIN_PORT_LO = 63342;
    static final int BUILTIN_PORT_HI = 63352;

    /** Endpoint paths to try, in order. {@code /stream} is the confirmed one. */
    static final String[] PATHS = {"/stream", "/sse", "/mcp"};

    /**
     * Ordered, de-duplicated candidate endpoint URLs to probe. The native MCP
     * range (64342…) is tried before the built-in-webserver range (63342…), and
     * {@code /stream} before {@code /sse}/{@code /mcp}. A non-blank
     * {@code preferred} URL (e.g. one a user pinned) is tried first.
     */
    public static List<String> candidateUrls(String preferred) {
        Set<String> out = new LinkedHashSet<>();
        if (preferred != null && !preferred.trim().isEmpty()) {
            out.add(preferred.trim());
        }
        for (String path : PATHS) {
            for (int p = NATIVE_PORT_LO; p <= NATIVE_PORT_HI; p++) {
                out.add("http://127.0.0.1:" + p + path);
            }
            for (int p = BUILTIN_PORT_LO; p <= BUILTIN_PORT_HI; p++) {
                out.add("http://127.0.0.1:" + p + path);
            }
        }
        return new ArrayList<>(out);
    }

    /** Default candidates (no pinned URL). */
    public static List<String> candidateUrls() {
        return candidateUrls(null);
    }

    /**
     * Does an HTTP response look like an MCP {@code initialize} reply? Lenient:
     * a 2xx status whose body (JSON or an SSE {@code data:} line) carries a
     * JSON-RPC envelope or MCP handshake marker. Anything else (404 on a wrong
     * path, a non-MCP server, an error body) is rejected so the locator keeps
     * scanning.
     */
    public static boolean looksLikeMcpResponse(int status, String body) {
        if (status < 200 || status >= 300) return false;
        if (body == null) return false;
        String b = body.toLowerCase();
        return b.contains("jsonrpc")
            || b.contains("\"protocolversion\"")
            || b.contains("protocolversion")
            || b.contains("serverinfo")
            || b.contains("\"result\"");
    }

    /** Tests a single candidate URL — injected so the selection loop is pure. */
    public interface Prober {
        boolean isLive(String url);
    }

    /**
     * First candidate URL the prober reports live, or null. A prober that throws
     * on one candidate (e.g. a transient connect error) is treated as not-live
     * and the scan continues — never aborts the whole scan.
     */
    public static String selectLiveUrl(List<String> candidates, Prober prober) {
        if (candidates == null || prober == null) return null;
        for (String url : candidates) {
            try {
                if (prober.isLive(url)) return url;
            } catch (RuntimeException ignore) {
                // a bad single probe must not kill the scan
            }
        }
        return null;
    }
}
