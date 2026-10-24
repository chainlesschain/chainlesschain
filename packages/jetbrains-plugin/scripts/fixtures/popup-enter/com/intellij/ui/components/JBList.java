package com.intellij.ui.components;

/** Minimal platform list type; hierarchy, model and Enter behavior are real Swing. */
public class JBList extends javax.swing.JList<String> {
    public JBList(String[] labels) { super(labels); }
}
