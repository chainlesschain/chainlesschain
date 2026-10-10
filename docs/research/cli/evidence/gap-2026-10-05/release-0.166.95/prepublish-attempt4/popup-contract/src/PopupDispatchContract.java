import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.lang.reflect.Method;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import javax.swing.*;
import org.mozilla.javascript.*;
import com.google.gson.GsonBuilder;
import com.intellij.openapi.application.ApplicationManager;

/** Real generated JS, Rhino and Swing; controlled visibility and IDEA scheduler. */
public final class PopupDispatchContract {
    static final String LABEL = "Restore code + conversation";
    static final String PROPERTY = "cc.uiTest.popupEnter";
    static final List<Map<String,Object>> results = new ArrayList<>();
    static final Map<String,Object> report = new LinkedHashMap<>();
    static Path root;
    static Method generator;
    static Context context;
    static Scriptable scope;

    public static final class ProbeList extends JList<String> {
        public boolean showing = true;
        public int calls;
        public boolean callbackExecuted;
        public String selectedAtAction;
        public String actionCommand;
        public boolean eventSourceBound;
        public final List<String> states = new ArrayList<>();
        public ProbeList(String... labels) {
            super(new DefaultListModel<>());
            for (String label : labels) mutableModel().addElement(label);
            addPropertyChangeListener(PROPERTY, e -> states.add(String.valueOf(e.getNewValue())));
        }
        public DefaultListModel<String> mutableModel() { return (DefaultListModel<String>)getModel(); }
        @Override public boolean isShowing() { return showing; }
        public void enter(boolean hide, boolean fail) {
            registerKeyboardAction(new AbstractAction() {
                @Override public void actionPerformed(ActionEvent event) {
                    check(SwingUtilities.isEventDispatchThread(), "Action must execute on EDT");
                    calls++;
                    selectedAtAction = getSelectedValue();
                    actionCommand = event.getActionCommand();
                    eventSourceBound = event.getSource() == ProbeList.this;
                    if (fail) throw new IllegalStateException("distinct-dispatch-failure-731");
                    if (hide) showing = false;
                    // Intentionally no selected-item callback: dispatch is not callback proof.
                }
            }, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), JComponent.WHEN_ANCESTOR_OF_FOCUSED_COMPONENT);
        }
        public String state() { return String.valueOf(getClientProperty(PROPERTY)); }
    }

    static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    static String script(String label, boolean prefix) throws Exception {
        return (String)generator.invoke(null, label, prefix);
    }
    static void bind(ProbeList list) {
        ScriptableObject.putProperty(scope, "component", Context.javaToJS(list, scope));
    }
    static void schedule(ProbeList list, String label, boolean prefix) throws Exception {
        bind(list);
        context.evaluateString(scope, script(label, prefix), "actual-popupActivationScript", 1, null);
        check(list.calls == 0, "Enter must not execute before deferred dispatch");
        check(list.state().equals("scheduled"), "Expected scheduled state");
    }
    static void drain() { ApplicationManager.getApplication().drain(); }
    static Map<String,Object> record(String name, ProbeList list) {
        Map<String,Object> row = new LinkedHashMap<>();
        row.put("name", name); row.put("passed", true); row.put("states", list.states);
        row.put("calls", list.calls); row.put("showing", list.showing);
        row.put("selectedAtAction", list.selectedAtAction); row.put("eventSourceBound", list.eventSourceBound);
        row.put("callbackExecuted", list.callbackExecuted); row.put("finalState", list.state());
        results.add(row); return row;
    }
    static void denied(String name, ProbeList list, Runnable mutation, String expected) throws Exception {
        schedule(list, LABEL, false); mutation.run(); drain();
        check(list.calls == 0, name + " invoked Enter");
        check(list.state().startsWith("failed:") && list.state().contains(expected), name + " lost reason: " + list.state());
        check(ApplicationManager.getApplication().size() == 0, "Unexpected retry queued");
        record(name, list);
    }
    static void runCases() throws Exception {
        ProbeList one = new ProbeList("Other", LABEL); one.enter(true, false);
        schedule(one, LABEL, false);
        ProbeList two = new ProbeList("partial  turn-2  checkpoint", "Other"); two.enter(true, false);
        schedule(two, "partial  turn-2  ", true);
        ProbeList decoy = new ProbeList(LABEL); decoy.enter(true, false); bind(decoy);
        context.evaluateString(scope, "var target=component,expected='wrong',prefix=false;", "later-request-globals", 1, null);
        check(ApplicationManager.getApplication().size() == 2, "Expected precisely two scheduled actions");
        drain();
        check(one.calls == 1 && two.calls == 1 && decoy.calls == 0, "Original target capture failed");
        check(LABEL.equals(one.selectedAtAction), "Exact label capture failed");
        check("partial  turn-2  checkpoint".equals(two.selectedAtAction), "Prefix capture failed");
        check(one.eventSourceBound && two.eventSourceBound && "Enter".equals(one.actionCommand), "Wrong Swing action event");
        check(one.state().equals("dispatch-returned") && !one.showing, "Success must return and hide");
        check(!one.callbackExecuted, "Harness must not synthesize selected callback");
        record("original-target-exact-captured-across-later-script", one);
        record("second-target-prefix-captured-across-later-script", two);

        ProbeList hidden = new ProbeList(LABEL); hidden.enter(true, false);
        denied("hidden-after-scheduling-rejected", hidden, () -> hidden.showing=false, "Popup cancelled before Enter dispatch");
        ProbeList missing = new ProbeList(LABEL); missing.enter(true, false);
        denied("target-removed-after-scheduling-rejected", missing, () -> missing.mutableModel().clear(), "missing or ambiguous");
        ProbeList duplicate = new ProbeList(LABEL); duplicate.enter(true, false);
        denied("duplicate-target-after-scheduling-rejected", duplicate, () -> duplicate.mutableModel().addElement(LABEL), "missing or ambiguous");
        ProbeList noAction = new ProbeList(LABEL);
        noAction.resetKeyboardActions();
        denied("missing-enter-action-rejected", noAction, () -> {}, "Popup Enter action unavailable");

        ProbeList thrown = new ProbeList(LABEL); thrown.enter(true, true);
        schedule(thrown, LABEL, false); drain();
        check(thrown.calls == 1, "Dispatch exception retried");
        check(thrown.state().startsWith("failed:") && thrown.state().contains("distinct-dispatch-failure-731"), "Dispatch exception lost");
        record("dispatch-exception-preserved-without-retry", thrown);

        ProbeList moved = new ProbeList(LABEL, "Other"); moved.enter(true, false);
        schedule(moved, LABEL, false);
        moved.mutableModel().clear(); moved.mutableModel().addElement("Other"); moved.mutableModel().addElement(LABEL);
        moved.setSelectedIndex(0); drain();
        check(moved.calls == 1 && LABEL.equals(moved.selectedAtAction), "Dispatch did not re-resolve target and select on EDT");
        record("target-moved-and-selection-changed-resolved-at-dispatch", moved);

        ProbeList prefixDuplicate = new ProbeList("partial  turn-2  A", "partial  turn-2  B"); prefixDuplicate.enter(true, false);
        schedule(prefixDuplicate, "partial  turn-2  ", true); drain();
        check(prefixDuplicate.calls == 0 && prefixDuplicate.state().contains("missing or ambiguous"), "Ambiguous prefix accepted");
        record("ambiguous-prefix-rejected", prefixDuplicate);

        ProbeList remains = new ProbeList(LABEL); remains.enter(false, false);
        schedule(remains, LABEL, false); drain();
        check(remains.calls == 1 && remains.state().equals("dispatch-returned") && remains.showing, "Visible return probe incorrect");
        record("dispatch-returned-visible-does-not-meet-driver-close-condition", remains);
        check(ApplicationManager.getApplication().size()==0, "Unexpected queued retry");
    }

    static String sha(Path file) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
    }
    public static void main(String[] args) throws Exception {
        root=Path.of(args[0]).toAbsolutePath();
        Class<?> actual=Class.forName("com.chainlesschain.ide.uitest.IdeUiSmokeTest", false, PopupDispatchContract.class.getClassLoader());
        generator=actual.getDeclaredMethod("popupActivationScript", String.class, boolean.class); generator.setAccessible(true);
        Files.writeString(root.resolve("actual-exact-script.js"), script(LABEL,false));
        Files.writeString(root.resolve("actual-prefix-script.js"), script("partial  turn-2  ",true));
        report.put("generatedAt", java.time.Instant.now().toString());
        report.put("scope", "Actual compiled IdeUiSmokeTest.popupActivationScript; real Rhino 1.7.15 and Swing JList, real EDT, deterministic replacement IDEA scheduler, injected isShowing, headless JVM");
        report.put("realIdeExecuted", false); report.put("realPopupExecuted", false); report.put("originalCiFailureReproduced", false);
        report.put("callbackCompletionProven", false); report.put("sourceSha256", sha(root.resolve("IdeUiSmokeTest.source.java")));
        report.put("compiledClassSha256", sha(root.resolve("IdeUiSmokeTest.class")));
        report.put("exactScriptSha256", sha(root.resolve("actual-exact-script.js")));
        report.put("javaVersion", System.getProperty("java.version"));
        Throwable[] failure = {null};
        SwingUtilities.invokeAndWait(() -> {
            context=Context.enter(); context.setOptimizationLevel(-1);
            scope=context.initStandardObjects();
            try { runCases(); } catch(Throwable error) {failure[0]=error;}
            finally { Context.exit(); }
        });
        report.put("results", results); report.put("passed", failure[0]==null); report.put("caseCount",results.size());
        if(failure[0]!=null) report.put("failure",failure[0].toString());
        Files.writeString(root.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report)+"\n");
        if(failure[0]!=null) throw new AssertionError("Contract harness failed",failure[0]);
        System.out.println("CONTRACT_PASSED="+results.size());
    }
}
