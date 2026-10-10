import java.awt.event.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import javax.swing.*;
import org.mozilla.javascript.*;
import com.google.gson.GsonBuilder;
import com.intellij.openapi.application.ApplicationManager;

/** Actual exported scripts, Rhino 1.7.15, real Swing EDT and component removal. */
public final class PopupReceiptContract {
    static Method activate, poll, cleanup;
    static Context cx;
    static Scriptable scope;
    static Path out;
    static final String LABEL = "Restore code";
    static final List<Map<String,Object>> results = new ArrayList<>();
    static final String OWNER_LOOKUP = "var window = javax.swing.SwingUtilities.getWindowAncestor(target);"
            + "while (window != null && !(window instanceof java.awt.Frame)) window = window.getOwner();"
            + "if (window == null) throw new Error('Popup frame unavailable');var root = window.getRootPane();";

    public static final class Receiver extends JPanel {
        final JRootPane stableRoot;
        Receiver(JRootPane root) { stableRoot = root; }
        @Override public JRootPane getRootPane() { return stableRoot; }
    }
    public static final class PopupList extends JList<String> {
        int calls;
        boolean fixtureDisposed;
        PopupList(boolean hide, boolean fail) {
            super(new String[]{LABEL});
            registerKeyboardAction(new AbstractAction() {
                @Override public void actionPerformed(ActionEvent event) {
                    check(SwingUtilities.isEventDispatchThread(), "action outside EDT");
                    check(event.getSource() == PopupList.this, "wrong action target");
                    check(LABEL.equals(getSelectedValue()), "wrong selected item");
                    calls++;
                    if (fail) throw new IllegalStateException("contract-enter-failure");
                    if (hide) { getParent().remove(PopupList.this); removeNotify(); fixtureDisposed = true; }
                }
            }, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER,0), WHEN_ANCESTOR_OF_FOCUSED_COMPONENT);
        }
        @Override public boolean isShowing() { return getParent() != null && !fixtureDisposed; }
        public void resolveFixture() {
            if (fixtureDisposed) throw new IllegalStateException("the component is not available");
        }
    }
    record Binding(JRootPane root, Receiver receiver, PopupList list, String token, String owner, String target) {
        Properties receipt() { return (Properties)root.getClientProperty("cc.uiTest.popupEnter."+token); }
    }
    static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
    static String script(Method method,Object... args)throws Exception { return (String)method.invoke(null,args); }
    static void bind(Object component) { ScriptableObject.putProperty(scope,"component",Context.javaToJS(component,scope)); }
    static String eval(String text) { return Context.toString(cx.evaluateString(scope,text,"actual-generated-script",1,null)); }
    static Binding start(boolean hide,boolean fail)throws Exception {
        return start(new JRootPane(),hide,fail);
    }
    static Binding start(JRootPane root,boolean hide,boolean fail)throws Exception {
        Receiver receiver=new Receiver(root); PopupList list=new PopupList(hide,fail);
        new JPanel().add(list); String token=UUID.randomUUID().toString(),owner=String.valueOf(System.identityHashCode(root));
        ScriptableObject.putProperty(scope,"testOwnerRoot",Context.javaToJS(root,scope));bind(list);
        String original=script(activate,LABEL,false,token,owner);
        check(original.indexOf(OWNER_LOOKUP)>=0 && original.indexOf(OWNER_LOOKUP)==original.lastIndexOf(OWNER_LOOKUP),"owner adaptation drift");
        String target=eval(original.replace(OWNER_LOOKUP,"var root = testOwnerRoot;"));
        check(list.calls==0,"action was not deferred");
        return new Binding(root,receiver,list,token,owner,target);
    }
    static String state(Binding b)throws Exception { bind(b.receiver);return eval(script(poll,LABEL,false,b.token,b.owner,b.target)); }
    static void clear(Binding b)throws Exception {bind(b.receiver);eval(script(cleanup,b.token,b.owner));check(b.receipt()==null,"receipt leak");}
    record Released(Receiver receiver,String token,String owner,String target,java.lang.ref.WeakReference<PopupList> list) {}
    static Released releaseTarget()throws Exception {
        Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(b.receiver);
        return new Released(b.receiver,b.token,b.owner,b.target,new java.lang.ref.WeakReference<>(b.list));
    }
    static void rejected(String script)throws Exception {
        try {eval(script);throw new AssertionError("invalid binding accepted");}catch(RhinoException expected){check(expected.getMessage().contains("Popup receipt"),"unexpected failure: "+expected);}
    }
    interface Case { void run()throws Exception; }
    static void test(String name,Case task)throws Exception {task.run();results.add(Map.of("name",name,"passed",true));}
    static void run()throws Exception {
        test("disposed popup fixture cannot resolve; stable receiver reads scalar dispatch receipt",()->{
            Binding b=start(true,false);check("scheduled|visible".equals(state(b)),"wrong scheduled state");
            ApplicationManager.getApplication().drain();
            check(b.list.getParent()==null && b.list.fixtureDisposed,"popup not actually removed");
            try{b.list.resolveFixture();throw new AssertionError("stale fixture unexpectedly resolves");}catch(IllegalStateException expected){}
            check(b.list.calls==1,"Enter count");check("dispatch-returned|hidden".equals(state(b)),"stable receipt failed after disposal");
            for(var entry:b.receipt().entrySet())check(entry.getKey() instanceof String && entry.getValue() instanceof String,"receipt retains object reference");
            clear(b);
        });
        test("wrong nonce cannot read another invocation",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(b.receiver);rejected(script(poll,LABEL,false,"other-token",b.owner,b.target));clear(b);});
        test("tampered token rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();b.receipt().setProperty("token","other");bind(b.receiver);rejected(script(poll,LABEL,false,b.token,b.owner,b.target));b.receipt().setProperty("token",b.token);clear(b);});
        test("wrong stable owner rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(new Receiver(new JRootPane()));rejected(script(poll,LABEL,false,b.token,b.owner,b.target));clear(b);});
        test("receipt owner binding rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();b.receipt().setProperty("owner","other");bind(b.receiver);rejected(script(poll,LABEL,false,b.token,b.owner,b.target));clear(b);});
        test("wrong target identity rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(b.receiver);rejected(script(poll,LABEL,false,b.token,b.owner,"other"));clear(b);});
        test("wrong target label rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(b.receiver);rejected(script(poll,"Restore conversation",false,b.token,b.owner,b.target));clear(b);});
        test("wrong match mode rejected",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();bind(b.receiver);rejected(script(poll,LABEL,true,b.token,b.owner,b.target));clear(b);});
        test("nonterminal stages with hidden popup cannot satisfy success",()->{Binding b=start(true,false);ApplicationManager.getApplication().drain();for(String stage:List.of("scheduled","entered","validated","unknown")){b.receipt().setProperty("stage",stage);check(!"dispatch-returned|hidden".equals(state(b)),"nonterminal accepted");}clear(b);});
        test("returned Enter with visible popup cannot satisfy success",()->{Binding b=start(false,false);ApplicationManager.getApplication().drain();check("dispatch-returned|visible".equals(state(b)),"wrong visible result");clear(b);});
        test("Enter failure remains failure and never succeeds",()->{Binding b=start(true,true);ApplicationManager.getApplication().drain();check(state(b).startsWith("failed:"),"failure suppressed");check(b.list.calls==1,"retry occurred");clear(b);});
        test("removed before dispatch fails once without activation",()->{Binding b=start(true,false);b.list.getParent().remove(b.list);b.list.removeNotify();b.list.fixtureDisposed=true;ApplicationManager.getApplication().drain();check(state(b).startsWith("failed:"),"cancel accepted");check(b.list.calls==0,"cancelled action dispatched");clear(b);});
        test("same-owner independent tokens do not consume each other receipts",()->{JRootPane root=new JRootPane();Binding a=start(root,true,false),b=start(root,true,false);ApplicationManager.getApplication().drain();check("dispatch-returned|hidden".equals(state(a)),"first missing");check("dispatch-returned|hidden".equals(state(b)),"second missing");bind(a.receiver);rejected(script(poll,LABEL,false,a.token,a.owner,b.target));clear(a);check("dispatch-returned|hidden".equals(state(b)),"cleanup crossed token");clear(b);});
        test("receipt remains readable after disposed list is garbage collected",()->{
            Released r=releaseTarget();
            for(int i=0;i<30 && r.list.get()!=null;i++){System.gc();Thread.sleep(10);}
            check(r.list.get()==null,"receipt or scheduler retained disposed list");
            bind(r.receiver);check("dispatch-returned|hidden".equals(eval(script(poll,LABEL,false,r.token,r.owner,r.target))),"readback depends on live list");
            eval(script(cleanup,r.token,r.owner));
        });
    }
    public static void main(String[] args)throws Exception {
        out=Path.of(args[0]);Class<?> driver=Class.forName("com.chainlesschain.ide.uitest.IdeUiSmokeTest",false,PopupReceiptContract.class.getClassLoader());
        activate=driver.getDeclaredMethod("popupActivationScript",String.class,boolean.class,String.class,String.class);activate.setAccessible(true);
        poll=driver.getDeclaredMethod("popupReceiptScript",String.class,boolean.class,String.class,String.class,String.class);poll.setAccessible(true);
        cleanup=driver.getDeclaredMethod("popupReceiptCleanupScript",String.class,String.class);cleanup.setAccessible(true);
        Files.writeString(out.resolve("actual-activation.js"),script(activate,LABEL,false,"contract-token","contract-owner"));
        Files.writeString(out.resolve("actual-receipt.js"),script(poll,LABEL,false,"contract-token","contract-owner","contract-target"));
        Files.writeString(out.resolve("actual-cleanup.js"),script(cleanup,"contract-token","contract-owner"));
        SwingUtilities.invokeAndWait(()->{cx=Context.enter();try{cx.setOptimizationLevel(-1);scope=cx.initStandardObjects();run();}catch(Exception e){throw new RuntimeException(e);}finally{Context.exit();}});
        var report=new LinkedHashMap<String,Object>();report.put("passed",results.size());report.put("cases",results);report.put("engine","Rhino 1.7.15; real Swing EDT; headless");report.put("adaptations",List.of("ApplicationManager scheduler replaced with controlled EDT queue","Only popup owner Window lookup replaced with real injected JRootPane; receipt and cleanup scripts unmodified","Popup visibility tied to real parent attachment; Enter physically removes component and calls removeNotify; disposed Robot fixture lookup simulated"));report.put("limits",List.of("No GUI/IDE launched; real 3900 host artifact supplies failure evidence","This contract does not replace next-menu/preview/confirmation assertions or exact-head CI"));Files.writeString(out.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));
    }
}
