import java.awt.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import javax.swing.*;
import org.mozilla.javascript.*;
import com.google.gson.*;

public final class SnapshotContract {
    static Path root; static String actual, adapted;
    static final java.util.List<Map<String,Object>> results = new ArrayList<>();
    public static final class RootPanel extends JPanel {
        public RootPanel() { super(null); }
        @Override public boolean isShowing() { return true; }
    }
    public static final class UnavailableListenersButton extends JButton {
        public UnavailableListenersButton(){super("Send");}
        @Override public java.awt.event.ActionListener[] getActionListeners(){throw new IllegalStateException("controlled listener inspection failure");}
    }
    static void check(boolean okay,String message) { if(!okay)throw new AssertionError(message); }
    static JsonObject evaluate(String script,Component[] roots) {
        Context context=Context.enter();
        try {
            context.setOptimizationLevel(-1);
            Scriptable scope=new ImporterTopLevel(context);
            ScriptableObject.putProperty(scope,"roots",Context.javaToJS(roots,scope));
            Object value=context.evaluateString(scope,script,"actual-UiFailureDiagnostics.snapshotScript",1,null);
            check(value instanceof String,"Expected Java String result; got "+value.getClass());
            return JsonParser.parseString((String)value).getAsJsonObject();
        } finally {Context.exit();}
    }
    static JsonObject onEdt(String script,Component[] roots) throws Exception {
        final JsonObject[] output=new JsonObject[1]; final Throwable[] error=new Throwable[1];
        SwingUtilities.invokeAndWait(()->{try{output[0]=evaluate(script,roots);}catch(Throwable t){error[0]=t;}});
        if(error[0]!=null)throw new RuntimeException(error[0]);return output[0];
    }
    interface Case {Object run() throws Exception;}
    static void run(String name,Case action) {
        Map<String,Object> result=new LinkedHashMap<>();result.put("name",name);
        try{result.put("details",action.run());result.put("pass",true);}
        catch(Throwable error){result.put("pass",false);result.put("error",error.toString());}
        results.add(result);
    }
    static JsonObject first(JsonObject report){return report.getAsJsonArray("windows").get(0).getAsJsonObject();}
    public static void main(String[] args) throws Exception {
        root=Path.of(args[0]);Files.createDirectories(root);
        Class<?> generator=Class.forName("com.chainlesschain.ide.uitest.UiFailureDiagnostics",false,SnapshotContract.class.getClassLoader());
        Method method=generator.getDeclaredMethod("snapshotScript");method.setAccessible(true);
        actual=(String)method.invoke(null);Files.writeString(root.resolve("actual-script.js"),actual);
        adapted=actual.replace("var windows=java.awt.Window.getWindows();","var windows=roots;");
        check(!actual.equals(adapted),"Exactly one Window enumeration replacement expected");
        Files.writeString(root.resolve("injected-roots-script.js"),adapted);
        run("unmodified script runs on real EDT and returns JSON String",()->onEdt(actual,new Component[0]));
        run("unmodified script refuses non-EDT",()->{
            try{evaluate(actual,new Component[0]);throw new AssertionError("Non-EDT did not fail");}
            catch(JavaScriptException expected){check(expected.getMessage().contains("require EDT"),expected.toString());return expected.getMessage();}
        });
        run("actual Swing tree geometry, clipping and no action dispatch",()->{
            RootPanel parent=new RootPanel();parent.setBounds(0,0,100,80);
            JButton child=new JButton("Approve Once");child.setBounds(80,10,60,30);parent.add(child);
            int[] actions={0};child.addActionListener(e->actions[0]++);
            Rectangle before=child.getBounds();String beforeText=child.getText();
            JsonObject report=onEdt(adapted,new Component[]{parent});
            JsonObject node=first(report).getAsJsonArray("children").get(0).getAsJsonObject();
            check(node.getAsJsonObject("bounds").get("width").getAsInt()==60,"Lost true bounds");
            check(node.getAsJsonObject("visibleRect").get("width").getAsInt()==20,"Lost parent clipping");
            check(node.has("validateRoot")&&node.has("preferred")&&node.has("showing"),"Missing geometry flags");
            check(child.getBounds().equals(before)&&child.getText().equals(beforeText)&&actions[0]==0,"Snapshot mutated control");
            Files.writeString(root.resolve("geometry.json"),report.toString());return report;
        });
        run("6001-node tree advertises node-limit truncation",()->{
            RootPanel parent=new RootPanel();parent.setBounds(0,0,100,80);
            for(int i=0;i<6000;i++)parent.add(new JPanel());
            JsonObject report=onEdt(adapted,new Component[]{parent});
            Files.writeString(root.resolve("node-limit.json"),report.toString());
            check(report.get("nodes").getAsInt()<=6000,"Node count exceeds limit");
            check(report.get("truncated").getAsBoolean(),"truncated=false despite omitted siblings");
            return Map.of("nodes",report.get("nodes").getAsInt(),"children",first(report).getAsJsonArray("children").size());
        });
        run("unavailable listener inspection is recorded in errors without changing controls",()->{
            RootPanel parent=new RootPanel();parent.setBounds(0,0,100,80);
            JButton send=new UnavailableListenersButton();send.setBounds(0,0,80,26);parent.add(send);
            JsonObject report=onEdt(adapted,new Component[]{parent});
            check(report.getAsJsonArray("errors").size()==1,"Missing inspection error");
            check(report.getAsJsonArray("errors").get(0).getAsJsonObject().get("where").getAsString().startsWith("component:"),"Unexpected error boundary");
            check(send.getText().equals("Send")&&send.getBounds().equals(new Rectangle(0,0,80,26)),"Control changed after diagnostic error");
            return report;
        });
        run("deep tree advertises depth truncation",()->{
            RootPanel parent=new RootPanel();JPanel current=parent;
            for(int i=0;i<60;i++){JPanel next=new JPanel();current.add(next);current=next;}
            JsonObject report=onEdt(adapted,new Component[]{parent});
            check(report.get("truncated").getAsBoolean(),"Depth truncation missing");return Map.of("nodes",report.get("nodes").getAsInt());
        });
        Map<String,Object> report=new LinkedHashMap<>();report.put("scope","Actual generated JS from compiled class, actual Rhino 1.7.15 and Swing EDT, headless. Geometry cases replace only Window.getWindows() with injected roots; RootPanel overrides isShowing. No real Window, IDE, or ConversationView owner instantiated.");report.put("results",results);
        report.put("passed",results.stream().filter(r->Boolean.TRUE.equals(r.get("pass"))).count());report.put("total",results.size());
        Files.writeString(root.resolve("report.json"),new GsonBuilder().setPrettyPrinting().create().toJson(report));
        System.out.println(new Gson().toJson(report));
    }
}
