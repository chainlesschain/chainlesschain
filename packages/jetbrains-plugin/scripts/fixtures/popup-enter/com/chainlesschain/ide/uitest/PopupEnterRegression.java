package com.chainlesschain.ide.uitest;

import com.intellij.openapi.application.ApplicationManager;
import java.awt.Window;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.util.Properties;
import javax.swing.AbstractAction;
import javax.swing.JFrame;
import javax.swing.JLayeredPane;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JWindow;
import javax.swing.KeyStroke;
import javax.swing.SwingUtilities;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;

/** Executes the production-generated scripts in Rhino against real owned Swing windows. */
public final class PopupEnterRegression {
    private static int passed;

    public static void main(String[] args) throws Exception {
        run("fresh lookup selects replacement that appeared before discovery", f -> {
            Popup old = f.popup("other", "partial  turn-2  checkpoint");
            old.window.dispose();
            Popup current = f.popup("other", "partial  turn-2  checkpoint");
            current.next = () -> f.popup("Summarize from here");
            String target = f.activate("partial  turn-2  ", true, "timeline");
            equal(id(current.list), target);
            equal(1, current.list.getSelectedIndex());
            equal(1, ApplicationManager.getApplication().pendingCount());
            ApplicationManager.getApplication().runNext();
            equal(0, old.actions);
            equal(1, current.actions);
            equal("dispatch-returned|hidden", f.receipt("partial  turn-2  ", true, "timeline", target));
            String next = f.activate("Summarize from here", false, "actions");
            check(!next.isEmpty(), "the actual Enter action must show the next UI stage");
            ApplicationManager.getApplication().runNext();
            equal("dispatch-returned|hidden", f.receipt("Summarize from here", false, "actions", next));
            f.eval(PopupEnterScripts.cleanup("timeline", f.owner));
            equal(null, f.frame.getRootPane().getClientProperty("cc.uiTest.popupEnter.timeline"));
        });
        run("cancellation after scheduling fails without an action", f -> {
            Popup popup = f.popup("Restore code");
            String target = f.activate("Restore code", false, "cancel");
            popup.window.dispose();
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "cancel", target).startsWith("failed:Error: Popup cancelled"), "cancellation must fail");
            equal(0, popup.actions);
        });
        run("lightweight popup layer is selected without matching a normal tool-window list", f -> {
            JBList normal = new JBList(new String[]{"Restore code"});
            f.frame.getContentPane().add(normal);
            f.frame.validate();
            equal("", f.activate("Restore code", false, "normal-list"));
            LightPopup popup = new LightPopup(f.frame, "Restore code");
            String target = f.activate("Restore code", false, "lightweight");
            equal(id(popup.list), target);
            ApplicationManager.getApplication().runNext();
            equal(1, popup.actions);
            equal("dispatch-returned|hidden", f.receipt("Restore code", false, "lightweight", target));
        });
        run("cancelled lightweight popup fails before Enter", f -> {
            LightPopup popup = new LightPopup(f.frame, "Restore code");
            String target = f.activate("Restore code", false, "light-cancel");
            f.frame.getLayeredPane().remove(popup.surface);
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "light-cancel", target).contains("failed:Error: Popup cancelled"), "lightweight cancellation must fail");
            equal(0, popup.actions);
        });
        run("replacement after scheduling cannot inherit the old activation", f -> {
            Popup old = f.popup("Restore code");
            String target = f.activate("Restore code", false, "replace");
            old.window.dispose();
            Popup replacement = f.popup("Restore code");
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "replace", target).startsWith("failed:"), "replacement must not recover cancellation");
            equal(0, old.actions);
            equal(0, replacement.actions);
        });
        run("wrong frame identity and foreign popup cannot dispatch", f -> {
            JFrame other = frame();
            Popup foreign = new Popup(other, "Restore code");
            expectFailure(() -> f.eval(PopupEnterScripts.activate("Restore code", false, "bad-owner", "wrong")), "owner mismatch");
            equal("", f.activate("Restore code", false, "foreign"));
            equal(0, foreign.actions);
            equal(0, ApplicationManager.getApplication().pendingCount());
        });
        run("moving the scheduled list to another owner fails", f -> {
            Popup popup = f.popup("Restore code");
            String target = f.activate("Restore code", false, "moved-owner");
            JWindow foreign = new JWindow(frame());
            foreign.add(popup.list);
            foreign.setBounds(-20000, -20000, 240, 120);
            foreign.setFocusableWindowState(false);
            foreign.setVisible(true);
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "moved-owner", target).contains("failed:Error: Popup owner changed"), "must retain the original owner");
            equal(0, popup.actions);
        });
        run("missing Enter action fails without invoking a fallback", f -> {
            Popup popup = f.popup("Restore code");
            popup.list.getInputMap(JList.WHEN_FOCUSED).put(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), "missing-enter-action");
            String target = f.activate("Restore code", false, "no-enter");
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "no-enter", target).contains("failed:Error: Popup Enter action unavailable"), "must require the chooser Enter action");
            equal(0, popup.actions);
        });
        run("duplicate labels within one popup fail before scheduling", f -> {
            Popup popup = f.popup("Restore code", "Restore code");
            expectFailure(() -> f.activate("Restore code", false, "duplicate"), "Ambiguous popup item");
            equal(0, popup.actions);
            equal(0, ApplicationManager.getApplication().pendingCount());
        });
        run("two owned matching popups fail before scheduling", f -> {
            Popup first = f.popup("Restore code");
            Popup second = f.popup("Restore code");
            expectFailure(() -> f.activate("Restore code", false, "ambiguous"), "Ambiguous popup item");
            equal(0, first.actions + second.actions);
        });
        run("new ambiguity before deferred dispatch fails", f -> {
            Popup first = f.popup("Restore code");
            String target = f.activate("Restore code", false, "later-ambiguity");
            Popup second = f.popup("Restore code");
            ApplicationManager.getApplication().runNext();
            check(f.receipt("Restore code", false, "later-ambiguity", target).contains("failed:Error: Ambiguous"), "must revalidate uniqueness");
            equal(0, first.actions + second.actions);
        });
        run("receipt completion does not synthesize the next UI stage", f -> {
            Popup popup = f.popup("partial  turn-2  checkpoint");
            String target = f.activate("partial  turn-2  ", true, "no-next");
            ApplicationManager.getApplication().runNext();
            equal(1, popup.actions);
            equal("dispatch-returned|hidden", f.receipt("partial  turn-2  ", true, "no-next", target));
            equal("", f.activate("Summarize from here", false, "missing-actions"));
            equal(0, ApplicationManager.getApplication().pendingCount());
        });
        run("wrong label and receipt bindings cannot report success", f -> {
            f.popup("Restore code");
            equal("", f.activate("Restore conversation", false, "wrong-label"));
            String target = f.activate("Restore code", false, "binding");
            expectFailure(() -> f.receipt("Restore code", false, "binding", "different-target"), "binding mismatch");
            expectFailure(() -> f.receipt("Restore conversation", false, "binding", target), "binding mismatch");
            expectFailure(() -> f.eval(PopupEnterScripts.receipt("Restore code", false, "binding", "wrong-owner", target)), "owner mismatch");
            Properties receipt = (Properties) f.frame.getRootPane().getClientProperty("cc.uiTest.popupEnter.binding");
            receipt.setProperty("token", "other-token");
            expectFailure(() -> f.receipt("Restore code", false, "binding", target), "binding mismatch");
            expectFailure(() -> f.eval(PopupEnterScripts.cleanup("binding", f.owner)), "binding mismatch");
        });
        run("script quoting preserves exact labels and tokens", f -> {
            String label = "Restore \"quoted\" \\ path\nline";
            Popup popup = f.popup(label);
            String target = f.activate(label, false, "token\"\\\n");
            ApplicationManager.getApplication().runNext();
            equal(1, popup.actions);
            equal("dispatch-returned|hidden", f.receipt(label, false, "token\"\\\n", target));
        });
        System.out.println("Popup Enter Rhino/Swing regression: " + passed + " passed");
    }

    private static void run(String name, Scenario test) throws Exception {
        Throwable[] failure = new Throwable[1];
        SwingUtilities.invokeAndWait(() -> {
            try { test.run(new Fixture()); }
            catch (Throwable error) { failure[0] = error; }
            finally {
                ApplicationManager.getApplication().clear();
                for (Window window : Window.getWindows()) window.dispose();
            }
        });
        if (failure[0] != null) throw new AssertionError(name, failure[0]);
        passed++;
        System.out.println("PASS " + name);
    }

    private static JFrame frame() {
        JFrame frame = new JFrame("Popup script regression");
        frame.setBounds(-20000, -20000, 300, 200);
        frame.setFocusableWindowState(false);
        frame.setVisible(true);
        return frame;
    }

    private static String id(Object value) { return String.valueOf(System.identityHashCode(value)); }
    private static void equal(Object expected, Object actual) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError("Expected " + expected + "; actual " + actual);
    }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static void expectFailure(Runnable action, String expected) {
        try { action.run(); }
        catch (RuntimeException error) {
            check(error.getMessage().contains(expected), "Wrong failure: " + error);
            return;
        }
        throw new AssertionError("Expected failure: " + expected);
    }
    private interface Scenario { void run(Fixture fixture); }

    private static final class Fixture {
        final JFrame frame = frame();
        final String owner = id(frame.getRootPane());
        Popup popup(String... labels) { return new Popup(frame, labels); }
        String activate(String label, boolean prefix, String token) {
            return eval(PopupEnterScripts.activate(label, prefix, token, owner));
        }
        String receipt(String label, boolean prefix, String token, String target) {
            return eval(PopupEnterScripts.receipt(label, prefix, token, owner, target));
        }
        String eval(String script) {
            Context context = Context.enter();
            try {
                Scriptable scope = context.initStandardObjects();
                ScriptableObject.putProperty(scope, "component", Context.javaToJS(frame, scope));
                return Context.toString(context.evaluateString(scope, script, "generated-popup-script", 1, null));
            } finally { Context.exit(); }
        }
    }

    public static final class JBList extends JList<String> {
        public JBList(String[] labels) { super(labels); }
    }

    /** Real lightweight Swing hierarchy, as used by PopupFactory in POPUP_LAYER. */
    private static final class LightPopup {
        final JPanel surface = new JPanel(new java.awt.BorderLayout());
        final JBList list;
        int actions;
        LightPopup(JFrame owner, String... labels) {
            list = new JBList(labels);
            list.registerKeyboardAction(new AbstractAction() {
                @Override public void actionPerformed(ActionEvent event) {
                    check(event.getSource() == list, "Enter source must be the lightweight list");
                    actions++;
                    owner.getLayeredPane().remove(surface);
                }
            }, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), JList.WHEN_FOCUSED);
            surface.add(list);
            surface.setBounds(0, 0, 240, 120);
            owner.getLayeredPane().add(surface, JLayeredPane.POPUP_LAYER);
            surface.doLayout();
            check(list.isShowing(), "lightweight list must be showing in its frame");
        }
    }

    private static final class Popup {
        final JWindow window;
        final JBList list;
        int actions;
        Runnable next;
        Popup(JFrame owner, String... labels) {
            window = new JWindow(owner);
            list = new JBList(labels);
            list.registerKeyboardAction(new AbstractAction() {
                @Override public void actionPerformed(ActionEvent event) {
                    check(event.getSource() == list, "Enter source must be the selected list");
                    equal("Enter", event.getActionCommand());
                    actions++;
                    window.dispose();
                    if (next != null) next.run();
                }
            }, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), JList.WHEN_FOCUSED);
            window.add(list);
            window.setBounds(-20000, -20000, 240, 120);
            window.setFocusableWindowState(false);
            window.setVisible(true);
        }
    }
}
