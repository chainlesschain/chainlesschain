package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Question recovery identity and non-sensitive field projection; never response authority. */
public final class QuestionDraftContract {
    private QuestionDraftContract() {}
    public record Field(String key, String label, String kind, List<String> choices, boolean option) {}
    private static Object stable(Object value, int depth, int[] budget) throws IOException {
        return stable(value, depth, budget, true);
    }
    private static Object stable(Object value, int depth, int[] budget, boolean sorted) throws IOException {
        if (++budget[0] > 8192 || depth > 20) throw new IOException("Question structure exceeds recovery limits");
        if (value instanceof String text) {
            budget[1] += text.length();
            if (budget[1] > 131072) throw new IOException("Question structure exceeds recovery limits");
            return text;
        }
        if (value instanceof Map<?, ?> map) {
            if (map.size() > 8192) throw new IOException("Too many question fields");
            Map<String, Object> result = sorted ? new TreeMap<>() : new LinkedHashMap<>();
            for (var entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key)) throw new IOException("Invalid question field key");
                stable(key, depth + 1, budget, sorted);
                result.put(key, stable(entry.getValue(), depth + 1, budget, sorted));
            }
            return result;
        }
        if (value instanceof List<?> list) {
            if (list.size() > 8192) throw new IOException("Too many question choices");
            List<Object> result = new ArrayList<>();
            for (Object item : list) result.add(stable(item, depth + 1, budget, sorted));
            return result;
        }
        if (value instanceof Number number && !Double.isFinite(number.doubleValue())) throw new IOException("Invalid question number");
        if (value == null || value instanceof Number || value instanceof Boolean) return value;
        throw new IOException("Invalid question structure");
    }
    public static String identity(String sessionId, Map<String, Object> request) throws IOException {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("sessionId", sessionId);
        for (String key : List.of("id", "binding", "question", "options", "multiSelect", "mode", "blocking", "purpose",
                "contextRevision", "elicitation", "requestedSchema", "server", "url", "elicitationId")) value.put(key, request.get(key));
        byte[] bytes = MiniJson.stringify(stable(value, 0, new int[2])).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 128 * 1024) throw new IOException("Question identity exceeds 128 KiB");
        return ChatDraftStore.hash(bytes);
    }
    public static boolean hasRecoveryBinding(String sessionId, Map<String, Object> request) {
        if (!(request.get("binding") instanceof Map<?, ?> binding)) return false;
        return sessionId != null && !sessionId.isBlank() && Objects.equals(sessionId, binding.get("sessionId"))
                && binding.containsKey("backgroundAgentId")
                && (binding.get("backgroundAgentId") == null || binding.get("backgroundAgentId") instanceof String)
                && binding.get("turnId") instanceof String turn && !turn.isBlank()
                && binding.get("toolUseId") instanceof String tool && !tool.isBlank()
                && binding.get("sequence") instanceof Number n && n.doubleValue() == n.longValue()
                && n.longValue() > 0 && n.longValue() <= 9_007_199_254_740_991L;
    }
    /** Bound and detach caller-owned nested objects before retaining a live request. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> snapshot(Map<String, Object> request) throws IOException {
        Object copy = stable(request, 0, new int[2], false);
        if (MiniJson.stringify(copy).getBytes(StandardCharsets.UTF_8).length > 128 * 1024)
            throw new IOException("Question exceeds 128 KiB");
        return (Map<String, Object>) freeze(copy);
    }
    private static Object freeze(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> result.put((String) key, freeze(item)));
            return Collections.unmodifiableMap(result);
        }
        if (value instanceof List<?> list) return Collections.unmodifiableList(list.stream().map(QuestionDraftContract::freeze).toList());
        return value;
    }
    public static String fieldKey(String name) { return MiniJson.stringify(List.of(name)); }
    public static String optionKey(String name, String value) { return MiniJson.stringify(List.of(name, value)); }
    private static boolean secret(Map<?, ?> properties, String name) {
        return properties.get(name) instanceof Map<?, ?> field
                && (Boolean.TRUE.equals(field.get("writeOnly")) || "password".equals(field.get("format")));
    }
    public static List<Field> fields(Map<String, Object> request) throws IOException {
        if ("url".equals(request.get("mode"))) return List.of();
        List<Field> result = new ArrayList<>();
        if (Boolean.TRUE.equals(request.get("elicitation"))) {
            ElicitationSchema.Model model = ElicitationSchema.compile(request.get("requestedSchema"));
            if (!model.supported) return List.of(); // Unknown JSON schemas may contain secrets.
            Map<?, ?> schema = (Map<?, ?>) request.get("requestedSchema");
            Map<?, ?> properties = schema.get("properties") instanceof Map<?, ?> p ? p : Map.of();
            for (ElicitationSchema.Field field : model.fields) {
                if (secret(properties, field.name)) continue;
                String key = fieldKey(field.name);
                if (field.kind == ElicitationSchema.Kind.MULTI_SELECT) {
                    for (var option : field.options) result.add(new Field(optionKey(field.name, option.value), field.title + ": " + option.label, "boolean", List.of(), true));
                } else if (field.kind == ElicitationSchema.Kind.SINGLE_SELECT) {
                    result.add(new Field(key, field.title, "select", field.options.stream().map(o -> o.value).toList(), false));
                } else result.add(new Field(key, field.title, field.kind == ElicitationSchema.Kind.BOOLEAN ? "boolean" : "text", List.of(), false));
            }
        } else {
            List<String> options = optionLabels(request);
            if (options.isEmpty()) result.add(new Field("answer", "Answer", "text", List.of(), false));
            else if (Boolean.TRUE.equals(request.get("multiSelect"))) {
                for (int i = 0; i < options.size(); i++) result.add(new Field("option-" + i, options.get(i), "boolean", List.of(), true));
            } else result.add(new Field("answer", "Answer", "select", options, false));
        }
        if (result.size() > 128) throw new IOException("Question draft exceeds 128 fields");
        return List.copyOf(result);
    }
    public static List<String> optionLabels(Map<String, Object> request) {
        List<String> labels = new ArrayList<>();
        if (request.get("options") instanceof List<?> list) for (Object value : list) {
            if (value instanceof Map<?, ?> map && map.get("label") != null) labels.add(String.valueOf(map.get("label")));
            else labels.add(String.valueOf(value));
        }
        return labels;
    }
    public static Map<String, Object> normalize(List<Field> fields, Map<String, Object> values) throws IOException {
        if (values.size() > 128 || fields.size() > 128) throw new IOException("Question draft exceeds 128 fields");
        Map<String, Object> result = new LinkedHashMap<>();
        for (Field field : fields) if (values.containsKey(field.key())) {
            Object value = values.get(field.key());
            if (field.kind().equals("boolean") ? !(value instanceof Boolean) : !(value instanceof String))
                throw new IOException("Invalid question draft value");
            if (value instanceof String text) {
                if (text.length() > 32768) throw new IOException("Question draft field exceeds 32K characters");
                if (field.kind().equals("select") && !text.isEmpty() && !field.choices().contains(text))
                    throw new IOException("Question draft choice is unavailable");
            }
            result.put(field.key(), value);
        }
        if (MiniJson.stringify(result).getBytes(StandardCharsets.UTF_8).length > 65536) throw new IOException("Question draft exceeds 64 KiB");
        return Collections.unmodifiableMap(result);
    }
    public static String text(List<Field> fields, Map<String, Object> values) {
        StringBuilder result = new StringBuilder();
        for (Field field : fields) if (values.containsKey(field.key())) {
            Object value = values.get(field.key());
            if ("".equals(value) || (field.option() && !Boolean.TRUE.equals(value))) continue;
            if (!result.isEmpty()) result.append('\n');
            result.append(field.label()).append(": ").append(value);
            if (result.length() > 65536) return result.substring(0, 65536);
        }
        return result.toString();
    }
}
