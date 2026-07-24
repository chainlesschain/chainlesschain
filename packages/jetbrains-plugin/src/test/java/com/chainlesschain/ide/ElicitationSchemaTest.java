package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Cross-language conformance against packages/elicitation-schema. */
class ElicitationSchemaTest {

    private static Path fixturePath() {
        for (String root : new String[] {
                "../elicitation-schema", "packages/elicitation-schema",
                "../../packages/elicitation-schema" }) {
            Path candidate = Paths.get(
                    root, "__fixtures__", "conformance.json");
            if (Files.isRegularFile(candidate)) return candidate;
        }
        throw new AssertionError(
                "shared elicitation conformance fixture not found; cwd="
                        + Paths.get("").toAbsolutePath());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> fixture() {
        try {
            return (Map<String, Object>) MiniJson.parse(Files.readString(
                    fixturePath(), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AssertionError("cannot read elicitation fixture", e);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> testCase(int index) {
        return (Map<String, Object>)
                ((List<?>) fixture().get("cases")).get(index);
    }

    private static Map<String, Object> projectField(
            ElicitationSchema.Field field) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", field.name);
        out.put("kind", field.kind.wireName);
        if (field.inputType != null) out.put("inputType", field.inputType);
        out.put("required", field.required);
        if (!field.options.isEmpty()) {
            List<Map<String, Object>> options = new ArrayList<>();
            for (ElicitationSchema.Option option : field.options) {
                Map<String, Object> projected = new LinkedHashMap<>();
                projected.put("value", option.value);
                projected.put("label", option.label);
                options.add(projected);
            }
            out.put("options", options);
        }
        return out;
    }

    @Test
    @SuppressWarnings("unchecked")
    void nativeAdapterMatchesSharedRestrictedVocabularyFixture() {
        Map<String, Object> value = testCase(0);
        ElicitationSchema.Model model =
                ElicitationSchema.compile(value.get("schema"));

        assertEquals(fixture().get("version"), model.version);
        assertTrue(model.supported);
        List<Map<String, Object>> fields = new ArrayList<>();
        for (ElicitationSchema.Field field : model.fields) {
            fields.add(projectField(field));
        }
        assertEquals(value.get("expectedFields"), fields);

        ElicitationSchema.Submission submission = ElicitationSchema.prepare(
                model, (Map<String, Object>) value.get("rawValid"));
        assertTrue(submission.valid);
        assertEquals(value.get("expectedValue"), submission.value);
        assertFalse(submission.value.containsKey("ignored"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void nativeAdapterReturnsTheSameValidationCodes() {
        Map<String, Object> value = testCase(0);
        ElicitationSchema.Model model =
                ElicitationSchema.compile(value.get("schema"));
        ElicitationSchema.Submission submission = ElicitationSchema.prepare(
                model, (Map<String, Object>) value.get("rawInvalid"));

        assertFalse(submission.valid);
        List<String> codes = new ArrayList<>();
        for (ElicitationSchema.Issue error : submission.errors) {
            codes.add(error.code);
        }
        assertEquals(value.get("expectedErrorCodes"), codes);
    }

    @Test
    @SuppressWarnings("unchecked")
    void nestedObjectIsAnExplicitUnsupportedBoundary() {
        Map<String, Object> value = testCase(1);
        ElicitationSchema.Model model =
                ElicitationSchema.compile(value.get("schema"));

        assertFalse(model.supported);
        List<String> codes = new ArrayList<>();
        for (ElicitationSchema.Issue error : model.errors) {
            codes.add(error.code);
        }
        assertEquals(value.get("expectedSchemaErrorCodes"), codes);
    }
}
