package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.EvolutionDeploymentConfig;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.ui.components.JBLabel;
import com.intellij.ui.components.JBTextArea;
import com.intellij.ui.components.JBTextField;
import com.intellij.util.ui.FormBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.Action;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.io.File;
import java.util.List;
import java.util.concurrent.Callable;

/** Native configuration surface over cc's signed deployment profile. */
public final class ConfigureEvolutionDeploymentAction extends AnAction implements DumbAware {
    @Override public void actionPerformed(@NotNull AnActionEvent event) {
        new DeploymentDialog(event.getProject()).show();
    }

    public static void open(Project project) { new DeploymentDialog(project).show(); }

    private static final class DeploymentDialog extends DialogWrapper {
        private final Project project;
        private final File cwd;
        private final JBTextField descriptor = new JBTextField();
        private final JBTextField trustRoot = new JBTextField();
        private final JBTextArea status = new JBTextArea();
        private final JButton reload = new JButton(CcBundle.message("evolution.config.reload"));
        private final JButton save = new JButton(CcBundle.message("evolution.config.save"));
        private final JButton toggle = new JButton(CcBundle.message("evolution.config.enable"));
        private EvolutionDeploymentConfig.Status current;
        private boolean disposed;

        DeploymentDialog(Project project) {
            super(project, true);
            this.project = project;
            this.cwd = project != null && project.getBasePath() != null
                    ? new File(project.getBasePath()) : null;
            setTitle(CcBundle.message("evolution.config.title"));
            setCancelButtonText(CcBundle.message("evolution.config.close"));
            status.setEditable(false);
            status.setLineWrap(true);
            status.setWrapStyleWord(true);
            status.setRows(12);
            init();
            reload.addActionListener(e -> load());
            save.addActionListener(e -> save());
            toggle.addActionListener(e -> toggle());
            load();
        }

        @Override protected JComponent createCenterPanel() {
            JButton descriptorBrowse = new JButton(CcBundle.message("evolution.config.browse"));
            JButton trustBrowse = new JButton(CcBundle.message("evolution.config.browse"));
            descriptorBrowse.addActionListener(e -> choose(descriptor));
            trustBrowse.addActionListener(e -> choose(trustRoot));
            JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 8, 0));
            buttons.add(reload); buttons.add(toggle); buttons.add(save);
            JPanel panel = FormBuilder.createFormBuilder()
                    .addComponent(new JBLabel(CcBundle.message("evolution.config.intro")))
                    .addLabeledComponent(CcBundle.message("evolution.config.descriptor"), row(descriptor, descriptorBrowse))
                    .addLabeledComponent(CcBundle.message("evolution.config.trustRoot"), row(trustRoot, trustBrowse))
                    .addComponent(new JBLabel(CcBundle.message("evolution.config.hold")))
                    .addComponent(status)
                    .addComponent(buttons)
                    .getPanel();
            panel.setPreferredSize(new Dimension(720, 430));
            return panel;
        }

        @Override protected Action @NotNull [] createActions() { return new Action[]{getCancelAction()}; }
        @Override protected String getDimensionServiceKey() { return "ChainlessChain.EvolutionDeployment"; }
        @Override protected void dispose() { disposed = true; super.dispose(); }

        private JPanel row(JBTextField field, JButton button) {
            JPanel panel = new JPanel(new BorderLayout(8, 0));
            panel.add(field, BorderLayout.CENTER); panel.add(button, BorderLayout.EAST);
            return panel;
        }

        private void choose(JBTextField target) {
            VirtualFile file = FileChooser.chooseFile(
                    FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor(), project, null);
            if (file != null) target.setText(file.getPath());
        }

        private void busy(boolean value) {
            reload.setEnabled(!value); save.setEnabled(!value);
            toggle.setEnabled(!value && current != null && current.descriptorPath() != null);
        }

        private void background(Callable<EvolutionDeploymentConfig.Status> operation) {
            busy(true); status.setText(CcBundle.message("evolution.config.working"));
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                EvolutionDeploymentConfig.Status result = null; String error = null;
                try { result = operation.call(); }
                catch (Exception ex) { error = ex.getMessage(); }
                EvolutionDeploymentConfig.Status finalResult = result; String finalError = error;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (disposed) return;
                    if (finalResult != null) showStatus(finalResult);
                    else status.setText(CcBundle.message("evolution.config.failed", finalError));
                    busy(false);
                }, ModalityState.any());
            });
        }

        private void load() {
            background(() -> EvolutionDeploymentConfig.run(
                    EvolutionDeploymentConfig.statusArgs(), cwd, 30_000));
        }

        private void save() {
            List<String> args;
            try { args = EvolutionDeploymentConfig.configureArgs(descriptor.getText(), trustRoot.getText()); }
            catch (Exception error) { status.setText(error.getMessage()); return; }
            background(() -> EvolutionDeploymentConfig.run(args, cwd, 60_000));
        }

        private void toggle() {
            if (current == null) return;
            background(() -> EvolutionDeploymentConfig.run(
                    EvolutionDeploymentConfig.toggleArgs(!current.profileEnabled()), cwd, 30_000));
        }

        private void showStatus(EvolutionDeploymentConfig.Status value) {
            current = value;
            if (value.descriptorPath() != null) descriptor.setText(value.descriptorPath());
            if (value.trustRootPath() != null) trustRoot.setText(value.trustRootPath());
            toggle.setText(CcBundle.message(value.profileEnabled()
                    ? "evolution.config.disable" : "evolution.config.enable"));
            status.setText(CcBundle.message("evolution.config.status",
                    value.effectiveEnabled() ? "enabled" : "disabled",
                    value.source() == null ? "none" : value.source(),
                    value.verified() ? "verified" : "not verified",
                    value.profilePath() == null ? "—" : value.profilePath(),
                    value.commands().isEmpty() ? "—" : String.join(", ", value.commands()),
                    value.error() == null ? "—" : value.error()));
            status.append("\n\n" + CcBundle.message("evolution.config.admission.scope"));
            for (String command : List.of("ask", "agent")) {
                EvolutionDeploymentConfig.Admission admission = value.readiness().get(command);
                String key = !admission.known() ? "unknown" : admission.admitted() ? "admitted" : "blocked";
                status.append("\n" + command + ": " + CcBundle.message("evolution.config.admission." + key));
                if (admission.detail() != null) status.append("\n" + admission.detail());
                if (admission.remediation() != null) status.append("\n" + admission.remediation());
            }
        }
    }
}
