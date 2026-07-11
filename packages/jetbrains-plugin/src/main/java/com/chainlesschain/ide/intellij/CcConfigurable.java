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
    private JBCheckBox managedCliBox;
    private JPanel panel;

    @Override
    public @Nls(capitalization = Nls.Capitalization.Title) String getDisplayName() {
        return "ChainlessChain IDE";
    }

    @Override
    public @Nullable JComponent createComponent() {
        ccPathField = new JBTextField();
        contextIndicatorBox = new JBCheckBox(CcBundle.message("settings.contextIndicator.label"));
        managedCliBox = new JBCheckBox(CcBundle.message("settings.managedCli.label"));

        JBLabel hint = new JBLabel(CcBundle.message("settings.ccPath.hint"));
        hint.setForeground(JBUI.CurrentTheme.ContextHelp.FOREGROUND);
        hint.setFont(hint.getFont().deriveFont(Font.PLAIN, hint.getFont().getSize() - 1f));

        panel = FormBuilder.createFormBuilder()
                .addLabeledComponent(
                        new JBLabel(CcBundle.message("settings.ccPath.label")), ccPathField, 1, false)
                .addComponentToRightColumn(hint, 1)
                .addComponent(contextIndicatorBox, 1)
                .addComponent(managedCliBox, 1)
                .addComponentFillVertically(new JPanel(), 0)
                .getPanel();
        return panel;
    }

    @Override
    public boolean isModified() {
        CcSettings s = CcSettings.getInstance();
        return !ccPathField.getText().trim().equals(s.getCcPath())
                || contextIndicatorBox.isSelected() != s.isContextIndicatorEnabled()
                || managedCliBox.isSelected() != s.isManagedCliEnabled();
    }

    @Override
    public void apply() {
        CcSettings s = CcSettings.getInstance();
        s.setCcPath(ccPathField.getText());
        s.setContextIndicatorEnabled(contextIndicatorBox.isSelected());
        s.setManagedCliEnabled(managedCliBox.isSelected());
    }

    @Override
    public void reset() {
        CcSettings s = CcSettings.getInstance();
        ccPathField.setText(s.getCcPath());
        contextIndicatorBox.setSelected(s.isContextIndicatorEnabled());
        managedCliBox.setSelected(s.isManagedCliEnabled());
    }

    @Override
    public void disposeUIResources() {
        panel = null;
        ccPathField = null;
        contextIndicatorBox = null;
        managedCliBox = null;
    }
}
