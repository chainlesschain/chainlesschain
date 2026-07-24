package com.chainlesschain.ide;

import java.net.URI;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure-JDK adapter for the restricted MCP form-elicitation schema vocabulary.
 *
 * <p>The canonical executable core for JS clients and the cross-language
 * fixture live in {@code packages/elicitation-schema}. This native adapter is
 * intentionally limited to the same flat form subset; it is not a Draft
 * 2020-12 validator and does not resolve {@code $ref}.
 */
public final class ElicitationSchema {
    public static final String VOCABULARY_VERSION = "mcp-restricted-form-v1";

    private static final Set<String> STRING_FORMATS =
            Set.of("email", "uri", "date", "date-time");
    private static final Pattern EMAIL =
            Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");

    private ElicitationSchema() {}

    public enum Kind {
        TEXT("text"),
        NUMBER("number"),
        INTEGER("integer"),
        BOOLEAN("boolean"),
        SINGLE_SELECT("single-select"),
        MULTI_SELECT("multi-select");

        public final String wireName;

        Kind(String wireName) {
            this.wireName = wireName;
        }
    }

    public static final class Option {
        public final String value;
        public final String label;

        public Option(String value, String label) {
            this.value = value;
            this.label = label;
        }

        @Override
        public String toString() {
            return label;
        }
    }

    public static final class Issue {
        public final String path;
        public final String code;
        public final String message;

        Issue(String path, String code, String message) {
            this.path = path;
            this.code = code;
            this.message = message;
        }
    }

    public static final class Field {
        public final String name;
        public final String type;
        public final String title;
        public final String description;
        public final boolean required;
        public final boolean hasDefault;
        public final Object defaultValue;
        public final Kind kind;
        public final List<Option> options;
        public final String format;
        public final String inputType;
        public final Integer minLength;
        public final Integer maxLength;
        public final Double minimum;
        public final Double maximum;
        public final Integer minItems;
        public final Integer maxItems;

        Field(
                String name,
                String type,
                String title,
                String description,
                boolean required,
                boolean hasDefault,
                Object defaultValue,
                Kind kind,
                List<Option> options,
                String format,
                String inputType,
                Integer minLength,
                Integer maxLength,
                Double minimum,
                Double maximum,
                Integer minItems,
                Integer maxItems) {
            this.name = name;
            this.type = type;
            this.title = title;
            this.description = description;
            this.required = required;
            this.hasDefault = hasDefault;
            this.defaultValue = defaultValue;
            this.kind = kind;
            this.options = Collections.unmodifiableList(new ArrayList<>(options));
            this.format = format;
            this.inputType = inputType;
            this.minLength = minLength;
            this.maxLength = maxLength;
            this.minimum = minimum;
            this.maximum = maximum;
            this.minItems = minItems;
            this.maxItems = maxItems;
        }
    }

    public static final class Model {
        public final String version;
        public final boolean supported;
        public final List<Field> fields;
        public final List<String> required;
        public final List<Issue> errors;

        Model(boolean supported, List<Field> fields, List<String> required,
                List<Issue> errors) {
            this.version = VOCABULARY_VERSION;
            this.supported = supported;
            this.fields = Collections.unmodifiableList(new ArrayList<>(fields));
            this.required = Collections.unmodifiableList(new ArrayList<>(required));
            this.errors = Collections.unmodifiableList(new ArrayList<>(errors));
        }
    }

    public static final class Validation {
        public final boolean valid;
        public final List<Issue> errors;

        Validation(boolean valid, List<Issue> errors) {
            this.valid = valid;
            this.errors = Collections.unmodifiableList(new ArrayList<>(errors));
        }
    }

    public static final class Submission {
        public final boolean valid;
        public final Map<String, Object> value;
        public final List<Issue> errors;
        public final Model model;

        Submission(boolean valid, Map<String, Object> value,
                List<Issue> errors, Model model) {
            this.valid = valid;
            this.value = Collections.unmodifiableMap(new LinkedHashMap<>(value));
            this.errors = Collections.unmodifiableList(new ArrayList<>(errors));
            this.model = model;
        }
    }

    private static Issue issue(String path, String code, String message) {
        return new Issue(path, code, message);
    }

    private static boolean record(Object value) {
        return value instanceof Map;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return (Map<String, Object>) value;
    }

    private static String string(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static Double finiteNumber(Object value) {
        if (!(value instanceof Number)) return null;
        double n = ((Number) value).doubleValue();
        return Double.isFinite(n) ? n : null;
    }

    private static Integer nonNegativeInteger(Object value) {
        Double number = finiteNumber(value);
        if (number == null || number < 0 || Math.rint(number) != number
                || number > Integer.MAX_VALUE) {
            return null;
        }
        return number.intValue();
    }

    private static List<Option> enumOptions(
            Object valuesObject, Object namesObject, String path,
            List<Issue> errors) {
        if (!(valuesObject instanceof List) || ((List<?>) valuesObject).isEmpty()) {
            errors.add(issue(path, "invalid_enum",
                    "enum must contain one or more strings"));
            return List.of();
        }
        List<?> values = (List<?>) valuesObject;
        for (Object value : values) {
            if (!(value instanceof String)) {
                errors.add(issue(path, "invalid_enum",
                        "enum must contain one or more strings"));
                return List.of();
            }
        }
        List<?> names = namesObject instanceof List
                ? (List<?>) namesObject : List.of();
        boolean validNames = true;
        for (Object name : names) {
            if (!(name instanceof String)) {
                validNames = false;
                break;
            }
        }
        List<Option> out = new ArrayList<>();
        for (int i = 0; i < values.size(); i++) {
            String value = (String) values.get(i);
            String label = validNames && i < names.size()
                    ? (String) names.get(i) : value;
            out.add(new Option(value, label));
        }
        return out;
    }

    private static List<Option> titledOptions(
            Object entriesObject, String path, List<Issue> errors) {
        if (!(entriesObject instanceof List)
                || ((List<?>) entriesObject).isEmpty()) {
            errors.add(issue(path, "invalid_options",
                    "at least one option is required"));
            return List.of();
        }
        List<Option> out = new ArrayList<>();
        List<?> entries = (List<?>) entriesObject;
        for (int i = 0; i < entries.size(); i++) {
            Object entryObject = entries.get(i);
            if (!record(entryObject)) {
                errors.add(issue(path + "/" + i, "invalid_option",
                        "titled options require string const and title values"));
                continue;
            }
            Map<String, Object> entry = map(entryObject);
            String value = string(entry.get("const"));
            String label = string(entry.get("title"));
            if (value == null || label == null) {
                errors.add(issue(path + "/" + i, "invalid_option",
                        "titled options require string const and title values"));
                continue;
            }
            out.add(new Option(value, label));
        }
        return out;
    }

    private static void validateRange(
            Map<String, Object> spec, String minKey, String maxKey,
            boolean integerOnly, String path, List<Issue> errors) {
        Object minObject = spec.get(minKey);
        Object maxObject = spec.get(maxKey);
        Double min = finiteNumber(minObject);
        Double max = finiteNumber(maxObject);
        if (minObject != null && (min == null
                || (integerOnly && nonNegativeInteger(minObject) == null))) {
            errors.add(issue(path + "/" + minKey, "invalid_constraint",
                    minKey + " must be " + (integerOnly
                            ? "a non-negative integer" : "a finite number")));
        }
        if (maxObject != null && (max == null
                || (integerOnly && nonNegativeInteger(maxObject) == null))) {
            errors.add(issue(path + "/" + maxKey, "invalid_constraint",
                    maxKey + " must be " + (integerOnly
                            ? "a non-negative integer" : "a finite number")));
        }
        if (min != null && max != null && min > max) {
            errors.add(issue(path, "invalid_range",
                    minKey + " cannot exceed " + maxKey));
        }
    }

    private static Field field(
            String name, Map<String, Object> spec, boolean required,
            String path, List<Issue> errors) {
        String type = string(spec.get("type"));
        String title = string(spec.get("title"));
        if (title == null) title = name;
        String description = string(spec.get("description"));
        if (description == null) description = "";
        boolean hasDefault = spec.containsKey("default");
        Object defaultValue = spec.get("default");

        if ("string".equals(type) && spec.get("enum") instanceof List) {
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue, Kind.SINGLE_SELECT,
                    enumOptions(spec.get("enum"), spec.get("enumNames"),
                            path + "/enum", errors),
                    null, null, null, null, null, null, null, null);
        }
        if ("string".equals(type) && spec.get("oneOf") instanceof List) {
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue, Kind.SINGLE_SELECT,
                    titledOptions(spec.get("oneOf"), path + "/oneOf", errors),
                    null, null, null, null, null, null, null, null);
        }
        if ("array".equals(type)) {
            if (!record(spec.get("items"))) {
                errors.add(issue(path + "/items", "unsupported_array",
                        "multi-select arrays require an items schema"));
                return null;
            }
            Map<String, Object> items = map(spec.get("items"));
            List<Option> options;
            if (items.get("enum") instanceof List) {
                options = enumOptions(items.get("enum"), null,
                        path + "/items/enum", errors);
            } else if (items.get("anyOf") instanceof List) {
                options = titledOptions(items.get("anyOf"),
                        path + "/items/anyOf", errors);
            } else {
                errors.add(issue(path + "/items", "unsupported_array",
                        "only MCP string multi-select arrays are supported"));
                options = List.of();
            }
            validateRange(spec, "minItems", "maxItems", true, path, errors);
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue, Kind.MULTI_SELECT, options,
                    null, null, null, null, null, null,
                    nonNegativeInteger(spec.get("minItems")),
                    nonNegativeInteger(spec.get("maxItems")));
        }
        if ("boolean".equals(type)) {
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue, Kind.BOOLEAN, List.of(),
                    null, null, null, null, null, null, null, null);
        }
        if ("string".equals(type)) {
            validateRange(spec, "minLength", "maxLength", true, path, errors);
            String format = string(spec.get("format"));
            if (spec.containsKey("format")
                    && (format == null || !STRING_FORMATS.contains(format))) {
                errors.add(issue(path + "/format", "unsupported_format",
                        "unsupported MCP string format: "
                                + String.valueOf(spec.get("format"))));
                format = null;
            }
            String inputType = "text";
            if ("email".equals(format)) inputType = "email";
            else if ("uri".equals(format)) inputType = "url";
            else if ("date".equals(format)) inputType = "date";
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue, Kind.TEXT, List.of(),
                    format, inputType,
                    nonNegativeInteger(spec.get("minLength")),
                    nonNegativeInteger(spec.get("maxLength")),
                    null, null, null, null);
        }
        if ("number".equals(type) || "integer".equals(type)) {
            validateRange(spec, "minimum", "maximum", false, path, errors);
            return new Field(name, type, title, description, required,
                    hasDefault, defaultValue,
                    "integer".equals(type) ? Kind.INTEGER : Kind.NUMBER,
                    List.of(), null, null, null, null,
                    finiteNumber(spec.get("minimum")),
                    finiteNumber(spec.get("maximum")), null, null);
        }

        errors.add(issue(path + "/type", "unsupported_type",
                "unsupported MCP elicitation field type: " + type));
        return null;
    }

    public static Model compile(Object schemaObject) {
        if (!record(schemaObject)) {
            return new Model(false, List.of(), List.of(),
                    List.of(issue("", "invalid_schema",
                            "requestedSchema must be an object")));
        }
        Map<String, Object> schema = map(schemaObject);
        List<Issue> errors = new ArrayList<>();
        if (!"object".equals(schema.get("type"))) {
            errors.add(issue("/type", "unsupported_root",
                    "MCP form requestedSchema must have type \"object\""));
        }
        Object propertiesObject = schema.get("properties");
        if (!record(propertiesObject)) {
            errors.add(issue("/properties", "invalid_properties",
                    "requestedSchema.properties must be an object"));
        }
        Map<String, Object> properties = record(propertiesObject)
                ? map(propertiesObject) : Map.of();

        List<String> required = new ArrayList<>();
        Object requiredObject = schema.get("required");
        if (requiredObject != null) {
            if (!(requiredObject instanceof List)) {
                errors.add(issue("/required", "invalid_required",
                        "required must be an array of property names"));
            } else {
                for (Object nameObject : (List<?>) requiredObject) {
                    if (!(nameObject instanceof String)) {
                        errors.add(issue("/required", "invalid_required",
                                "required must be an array of property names"));
                        continue;
                    }
                    String name = (String) nameObject;
                    if (!properties.containsKey(name)) {
                        errors.add(issue("/required", "unknown_required",
                                "required property is not declared: " + name));
                    } else if (!required.contains(name)) {
                        required.add(name);
                    }
                }
            }
        }

        List<Field> fields = new ArrayList<>();
        for (Map.Entry<String, Object> entry : properties.entrySet()) {
            if (!record(entry.getValue())) {
                errors.add(issue("/properties/" + entry.getKey(),
                        "invalid_field_schema",
                        "field schema must be an object"));
                continue;
            }
            Field normalized = field(entry.getKey(), map(entry.getValue()),
                    required.contains(entry.getKey()),
                    "/properties/" + entry.getKey(), errors);
            if (normalized != null) fields.add(normalized);
        }

        if (errors.isEmpty()) {
            for (Field normalized : fields) {
                if (!normalized.hasDefault) continue;
                Issue defaultError = validateField(
                        normalized, normalized.defaultValue);
                if (defaultError != null) {
                    errors.add(issue(
                            "/properties/" + normalized.name + "/default",
                            "invalid_default", defaultError.message));
                }
            }
        }
        return new Model(errors.isEmpty(), fields, required, errors);
    }

    public static Map<String, Object> initialValues(Model model) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Field field : model.fields) {
            if (field.hasDefault) out.put(field.name, field.defaultValue);
            else if (field.kind == Kind.BOOLEAN) out.put(field.name, false);
            else if (field.kind == Kind.MULTI_SELECT) {
                out.put(field.name, new ArrayList<>());
            } else out.put(field.name, null);
        }
        return out;
    }

    private static Object coerce(Field field, Object raw) {
        if (field.kind == Kind.BOOLEAN) {
            if (raw instanceof Boolean) return raw;
            String text = String.valueOf(raw);
            if ("true".equals(text) || "1".equals(text)) return true;
            if ("false".equals(text) || "0".equals(text)) return false;
            return raw;
        }
        if (field.kind == Kind.INTEGER) {
            if (raw instanceof Number) {
                double n = ((Number) raw).doubleValue();
                if (Double.isFinite(n) && Math.rint(n) == n) {
                    return ((Number) raw).longValue();
                }
                return n;
            }
            try {
                return Long.parseLong(String.valueOf(raw).trim());
            } catch (NumberFormatException ignored) {
                try {
                    return Double.parseDouble(String.valueOf(raw).trim());
                } catch (NumberFormatException ignoredAgain) {
                    return raw;
                }
            }
        }
        if (field.kind == Kind.NUMBER) {
            if (raw instanceof Number) return ((Number) raw).doubleValue();
            try {
                return Double.parseDouble(String.valueOf(raw).trim());
            } catch (NumberFormatException ignored) {
                return raw;
            }
        }
        if (field.kind == Kind.MULTI_SELECT) {
            if (!(raw instanceof List)) return raw;
            List<String> out = new ArrayList<>();
            for (Object item : (List<?>) raw) out.add(String.valueOf(item));
            return out;
        }
        return raw instanceof String ? raw : String.valueOf(raw);
    }

    public static Map<String, Object> coerceAnswer(
            Model model, Map<String, Object> rawValues) {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Object> source =
                rawValues == null ? Map.of() : rawValues;
        for (Field field : model.fields) {
            if (!source.containsKey(field.name)) continue;
            Object raw = source.get(field.name);
            if (raw == null) continue;
            if ("".equals(raw) && !field.required
                    && (field.kind == Kind.NUMBER
                    || field.kind == Kind.INTEGER
                    || field.kind == Kind.SINGLE_SELECT)) {
                continue;
            }
            out.put(field.name, coerce(field, raw));
        }
        return out;
    }

    private static boolean validFormat(String format, String value) {
        if (format == null) return true;
        if ("email".equals(format)) return EMAIL.matcher(value).matches();
        if ("uri".equals(format)) {
            try {
                return URI.create(value).isAbsolute();
            } catch (IllegalArgumentException ignored) {
                return false;
            }
        }
        if ("date".equals(format)) {
            try {
                LocalDate.parse(value);
                return true;
            } catch (DateTimeParseException ignored) {
                return false;
            }
        }
        if ("date-time".equals(format)) {
            try {
                OffsetDateTime.parse(value);
                return true;
            } catch (DateTimeParseException ignored) {
                return false;
            }
        }
        return true;
    }

    private static Issue validateField(Field field, Object value) {
        if (field.kind == Kind.BOOLEAN) {
            return value instanceof Boolean ? null
                    : issue("/" + field.name, "type",
                    field.title + " must be a boolean");
        }
        if (field.kind == Kind.TEXT || field.kind == Kind.SINGLE_SELECT) {
            if (!(value instanceof String)) {
                return issue("/" + field.name, "type",
                        field.title + " must be a string");
            }
            String text = (String) value;
            if (field.kind == Kind.SINGLE_SELECT) {
                boolean allowed = false;
                for (Option option : field.options) {
                    if (option.value.equals(text)) {
                        allowed = true;
                        break;
                    }
                }
                if (!allowed) {
                    return issue("/" + field.name, "enum",
                            field.title + " must be one of the available options");
                }
            }
            int length = text.codePointCount(0, text.length());
            if (field.minLength != null && length < field.minLength) {
                return issue("/" + field.name, "minLength",
                        field.title + " must contain at least "
                                + field.minLength + " characters");
            }
            if (field.maxLength != null && length > field.maxLength) {
                return issue("/" + field.name, "maxLength",
                        field.title + " must contain at most "
                                + field.maxLength + " characters");
            }
            if (!validFormat(field.format, text)) {
                return issue("/" + field.name, "format",
                        field.title + " must be a valid " + field.format);
            }
            return null;
        }
        if (field.kind == Kind.NUMBER || field.kind == Kind.INTEGER) {
            Double number = finiteNumber(value);
            if (number == null) {
                return issue("/" + field.name, "type",
                        field.title + " must be a finite number");
            }
            if (field.kind == Kind.INTEGER && Math.rint(number) != number) {
                return issue("/" + field.name, "type",
                        field.title + " must be an integer");
            }
            if (field.minimum != null && number < field.minimum) {
                return issue("/" + field.name, "minimum",
                        field.title + " must be at least " + field.minimum);
            }
            if (field.maximum != null && number > field.maximum) {
                return issue("/" + field.name, "maximum",
                        field.title + " must be at most " + field.maximum);
            }
            return null;
        }
        if (field.kind == Kind.MULTI_SELECT) {
            if (!(value instanceof List)) {
                return issue("/" + field.name, "type",
                        field.title + " must be an array");
            }
            Set<String> allowed = new HashSet<>();
            for (Option option : field.options) allowed.add(option.value);
            for (Object item : (List<?>) value) {
                if (!(item instanceof String) || !allowed.contains(item)) {
                    return issue("/" + field.name, "enum",
                            field.title + " contains an unavailable option");
                }
            }
            int size = ((List<?>) value).size();
            if (field.minItems != null && size < field.minItems) {
                return issue("/" + field.name, "minItems",
                        field.title + " requires at least "
                                + field.minItems + " selections");
            }
            if (field.maxItems != null && size > field.maxItems) {
                return issue("/" + field.name, "maxItems",
                        field.title + " allows at most "
                                + field.maxItems + " selections");
            }
            return null;
        }
        return issue("/" + field.name, "unsupported_type",
                field.title + " uses an unsupported field type");
    }

    public static Validation validate(Model model, Object answerObject) {
        if (!model.supported) {
            return new Validation(false, model.errors.isEmpty()
                    ? List.of(issue("", "unsupported_schema",
                    "requestedSchema is not supported"))
                    : model.errors);
        }
        if (!record(answerObject)) {
            return new Validation(false, List.of(issue("", "type",
                    "elicitation answer content must be an object")));
        }
        Map<String, Object> answer = map(answerObject);
        List<Issue> errors = new ArrayList<>();
        for (Field field : model.fields) {
            if (!answer.containsKey(field.name)) {
                if (field.required) {
                    errors.add(issue("/" + field.name, "required",
                            field.title + " is required"));
                }
                continue;
            }
            Issue fieldError = validateField(field, answer.get(field.name));
            if (fieldError != null) errors.add(fieldError);
        }
        return new Validation(errors.isEmpty(), errors);
    }

    public static Submission prepare(
            Model model, Map<String, Object> rawValues) {
        Map<String, Object> value = coerceAnswer(model, rawValues);
        Validation validation = validate(model, value);
        return new Submission(validation.valid, value,
                validation.errors, model);
    }
}
