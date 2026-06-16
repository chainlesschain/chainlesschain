package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;

import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.SwingConstants;
import java.awt.BorderLayout;

/**
 * §2 host for the App Preview. Starts empty ("No preview running."); the
 * {@link PreviewService} swaps in a JCEF browser (or a status label) when a dev
 * server URL is detected. SDK-bound glue.
 */
public final class PreviewToolWindowFactory implements ToolWindowFactory, DumbAware {
    @Override
    public void createToolWindowContent(Project project, ToolWindow toolWindow) {
        JPanel panel = new JPanel(new BorderLayout());
        panel.add(new JLabel("No preview running. Run \"ChainlessChain: Start App Preview\".",
                SwingConstants.CENTER), BorderLayout.CENTER);
        Content content = ContentFactory.getInstance().createContent(panel, "", false);
        toolWindow.getContentManager().addContent(content);
    }
}
