package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ContextCenter;
import com.chainlesschain.ide.MiniJson;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.project.Project;

import java.util.LinkedHashMap;
import java.util.Map;

/** Project-scoped persistence for Context Center budget/pin/remove intent. */
final class ContextCenterPersistence {
    private static final String KEY = "chainlesschain.contextCenter.v1";

    private ContextCenterPersistence() {}

    static Map<String, Object> load(Project project) {
        if (project == null) return ContextCenter.normalizePreferences(null);
        String raw = PropertiesComponent.getInstance(project).getValue(KEY);
        if (raw == null || raw.trim().isEmpty()) {
            return ContextCenter.normalizePreferences(null);
        }
        try {
            Object parsed = MiniJson.parse(raw);
            if (!(parsed instanceof Map)) {
                return ContextCenter.normalizePreferences(null);
            }
            Map<String, Object> value = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) parsed).entrySet()) {
                if (entry.getKey() instanceof String) {
                    value.put((String) entry.getKey(), entry.getValue());
                }
            }
            return ContextCenter.normalizePreferences(value);
        } catch (RuntimeException invalid) {
            return ContextCenter.normalizePreferences(null);
        }
    }

    static void save(Project project, Map<String, Object> value) {
        if (project == null) return;
        PropertiesComponent.getInstance(project).setValue(
                KEY, MiniJson.stringify(ContextCenter.normalizePreferences(value)));
    }
}
