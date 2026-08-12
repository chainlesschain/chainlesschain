package com.chainlesschain.ide.intellij;

import com.intellij.openapi.options.Configurable;
import com.intellij.ui.components.JBCheckBox;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.FormBuilder;
import com.intellij.util.ui.JBUI;
import java.awt.Font;
import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.JSpinner;
import javax.swing.SpinnerNumberModel;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.Nullable;

/**
 * Settings → Tools → ChainlessChain IDE. VS Code parity for the settings the
 * JetBrains plugin previously had no UI for — most importantly an explicit cc
 * CLI path (the VS Code {@code chainlesschain.cli.path} equivalent), plus the
 * chat panel's context-window indicator toggle ({@code chainlesschain.chat.contextIndicator}).
 * All state lives in {@link CcSettings}; a plain text field (not a file chooser)
 * mirrors VS Code's string setting and keeps the SDK surface small.
 */
public final class CcConfigurable implements Configurable {

    private JBTextField ccPathField;
    private JBCheckBox contextIndicatorBox;
    private JBCheckBox leanContextBox;
    private JBCheckBox managedCliBox;
    private JBCheckBox automaticCompletionBox;
    private JSpinner automaticDebounceSpinner;
    private JSpinner automaticRequestsSpinner;
    private JSpinner automaticContextCharsSpinner;
    private JSpinner automaticCacheTtlSpinner;
    private JSpinner automaticMaxCharsSpinner;
    private JSpinner automaticMaxLinesSpinner;
    private JPanel panel;

    @Override
    public @Nls(capitalization = Nls.Capitalization.Title) String getDisplayName() {
        return "ChainlessChain IDE";
    }

    @Override
    public @Nullable JComponent createComponent() {
        ccPathField = new JBTextField();
        contextIndicatorBox = new JBCheckBox(CcBundle.message("settings.contextIndicator.label"));
        leanContextBox = new JBCheckBox(CcBundle.message("settings.leanContext.label"));
        managedCliBox = new JBCheckBox(CcBundle.message("settings.managedCli.label"));
        automaticCompletionBox = new JBCheckBox(
                CcBundle.message("settings.completion.automatic.label"));
        automaticDebounceSpinner = spinner(650, 100, 3000);
        automaticRequestsSpinner = spinner(60, 1, 10000);
        automaticContextCharsSpinner = spinner(240_000, 1000, 10_000_000);
        automaticCacheTtlSpinner = spinner(30_000, 1000, 300_000);
        automaticMaxCharsSpinner = spinner(800, 32, 2000);
        automaticMaxLinesSpinner = spinner(12, 1, 100);

        JBLabel hint = new JBLabel(CcBundle.message("settings.ccPath.hint"));
        hint.setForeground(JBUI.CurrentTheme.ContextHelp.FOREGROUND);
        hint.setFont(hint.getFont().deriveFont(Font.PLAIN, hint.getFont().getSize() - 1f));

        panel = FormBuilder.createFormBuilder()
                .addLabeledComponent(
                        new JBLabel(CcBundle.message("settings.ccPath.label")), ccPathField, 1, false)
                .addComponentToRightColumn(hint, 1)
                .addComponent(contextIndicatorBox, 1)
                .addComponent(leanContextBox, 1)
                .addComponent(managedCliBox, 1)
                .addComponent(automaticCompletionBox, 1)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.debounce.label"),
                        automaticDebounceSpinner)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.requests.label"),
                        automaticRequestsSpinner)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.contextChars.label"),
                        automaticContextCharsSpinner)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.cacheTtl.label"),
                        automaticCacheTtlSpinner)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.maxChars.label"),
                        automaticMaxCharsSpinner)
                .addLabeledComponent(
                        CcBundle.message("settings.completion.maxLines.label"),
                        automaticMaxLinesSpinner)
                .addComponent(new JBLabel(CcBundle.message("settings.completion.slo.label")), 1)
                .addComponentFillVertically(new JPanel(), 0)
                .getPanel();
        return panel;
    }

    @Override
    public boolean isModified() {
        CcSettings s = CcSettings.getInstance();
        return !ccPathField.getText().trim().equals(s.getCcPath())
                || contextIndicatorBox.isSelected() != s.isContextIndicatorEnabled()
                || leanContextBox.isSelected() != s.isLeanContextEnabled()
                || managedCliBox.isSelected() != s.isManagedCliEnabled()
                || automaticCompletionBox.isSelected() != s.isAutomaticCompletionEnabled()
                || spinnerValue(automaticDebounceSpinner) != s.getState().automaticCompletionDebounceMs
                || spinnerValue(automaticRequestsSpinner) != s.getState().automaticCompletionMaxRequestsPerHour
                || spinnerValue(automaticContextCharsSpinner) != s.getState().automaticCompletionMaxContextCharsPerHour
                || spinnerValue(automaticCacheTtlSpinner) != s.getState().automaticCompletionCacheTtlMs
                || spinnerValue(automaticMaxCharsSpinner) != s.getState().automaticCompletionMaxChars
                || spinnerValue(automaticMaxLinesSpinner) != s.getState().automaticCompletionMaxLines;
    }

    @Override
    public void apply() {
        CcSettings s = CcSettings.getInstance();
        s.setCcPath(ccPathField.getText());
        s.setContextIndicatorEnabled(contextIndicatorBox.isSelected());
        s.setLeanContextEnabled(leanContextBox.isSelected());
        s.setManagedCliEnabled(managedCliBox.isSelected());
        s.setAutomaticCompletionEnabled(automaticCompletionBox.isSelected());
        s.setAutomaticCompletionOptions(
                spinnerValue(automaticDebounceSpinner),
                spinnerValue(automaticRequestsSpinner),
                spinnerValue(automaticContextCharsSpinner),
                spinnerValue(automaticCacheTtlSpinner),
                spinnerValue(automaticMaxCharsSpinner),
                spinnerValue(automaticMaxLinesSpinner));
    }

    @Override
    public void reset() {
        CcSettings s = CcSettings.getInstance();
        ccPathField.setText(s.getCcPath());
        contextIndicatorBox.setSelected(s.isContextIndicatorEnabled());
        leanContextBox.setSelected(s.isLeanContextEnabled());
        managedCliBox.setSelected(s.isManagedCliEnabled());
        automaticCompletionBox.setSelected(s.isAutomaticCompletionEnabled());
        automaticDebounceSpinner.setValue(s.getState().automaticCompletionDebounceMs);
        automaticRequestsSpinner.setValue(s.getState().automaticCompletionMaxRequestsPerHour);
        automaticContextCharsSpinner.setValue(s.getState().automaticCompletionMaxContextCharsPerHour);
        automaticCacheTtlSpinner.setValue(s.getState().automaticCompletionCacheTtlMs);
        automaticMaxCharsSpinner.setValue(s.getState().automaticCompletionMaxChars);
        automaticMaxLinesSpinner.setValue(s.getState().automaticCompletionMaxLines);
    }

    @Override
    public void disposeUIResources() {
        panel = null;
        ccPathField = null;
        contextIndicatorBox = null;
        leanContextBox = null;
        managedCliBox = null;
        automaticCompletionBox = null;
        automaticDebounceSpinner = null;
        automaticRequestsSpinner = null;
        automaticContextCharsSpinner = null;
        automaticCacheTtlSpinner = null;
        automaticMaxCharsSpinner = null;
        automaticMaxLinesSpinner = null;
    }

    private static JSpinner spinner(int value, int min, int max) {
        return new JSpinner(new SpinnerNumberModel(value, min, max, 1));
    }

    private static int spinnerValue(JSpinner spinner) {
        return ((Number) spinner.getValue()).intValue();
    }
}
