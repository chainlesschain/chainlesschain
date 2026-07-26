package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.DialogWrapper;

import javax.swing.JComboBox;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.util.List;

/**
 * Combo-box choice dialog backed only by supported IntelliJ Platform APIs.
 *
 * <p>{@code Messages.showChooseDialog} is deprecated on current IDE builds.
 * Keeping the replacement here prevents feature actions from drifting back to
 * that API while preserving a compact chooser for potentially long labels.</p>
 */
final class ChoiceDialog {

    private ChoiceDialog() {}

    static String choose(
            Project project,
            String title,
            String message,
            List<String> choices,
            String initialValue) {
        if (choices == null || choices.isEmpty()) return null;

        JComboBox<String> combo = new JComboBox<>(choices.toArray(new String[0]));
        int initialIndex = choices.indexOf(initialValue);
        combo.setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

        JTextArea prompt = new JTextArea(message == null ? "" : message, 3, 48);
        prompt.setEditable(false);
        prompt.setFocusable(false);
        prompt.setOpaque(false);
        prompt.setLineWrap(true);
        prompt.setWrapStyleWord(true);
        prompt.setBorder(null);

        JPanel center = new JPanel(new BorderLayout(0, 8));
        center.add(prompt, BorderLayout.NORTH);
        center.add(combo, BorderLayout.CENTER);

        DialogBuilder builder = new DialogBuilder(project);
        builder.setTitle(title);
        builder.setCenterPanel(center);
        builder.addOkAction();
        builder.addCancelAction();
        if (builder.show() != DialogWrapper.OK_EXIT_CODE) return null;

        Object selected = combo.getSelectedItem();
        return selected == null ? null : String.valueOf(selected);
    }
}
