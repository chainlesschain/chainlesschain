package com.chainlesschain.ide;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Minimal MCP server over Streamable HTTP — the JetBrains side of the IDE
 * bridge, byte-compatible with what the CLI MCP client POSTs (initialize /
 * notifications/initialized / tools/list / tools/call), responding
 * application/json with an `Mcp-Session-Id` header. Pure JDK
 * ({@code com.sun.net.httpserver}); no IntelliJ SDK, so it compiles + runs in
 * the interop tests.
 *
 * Unlike Node, the JDK HttpServer holds a response open as long as the handler
 * runs, so a multi-minute blocking `openDiff` needs no timeout tweak — we only
 * use a cached thread pool so a blocked call doesn't stall other requests.
 */
public final class McpServer {

    private static final String PROTOCOL_VERSION = "2024-11-05";
    private static final int MAX_BODY_BYTES = 4 * 1024 * 1024;

    private final List<Tool> tools;
    private final String token;
    private final String path;
    private final String sessionId;
    private final Map<String, Object> serverInfo;

    private HttpServer server;
    private int port = -1;
    private String host = "127.0.0.1";

    public McpServer(List<Tool> tools, String token) {
        this(tools, token, "/mcp", defaultServerInfo());
    }

    public McpServer(List<Tool> tools, String token, String path, Map<String, Object> serverInfo) {
        this.tools = tools;
        this.token = token;
        this.path = path;
        this.serverInfo = serverInfo;
        this.sessionId = randomHex();
    }

    private static Map<String, Object> defaultServerInfo() {
        Map<String, Object> info = new LinkedHashMap<>();
        info.put("name", "chainlesschain-ide-jetbrains");
        info.put("version", "0.1.0");
        return info;
    }

    /** Start listening; returns the bound port. */
    public int start(String host, int port) throws IOException {
        this.host = host;
        server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext(path, this::handle);
        // Concurrency: a blocking openDiff must not stall initialize/tools-list.
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        this.port = server.getAddress().getPort();
        return this.port;
    }

    public void stop() {
        if (server != null) {
            // Shut the executor down too: HttpServer.stop() does NOT stop a
            // user-supplied executor, and cachedThreadPool's non-daemon workers
            // idle for 60s (and pin the plugin classloader on dynamic unload).
            java.util.concurrent.Executor ex = server.getExecutor();
            server.stop(0);
            server = null;
            if (ex instanceof java.util.concurrent.ExecutorService) {
                ((java.util.concurrent.ExecutorService) ex).shutdownNow();
            }
        }
    }

    public int port() { return port; }

    public String url() { return "http://" + host + ":" + port + path; }

    public String sessionId() { return sessionId; }

    // ── HTTP ────────────────────────────────────────────────────────────────
    private void handle(HttpExchange ex) throws IOException {
        try {
            if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
                writeJson(ex, 405, "{\"error\":\"method not allowed\"}");
                return;
            }
            if (token != null) {
                String auth = ex.getRequestHeaders().getFirst("Authorization");
                // Constant-time comparison — String.equals short-circuits on the
                // first differing byte, a (loopback-only, so low-risk) timing oracle.
                byte[] expect = ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
                byte[] got = auth == null ? new byte[0] : auth.getBytes(StandardCharsets.UTF_8);
                if (!java.security.MessageDigest.isEqual(expect, got)) {
                    writeJson(ex, 401, "{\"error\":\"unauthorized\"}");
                    return;
                }
            }
            String body = readBody(ex);
            Map<String, Object> msg;
            try {
                msg = MiniJson.parseObject(body.isEmpty() ? "{}" : body);
            } catch (RuntimeException parseErr) {
                writeJson(ex, 400,
                        "{\"jsonrpc\":\"2.0\",\"id\":null,"
                                + "\"error\":{\"code\":-32700,\"message\":\"Parse error\"}}");
                return;
            }
            Object id = msg.get("id");
            if (id == null) {
                // JSON-RPC notification (e.g. notifications/initialized): ack only.
                ex.getResponseHeaders().add("Mcp-Session-Id", sessionId);
                ex.sendResponseHeaders(202, -1);
                ex.close();
                return;
            }
            Map<String, Object> envelope = new LinkedHashMap<>();
            envelope.put("jsonrpc", "2.0");
            envelope.put("id", id);
            try {
                String method = (String) msg.get("method");
                Object params = msg.get("params");
                envelope.put("result", dispatch(method, asMap(params)));
            } catch (RpcException rpc) {
                envelope.put("error", error(rpc.code, rpc.getMessage()));
            } catch (Exception e) {
                envelope.put("error", error(-32603, e.getMessage() == null ? "Internal error" : e.getMessage()));
            }
            writeJson(ex, 200, MiniJson.stringify(envelope));
        } catch (IOException io) {
            throw io;
        } catch (RuntimeException unexpected) {
            try { writeJson(ex, 500, "{\"error\":\"internal\"}"); } catch (IOException ignore) { /* */ }
        }
    }

    private Object dispatch(String method, Map<String, Object> params) throws Exception {
        if (method == null) throw new RpcException(-32600, "Missing method");
        switch (method) {
            case "initialize": {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("protocolVersion", PROTOCOL_VERSION);
                Map<String, Object> caps = new LinkedHashMap<>();
                caps.put("tools", new LinkedHashMap<>());
                r.put("capabilities", caps);
                r.put("serverInfo", serverInfo);
                return r;
            }
            case "tools/list": {
                List<Object> list = new ArrayList<>();
                for (Tool t : tools) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", t.name());
                    m.put("description", t.description());
                    m.put("inputSchema", t.inputSchema());
                    list.add(m);
                }
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("tools", list);
                return r;
            }
            case "tools/call": {
                String name = params == null ? null : (String) params.get("name");
                Tool tool = null;
                for (Tool t : tools) {
                    if (t.name().equals(name)) { tool = t; break; }
                }
                if (tool == null) throw new RpcException(-32601, "Unknown tool: " + name);
                Map<String, Object> args = asMap(params == null ? null : params.get("arguments"));
                Object out;
                try {
                    out = tool.call(args);
                } catch (Exception toolErr) {
                    // Surface tool failures as an isError result, not a transport error.
                    return errorContent(toolErr.getMessage());
                }
                return toContentResult(out);
            }
            case "resources/list": {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("resources", new ArrayList<>());
                return r;
            }
            case "prompts/list": {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("prompts", new ArrayList<>());
                return r;
            }
            default:
                throw new RpcException(-32601, "Method not found: " + method);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return (o instanceof Map) ? (Map<String, Object>) o : new LinkedHashMap<>();
    }

    private static Map<String, Object> toContentResult(Object out) {
        if (out instanceof Map && ((Map<?, ?>) out).containsKey("content")) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) out;
            return m;
        }
        String text = (out instanceof String) ? (String) out : MiniJson.stringify(out);
        return contentResult(text, false);
    }

    private static Map<String, Object> errorContent(String message) {
        return contentResult("Error: " + (message == null ? "tool error" : message), true);
    }

    private static Map<String, Object> contentResult(String text, boolean isError) {
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("type", "text");
        block.put("text", text);
        List<Object> content = new ArrayList<>();
        content.add(block);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("content", content);
        if (isError) r.put("isError", Boolean.TRUE);
        return r;
    }

    private static Map<String, Object> error(int code, String message) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put("code", (long) code);
        e.put("message", message == null ? "error" : message);
        return e;
    }

    private void writeJson(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.getResponseHeaders().add("Mcp-Session-Id", sessionId);
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static String readBody(HttpExchange ex) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        try (InputStream in = ex.getRequestBody()) {
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BODY_BYTES) throw new IOException("payload too large");
            }
        }
        return new String(buf.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String randomHex() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    /** Internal carrier for a JSON-RPC error code + message. */
    private static final class RpcException extends Exception {
        final int code;
        RpcException(int code, String message) {
            super(message);
            this.code = code;
        }
    }
}
