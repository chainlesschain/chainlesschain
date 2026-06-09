package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A tiny dependency-free JSON parser + serializer — just enough for JSON-RPC
 * over the IDE bridge. Objects map to {@link LinkedHashMap}, arrays to
 * {@link List}, strings to String, numbers to Double/Long, booleans to Boolean,
 * null to null. Pure JDK so the bridge core compiles and runs without the
 * IntelliJ SDK (the interop tests drive it with the real CLI MCP client).
 */
public final class MiniJson {
    private MiniJson() {}

    // ── Parse ───────────────────────────────────────────────────────────────
    public static Object parse(String s) {
        Parser p = new Parser(s);
        p.skipWs();
        Object v = p.value();
        p.skipWs();
        if (!p.eof()) throw new IllegalArgumentException("Trailing JSON at " + p.i);
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String s) {
        Object o = parse(s);
        if (!(o instanceof Map)) throw new IllegalArgumentException("Not a JSON object");
        return (Map<String, Object>) o;
    }

    private static final class Parser {
        final String s;
        int i;

        Parser(String s) { this.s = s; }

        boolean eof() { return i >= s.length(); }

        void skipWs() {
            while (i < s.length()) {
                char c = s.charAt(i);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') i++;
                else break;
            }
        }

        Object value() {
            skipWs();
            if (eof()) throw new IllegalArgumentException("Unexpected end of JSON");
            char c = s.charAt(i);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': case 'f': return bool();
                case 'n': literal("null"); return null;
                default: return number();
            }
        }

        Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++; // {
            skipWs();
            if (peek() == '}') { i++; return m; }
            while (true) {
                skipWs();
                String key = string();
                skipWs();
                expect(':');
                Object v = value();
                m.put(key, v);
                skipWs();
                char c = next();
                if (c == '}') break;
                if (c != ',') throw new IllegalArgumentException("Expected , or } at " + i);
            }
            return m;
        }

        List<Object> array() {
            List<Object> a = new ArrayList<>();
            i++; // [
            skipWs();
            if (peek() == ']') { i++; return a; }
            while (true) {
                a.add(value());
                skipWs();
                char c = next();
                if (c == ']') break;
                if (c != ',') throw new IllegalArgumentException("Expected , or ] at " + i);
            }
            return a;
        }

        String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (eof()) throw new IllegalArgumentException("Unterminated string");
                char c = s.charAt(i++);
                if (c == '"') break;
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                            i += 4;
                            break;
                        default: throw new IllegalArgumentException("Bad escape \\" + e);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        Object number() {
            int start = i;
            while (i < s.length()) {
                char c = s.charAt(i);
                if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.'
                        || c == 'e' || c == 'E') i++;
                else break;
            }
            String num = s.substring(start, i);
            if (num.indexOf('.') < 0 && num.indexOf('e') < 0 && num.indexOf('E') < 0) {
                try { return Long.parseLong(num); } catch (NumberFormatException ignore) { /* fall through */ }
            }
            return Double.parseDouble(num);
        }

        Boolean bool() {
            if (peek() == 't') { literal("true"); return Boolean.TRUE; }
            literal("false");
            return Boolean.FALSE;
        }

        void literal(String lit) {
            if (!s.startsWith(lit, i)) throw new IllegalArgumentException("Expected " + lit + " at " + i);
            i += lit.length();
        }

        char peek() { skipWs(); return eof() ? '\0' : s.charAt(i); }
        char next() { return s.charAt(i++); }
        void expect(char c) {
            skipWs();
            if (eof() || s.charAt(i) != c) throw new IllegalArgumentException("Expected '" + c + "' at " + i);
            i++;
        }
    }

    // ── Serialize ───────────────────────────────────────────────────────────
    public static String stringify(Object v) {
        StringBuilder sb = new StringBuilder();
        write(v, sb);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void write(Object v, StringBuilder sb) {
        if (v == null) { sb.append("null"); return; }
        if (v instanceof String) { writeString((String) v, sb); return; }
        if (v instanceof Boolean || v instanceof Integer || v instanceof Long) {
            sb.append(v.toString());
            return;
        }
        if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (d == Math.floor(d) && !Double.isInfinite(d)) sb.append(Long.toString((long) d));
            else sb.append(Double.toString(d));
            return;
        }
        if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) v).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(e.getKey(), sb);
                sb.append(':');
                write(e.getValue(), sb);
            }
            sb.append('}');
            return;
        }
        if (v instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object o : (Iterable<Object>) v) {
                if (!first) sb.append(',');
                first = false;
                write(o, sb);
            }
            sb.append(']');
            return;
        }
        // Fallback: stringify unknown types.
        writeString(String.valueOf(v), sb);
    }

    private static void writeString(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append('"');
    }

    // ── Small typed helpers ────────────────────────────────────────────────
    public static Map<String, Object> obj() { return new LinkedHashMap<>(); }
}
