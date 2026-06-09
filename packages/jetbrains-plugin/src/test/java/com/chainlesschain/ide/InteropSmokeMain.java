package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Standalone harness: start the JetBrains-side MCP server with a fake editor
 * facade so the real CLI MCP client (Node) can drive it over HTTP. Proves the
 * Java server speaks the exact same protocol as the VS Code (Node) one — i.e.
 * "CLI 侧零改动" across editors. Prints `PORT=`, `TOKEN=`, then `READY`, then
 * stays up until the JVM is killed.
 *
 * Not part of the shipped plugin — it's a cross-language interop probe.
 */
public final class InteropSmokeMain {
    public static void main(String[] args) throws Exception {
        EditorFacade fake = new EditorFacade() {
            @Override public Map<String, Object> getSelection() {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("file", "/abs/ws/A.java");
                m.put("languageId", "java");
                m.put("text", "foo()");
                return m;
            }

            @Override public List<Map<String, Object>> getDiagnostics(String path) {
                List<Map<String, Object>> l = new ArrayList<>();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("file", "/abs/ws/A.java");
                d.put("severity", "error");
                d.put("message", "boom");
                d.put("line", 3L);
                l.add(d);
                return l;
            }

            @Override public List<Map<String, Object>> getOpenEditors() {
                return new ArrayList<>();
            }

            @Override public Map<String, Object> openDiff(String path, String modifiedText,
                                                          String originalText, String title) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("outcome", "accepted");
                r.put("path", path);
                r.put("finalText", modifiedText);
                return r;
            }
        };

        String token = "smoke-jb-token";
        McpServer server = new McpServer(IdeTools.build(fake), token);
        int port = server.start("127.0.0.1", 0);
        System.out.println("PORT=" + port);
        System.out.println("TOKEN=" + token);
        System.out.println("READY");
        System.out.flush();
        Thread.sleep(60_000);
        server.stop();
    }
}
