package com.chainlesschain.ide;

import java.util.List;

/**
 * Pure HTML renderer for the IDE-bridge dashboard — the Java twin of the VS Code
 * extension's {@code ui/dashboard.js}. Produces a self-contained page (inline CSS,
 * no external assets) with status cards (port / tool calls / connections / errors)
 * and a live tool-call stream, from {@link ActivityLog} data + bridge status.
 *
 * <p>No IntelliJ SDK — pure string logic, so it unit-tests with plain {@code javac}.
 * The glue ({@code DashboardToolWindowFactory}) loads the page into a JCEF browser
 * and re-renders when activity changes. Labels are English (this SDK-free layer
 * can't reach the {@code CcBundle}, matching the other pure layers); the {@code dark}
 * flag lets the glue pass the IDE theme so colors stay readable under Darcula.
 */
public final class DashboardHtml {

    private DashboardHtml() {}

    /** Time formatter seam (glue passes a local HH:mm:ss; tests a stub). */
    public interface TimeFmt {
        String format(long ts);
    }

    public static String page(boolean running, int port, String workspace,
                              ActivityLog.Counts counts, List<ActivityLog.Entry> recent,
                              TimeFmt fmt, boolean dark) {
        String bg = dark ? "#2b2d30" : "#ffffff";
        String fg = dark ? "#dfe1e5" : "#1e1f22";
        String cardBg = dark ? "#3c3f41" : "#f2f3f5";
        String muted = dark ? "#8c8f93" : "#787a7e";
        String border = dark ? "#4a4c4e" : "#e0e1e3";
        String green = dark ? "#5fb85f" : "#3c9a3c";
        String red = dark ? "#e06c6c" : "#c94040";

        StringBuilder sb = new StringBuilder(2048);
        sb.append("<!doctype html><html><head><meta charset=\"utf-8\">");
        sb.append("<style>");
        sb.append("body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:0;padding:16px;")
          .append("background:").append(bg).append(";color:").append(fg).append(";font-size:13px;}");
        sb.append("h1{font-size:15px;margin:0 0 4px;} h3{font-size:12px;margin:18px 0 8px;")
          .append("text-transform:uppercase;letter-spacing:.05em;color:").append(muted).append(";}");
        sb.append(".status{margin-bottom:14px;font-size:12px;} .dot{display:inline-block;width:9px;height:9px;")
          .append("border-radius:50%;margin-right:6px;vertical-align:middle;}");
        sb.append(".on{background:").append(green).append(";} .off{background:").append(muted).append(";}");
        sb.append(".cards{display:flex;gap:10px;flex-wrap:wrap;} .card{background:").append(cardBg)
          .append(";border:1px solid ").append(border).append(";border-radius:8px;padding:10px 14px;min-width:92px;}");
        sb.append(".k{opacity:.7;font-size:10px;text-transform:uppercase;letter-spacing:.04em;}");
        sb.append(".v{font-size:20px;font-weight:600;margin-top:3px;}");
        sb.append(".ws{color:").append(muted).append(";font-size:11px;margin-top:10px;word-break:break-all;}");
        sb.append(".stream{border-top:1px solid ").append(border).append(";}");
        sb.append(".row{display:flex;gap:8px;padding:5px 0;border-bottom:1px solid ").append(border)
          .append(";font-family:ui-monospace,Consolas,monospace;font-size:12px;align-items:baseline;}");
        sb.append(".t{color:").append(muted).append(";white-space:nowrap;} .ok{color:").append(green)
          .append(";} .err{color:").append(red).append(";} .tool{font-weight:600;} .sum{color:")
          .append(muted).append(";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}");
        sb.append(".empty{color:").append(muted).append(";font-style:italic;padding:8px 0;}");
        sb.append("</style></head><body>");

        sb.append("<h1>ChainlessChain IDE bridge</h1>");
        sb.append("<div class=\"status\"><span class=\"dot ").append(running ? "on" : "off")
          .append("\"></span>").append(running ? "Running" : "Stopped").append("</div>");

        sb.append("<div class=\"cards\">");
        sb.append(card("Port", port > 0 ? String.valueOf(port) : "—"));
        sb.append(card("Tool calls", String.valueOf(counts.tool)));
        sb.append(card("Connections", String.valueOf(counts.connect)));
        sb.append(card("Errors", String.valueOf(counts.error)));
        sb.append("</div>");

        if (workspace != null && !workspace.isEmpty()) {
            sb.append("<div class=\"ws\">").append(esc(workspace)).append("</div>");
        }

        sb.append("<h3>Live tool calls</h3><div class=\"stream\">");
        if (recent == null || recent.isEmpty()) {
            sb.append("<div class=\"empty\">No tool calls yet — the agent hasn't used the IDE bridge.</div>");
        } else {
            for (ActivityLog.Entry e : recent) {
                String name = "tool".equals(e.type) ? (e.tool == null ? "?" : e.tool) : "connection";
                sb.append("<div class=\"row\"><span class=\"t\">").append(esc(fmt.format(e.ts)))
                  .append("</span><span class=\"").append(e.ok ? "ok" : "err").append("\">")
                  .append(e.ok ? "✓" : "✗").append("</span><span class=\"tool\">")
                  .append(esc(name)).append("</span><span class=\"sum\">")
                  .append(e.summary == null ? "" : esc(e.summary)).append("</span></div>");
            }
        }
        sb.append("</div></body></html>");
        return sb.toString();
    }

    private static String card(String k, String v) {
        return "<div class=\"card\"><div class=\"k\">" + esc(k) + "</div><div class=\"v\">" + esc(v) + "</div></div>";
    }

    /** HTML-escape text interpolated into the page (tool names, paths, summaries). */
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&': b.append("&amp;"); break;
                case '<': b.append("&lt;"); break;
                case '>': b.append("&gt;"); break;
                case '"': b.append("&quot;"); break;
                case '\'': b.append("&#39;"); break;
                default: b.append(c);
            }
        }
        return b.toString();
    }
}
