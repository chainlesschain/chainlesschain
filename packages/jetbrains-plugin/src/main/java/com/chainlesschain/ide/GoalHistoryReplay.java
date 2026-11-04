package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Explicit single-page recovery. Only the CLI reads credentials and commits checkpoints. */
public final class GoalHistoryReplay implements AutoCloseable {
    public record Selection(String id, String name, String scope, String connection, String checkpoint, String mode) {
        public Selection resume() { return new Selection(id, name, scope, connection, checkpoint, "resume"); }
    }
    public record Binding(String id, String store, long revision, long generation, String name, String scope, String version) { }
    public record Page(Binding binding, boolean hasMore, String text) { }
    public record Outcome(Page page, String message) { }
    private volatile boolean stopped;
    private volatile boolean failed;
    private volatile Process child;
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Invalid goal history result"); }
    private static boolean text(Object value, int max) {
        return value instanceof String s && !s.isEmpty() && s.length() <= max
                && !java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f-\\x9f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]").matcher(s).find();
    }
    private static Map<?, ?> exact(Object value, String... keys) {
        if (!(value instanceof Map<?, ?> map) || !map.keySet().equals(Set.of(keys))) throw invalid();
        return map;
    }
    private static long number(Object value, long min) {
        if (!(value instanceof Number n)) throw invalid();
        double d = n.doubleValue();
        if (!Double.isFinite(d) || d != Math.rint(d) || d < min || d > 9007199254740991d) throw invalid();
        return n.longValue();
    }
    private static Map<?, ?> ref(Object value) {
        Map<?, ?> map = exact(value, "id", "storeId", "revision", "controlGeneration");
        if (!text(map.get("id"),256) || !(map.get("storeId") instanceof String s)
                || !s.matches("project-goals-[a-f0-9-]{36}")) throw invalid();
        number(map.get("revision"),1); number(map.get("controlGeneration"),0); return map;
    }
    private static void date(Object value) { if (!text(value,64)) throw invalid(); Instant.parse((String)value); }
    public static List<String> arguments(Selection selection) {
        if (selection == null || !text(selection.connection(),4096) || !text(selection.checkpoint(),4096)
                || !List.of("new","resume").contains(selection.mode())) throw invalid();
        List<String> args = PluginManager.buildCliGoalPanelsArgs(selection.id(),selection.name(),selection.scope(),null,selection.connection());
        args.set(1,"replay"); args.add("--checkpoint="+selection.checkpoint()); args.add("--checkpoint-mode="+selection.mode());
        return List.copyOf(args);
    }
    /** Call only after CLI exit 0: receiving stdout does not acknowledge checkpoint commit. */
    public static Page parse(byte[] bytes, Selection selection, Binding expected) {
        arguments(selection);
        if (bytes.length > 128*1024) throw invalid();
        try {
            String json = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            Map<?, ?> raw = exact(MiniJson.parse(json), "schema","goalRef","plugin","observedAt","delivery","entries","scannedCount","nextCursor","hasMore","truncated","retainedFrom","highWatermark");
            Map<?, ?> goal = ref(raw.get("goalRef")), plugin = exact(raw.get("plugin"),"name","scope","version");
            if (!"chainlesschain.goal-extension-history/v1".equals(raw.get("schema")) || !"at-least-once".equals(raw.get("delivery"))
                    || !selection.id().equals(goal.get("id")) || !selection.name().equals(plugin.get("name")) || !selection.scope().equals(plugin.get("scope"))
                    || !text(plugin.get("version"),128) || !((String)plugin.get("version")).matches("\\d+\\.\\d+\\.\\d+(?:[-+][A-Za-z0-9.+-]+)?")) throw invalid();
            Binding binding = new Binding(selection.id(),(String)goal.get("storeId"),number(goal.get("revision"),1),number(goal.get("controlGeneration"),0),selection.name(),selection.scope(),(String)plugin.get("version"));
            if (expected != null && !expected.equals(binding)) throw invalid();
            date(raw.get("observedAt"));
            long scanned = number(raw.get("scannedCount"),0), from = number(raw.get("retainedFrom"),1), high = number(raw.get("highWatermark"),0);
            if (!(raw.get("entries") instanceof List<?> entries) || entries.size()>20 || scanned>20 || entries.size()>scanned
                    || from>high+1 || high-from>=1000 || !(raw.get("hasMore") instanceof Boolean more) || !(raw.get("truncated") instanceof Boolean truncated)) throw invalid();
            if (high==0) { if (raw.get("nextCursor")!=null || scanned!=0 || more || truncated || from!=1) throw invalid(); }
            else if (!(raw.get("nextCursor") instanceof String cursor) || !cursor.matches("[A-Za-z0-9_-]{1,2048}")) throw invalid();
            if ((scanned==0 && more) || (truncated && from==1)) throw invalid();
            long prior = from-1; Set<String> ids = new HashSet<>();
            List<String> lines = new ArrayList<>(); lines.add("Retained history for "+selection.id()+"; at-least-once delivery.");
            if (truncated) lines.add("Earlier journal entries are outside retention.");
            for (Object value : entries) {
                Map<?, ?> entry = exact(value,"id","sequence","sourceRef","recordedAt","event"), source = ref(entry.get("sourceRef"));
                Map<?, ?> event = exact(entry.get("event"),"type","goalRef","summary","occurredAt");
                long sequence = number(entry.get("sequence"),1);
                if (!(entry.get("id") instanceof String eventId) || !eventId.matches("goal-event-[a-f0-9]{64}") || !ids.add(eventId)
                        || sequence<=prior || sequence>high || !goal.get("id").equals(source.get("id")) || !goal.get("storeId").equals(source.get("storeId"))
                        || number(source.get("revision"),1)>binding.revision() || number(source.get("controlGeneration"),0)>binding.generation()
                        || !goal.equals(ref(event.get("goalRef"))) || !entry.get("recordedAt").equals(event.get("occurredAt"))
                        || !List.of("risk.review.completed","action.receipt.updated").contains(event.get("type")) || !text(event.get("summary"),4096)) throw invalid();
                date(entry.get("recordedAt")); prior=sequence;
                lines.add(sequence+" "+entry.get("id")+" "+entry.get("recordedAt")+" "+event.get("type")+": "+event.get("summary"));
            }
            lines.add(more ? "More retained history is available; read the next page explicitly." : "Reached this page's watermark. Check again explicitly for newer events.");
            lines.add("CLI exited successfully: checkpoint committed. Records do not prove goal completion.");
            return new Page(binding,more,String.join("\n",lines));
        } catch (Exception error) { throw invalid(); }
    }
    public static String failure(String stderr) {
        if (hasCode(stderr,"GOAL_EVENT_HISTORY_GAP")) return "Checkpoint is outside retained history. Keep it; explicitly select a new checkpoint to start from retained history.";
        if (hasCode(stderr,"GOAL_EVENT_HISTORY_REGRESSED")) return "Database is behind this checkpoint. Keep it and inspect the restored database.";
        if (hasCode(stderr,"GOAL_EVENT_CHECKPOINT_EXISTS")) return "New checkpoint already exists. Choose another new file or explicitly resume the existing one.";
        if (hasCode(stderr,"GOAL_EVENT_CHECKPOINT_MISSING")) return "Resume checkpoint is missing. Select the original file; no replacement was created.";
        if (hasCode(stderr,"GOAL_EVENT_CURSOR_INVALID") || hasCode(stderr,"GOAL_EVENT_CHECKPOINT_BINDING_CONFLICT")) return "Checkpoint does not match the current target, identity or plugin. Keep it and select a matching connection or an explicit new checkpoint.";
        return "Recovery not confirmed. Keep the checkpoint and explicitly resume; it may already have advanced and duplicates are possible.";
    }
    private static boolean hasCode(String stderr,String code) { return java.util.regex.Pattern.compile("\\b"+code+"\\b").matcher(stderr).find(); }
    @Override public void close() { stopped=true; AgentChatSession.destroyTreeForcibly(child); }
    private void read(InputStream input, ByteArrayOutputStream output, int limit) throws Exception {
        byte[] buffer=new byte[4096]; int count;
        while (!stopped && (count=input.read(buffer))!=-1) {
            if (output.size()+count>limit) { failed=true; close(); break; }
            output.write(buffer,0,count);
        }
    }
    /** Blocking on an owned worker. Always reaps before returning an outcome. */
    public Outcome run(String binary, Selection selection, Binding expected, File cwd) {
        List<String> command=AgentChatSession.buildCaptureCommand(binary,arguments(selection),File.separatorChar=='\\');
        if (command.isEmpty()) return new Outcome(null,failure(""));
        var deadline=Executors.newSingleThreadScheduledExecutor(r->{ Thread t=new Thread(r,"cc-goal-history-deadline");t.setDaemon(true);return t; });
        ByteArrayOutputStream output=new ByteArrayOutputStream(), errors=new ByteArrayOutputStream();
        Process process=null; Thread stderr=null; Page page=null;
        try {
            if (stopped) return new Outcome(null,failure(""));
            ProcessBuilder builder=new ProcessBuilder(command); if (cwd!=null) builder.directory(cwd); CliLauncher.augmentPath(builder);
            process=builder.start(); child=process; process.getOutputStream().close();
            if (stopped) { AgentChatSession.destroyTreeForcibly(process); return new Outcome(null,failure("")); }
            deadline.schedule(()->{failed=true;close();},45,TimeUnit.SECONDS);
            Process owned=process;
            stderr=new Thread(()->{ try(InputStream input=owned.getErrorStream()){read(input,errors,65536);}catch(Exception error){failed=true;} },"cc-goal-history-stderr");
            stderr.setDaemon(true); stderr.start();
            try(InputStream input=process.getInputStream()){read(input,output,128*1024);}
            if (!process.waitFor(5,TimeUnit.SECONDS)) { failed=true;close(); }
            stderr.join(1000);
            if (stderr.isAlive()) { failed=true;close(); }
            if (!stopped && !failed && process.exitValue()==0) page=parse(output.toByteArray(),selection,expected);
        } catch(Exception error) { failed=true; }
        finally {
            deadline.shutdownNow();
            if(process!=null) {
                if(process.isAlive())AgentChatSession.destroyTreeForcibly(process);
                try { if(!process.waitFor(5,TimeUnit.SECONDS))failed=true; }catch(InterruptedException error){Thread.currentThread().interrupt();failed=true;}
            }
            child=null;
            if(stderr!=null)try{stderr.join(1000);}catch(InterruptedException error){Thread.currentThread().interrupt();failed=true;}
        }
        return !stopped && !failed && page!=null ? new Outcome(page,null) : new Outcome(null,failure(errors.toString(StandardCharsets.UTF_8)));
    }
}
