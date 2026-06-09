package com.chainlesschain.ide;

import java.util.Map;

/** One MCP tool the bridge exposes (server `ide` → mcp__ide__&lt;name&gt;). */
public interface Tool {
    String name();

    String description();

    /** JSON-schema object describing the arguments. */
    Map<String, Object> inputSchema();

    /**
     * Run the tool. Return plain data (Map/List/String) — the server wraps it
     * into an MCP `content` result — or a Map already shaped as
     * {@code {content:[...], isError?}}.
     */
    Object call(Map<String, Object> args) throws Exception;
}
