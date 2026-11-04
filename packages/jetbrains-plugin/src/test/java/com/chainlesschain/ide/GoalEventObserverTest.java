package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

final class GoalEventObserverTest {
    private static final String CONNECTION = "C:/private event & connection.json";
    private static final String STORE = "project-goals-12345678-1234-1234-1234-123456789abc";
    private static Map<String,Object> goal() { return new LinkedHashMap<>(Map.of("id","goal-1","storeId",STORE,"revision",2L,"controlGeneration",1L)); }
    private static Map<String,Object> ready() {
        Map<String,Object> value = new LinkedHashMap<>();
        value.put("schema","chainlesschain.goal-extension-stream/v1"); value.put("kind","ready"); value.put("source","desktop-project");
        value.put("plugin",new LinkedHashMap<>(Map.of("name","observer","scope","project","version","0.1.0")));
        value.put("goalRef",goal()); value.put("observedAt","2026-11-04T12:00:00.000Z"); value.put("delivery","polling"); value.put("replay",false); return value;
    }
    private static Map<String,Object> event(String summary) {
        Map<String,Object> value = ready(); value.remove("goalRef"); value.put("kind","event");
        value.put("event",new LinkedHashMap<>(Map.of("type","risk.review.completed","goalRef",goal(),"summary",summary,"occurredAt",value.get("observedAt")))); return value;
    }
    private static byte[] bytes(Map<String,Object> value) { return MiniJson.stringify(value).getBytes(StandardCharsets.UTF_8); }
    private static GoalEventObserver.Decoder decoder() { return new GoalEventObserver.Decoder("goal-1","observer","project",CONNECTION); }
    @Test void fixedArgumentsKeepNativePathsAndBoundedDuration() {
        List<String> args = GoalEventObserver.arguments("goal-1","observer","project",CONNECTION);
        assertEquals(List.of("goal","watch","goal-1"),args.subList(0,3));
        assertTrue(args.contains("--connection="+CONNECTION)); assertTrue(args.contains("--duration=60"));
        assertThrows(IllegalArgumentException.class,()->GoalEventObserver.arguments("../unsafe","observer","project",CONNECTION));
        assertThrows(IllegalArgumentException.class,()->GoalEventObserver.arguments("goal-1","observer","project",null));
    }
    @Test void acceptsReadyThenInertUnicodeSummary() {
        var decoder=decoder(); assertTrue(decoder.accept(bytes(ready())).contains("no history replay"));
        assertTrue(decoder.accept(bytes(event("<script>变化</script>"))).contains("<script>变化</script>")); decoder.finish();
    }
    @Test void rejectsEventsBeforeReadyAndMissingReady() {
        assertThrows(IllegalArgumentException.class,()->decoder().accept(bytes(event("event"))));
        assertThrows(IllegalArgumentException.class,()->decoder().finish());
    }
    @Test void rejectsExtraAuthorityFieldsAndChangedBindings() {
        for (String kind:List.of("key","source","goal","revision","plugin","version","type","time","control","duplicate")) {
            var decoder=decoder(); decoder.accept(bytes(ready())); Map<String,Object> record=event("summary");
            @SuppressWarnings("unchecked") Map<String,Object> event=(Map<String,Object>)record.get("event");
            @SuppressWarnings("unchecked") Map<String,Object> plugin=(Map<String,Object>)record.get("plugin");
            @SuppressWarnings("unchecked") Map<String,Object> ref=(Map<String,Object>)event.get("goalRef");
            switch(kind) {
                case "key":record.put("key","secret");break; case "source":record.put("source","standalone");break;
                case "goal":ref.put("id","another");break; case "revision":ref.put("revision",3L);break;
                case "plugin":plugin.put("name","other");break; case "version":plugin.put("version","0.2.0");break;
                case "type":event.put("type","action.execute");break;case "time":event.put("occurredAt","old");break;
                case "control":event.put("summary","bad\u001b[1m");break;case "duplicate":record=ready();break;
            }
            final Map<String,Object> invalid=record;
            assertThrows(IllegalArgumentException.class,()->decoder.accept(bytes(invalid)),kind);
        }
    }
    @Test void boundsHistoryAndTotalOutputAndRejectsBadUtf8() {
        var decoder=decoder(); decoder.accept(bytes(ready())); String output="";
        for(int i=0;i<80;i++)output=decoder.accept(bytes(event("event-"+i)));
        assertEquals(50,output.split("\n").length); assertFalse(output.contains("event-0\n"));
        assertThrows(IllegalArgumentException.class,()->decoder().accept(new byte[]{(byte)0xff}));
        assertThrows(IllegalArgumentException.class,()->decoder().accept(new byte[16385]));
        final var bounded=decoder(); bounded.accept(bytes(ready()));
        assertThrows(IllegalArgumentException.class,()->{for(int i=0;i<1000;i++)bounded.accept(bytes(event("x".repeat(4096))));});
    }
    @Test void realProcessCancellationReapsTheCliDescendant() throws Exception { processJourney("goal-live","stopped"); }
    @Test void realMalformedProcessIsTerminatedWithoutForwardingItsPayload() throws Exception { processJourney("goal-invalid","unavailable"); }
    @Test void realNaturalProcessEndIsDistinctFromCancellation() throws Exception { processJourney("goal-end","ended"); }
    private void processJourney(String id,String expected) throws Exception {
        var directory=java.nio.file.Files.createTempDirectory("cc-goal-event-process-");
        var marker=directory.resolve("child.pid");
        boolean windows=java.io.File.separatorChar=='\\';
        var javaBinary=java.nio.file.Path.of(System.getProperty("java.home"),"bin",windows?"java.exe":"java").toString();
        var fixtureResource=GoalEventFixture.class.getResource("GoalEventFixture.class");
        assertNotNull(fixtureResource);
        var fixtureRoot=java.nio.file.Path.of(fixtureResource.toURI());
        for(int i=0;i<4;i++)fixtureRoot=fixtureRoot.getParent();
        String classpath=fixtureRoot.toString();
        var shim=directory.resolve(windows?"observer shim.cmd":"observer shim.sh");
        String body=windows ? "@echo off\r\n\""+javaBinary+"\" \"-Ddmm.fixture.pid="+marker+"\" -cp \""+classpath+"\" com.chainlesschain.ide.GoalEventFixture %*\r\n"
                : "#!/bin/sh\nexec "+quote(javaBinary)+" "+quote("-Ddmm.fixture.pid="+marker)+" -cp "+quote(classpath)+" com.chainlesschain.ide.GoalEventFixture \"$@\"\n";
        java.nio.file.Files.writeString(shim,body);
        if(!windows) assertTrue(shim.toFile().setExecutable(true));
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
        var outcome=new java.util.concurrent.atomic.AtomicReference<String>();
        var text=new java.util.concurrent.atomic.AtomicReference<String>("");
        var observed=new java.util.concurrent.CountDownLatch(1);
        var observer=new GoalEventObserver();
        try {
            var running=executor.submit(()->observer.run(shim.toString(),id,"observer","project",CONNECTION,directory.toFile(),
                    value->{text.set(value);if(value.contains("Real child observation"))observed.countDown();},outcome::set));
            if("stopped".equals(expected)) {
                assertTrue(observed.await(10,java.util.concurrent.TimeUnit.SECONDS));
                long pid=Long.parseLong(java.nio.file.Files.readString(marker));
                assertTrue(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
                observer.close();
            }
            running.get(15,java.util.concurrent.TimeUnit.SECONDS);
            assertEquals(expected,outcome.get());
            assertFalse(text.get().contains("NEVER DISPLAY"));
            long pid=Long.parseLong(java.nio.file.Files.readString(marker));
            assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
        } finally {
            observer.close();executor.shutdownNow();
            java.nio.file.Files.deleteIfExists(marker);java.nio.file.Files.deleteIfExists(shim);java.nio.file.Files.deleteIfExists(directory);
        }
    }
    private static String quote(String value) {return "'"+value.replace("'","'\\''")+"'";}
}
