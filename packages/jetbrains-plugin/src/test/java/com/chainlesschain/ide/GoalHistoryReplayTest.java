package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

final class GoalHistoryReplayTest {
    private static GoalHistoryReplay.Selection selection(String id) { return new GoalHistoryReplay.Selection(id,"observer","project","C:/private & connection.json","C:/checkpoint.json","new"); }
    private static byte[] bytes(Map<String,Object> raw) { return MiniJson.stringify(raw).getBytes(StandardCharsets.UTF_8); }
    @Test void fixedArgumentsRequireExplicitNativeSelection() {
        var input=selection("goal-1");var args=GoalHistoryReplay.arguments(input);
        assertEquals(List.of("goal","replay","goal-1"),args.subList(0,3));assertTrue(args.contains("--checkpoint-mode=new"));assertTrue(args.contains("--checkpoint="+input.checkpoint()));
        assertEquals("resume",input.resume().mode());
        assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.arguments(selection("../bad")));
        assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.arguments(new GoalHistoryReplay.Selection("goal-1","observer","project","connection","checkpoint","auto")));
    }
    @Test @SuppressWarnings("unchecked") void acceptsFilteredGapsAndPinsBinding() {
        var raw=GoalHistoryFixture.packet("goal-1");var page=GoalHistoryReplay.parse(bytes(raw),selection("goal-1"),null);
        assertTrue(page.text().contains("<script>"));
        var entries=(List<Object>)raw.get("entries");var next=new LinkedHashMap<>((Map<String,Object>)entries.get(0));next.put("id","goal-event-"+"b".repeat(64));next.put("sequence",3L);entries.add(next);
        assertNotNull(GoalHistoryReplay.parse(bytes(raw),selection("goal-1"),page.binding()));
        ((Map<String,Object>)raw.get("plugin")).put("version","0.2.0");
        assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.parse(bytes(raw),selection("goal-1"),page.binding()));
    }
    @Test @SuppressWarnings("unchecked") void rejectsMalformedAuthorityAndSequenceBounds() {
        for(String kind:List.of("schema","extra","plugin","goal","revision","generation","duplicate","order","outside","source","type","summary","time","cursor","count","retention","more","empty")) {
            var raw=GoalHistoryFixture.packet("goal-1");var entries=(List<Object>)raw.get("entries");var entry=(Map<String,Object>)entries.get(0);
            var event=(Map<String,Object>)entry.get("event");var source=(Map<String,Object>)entry.get("sourceRef");
            switch(kind) {
                case "schema":raw.put("schema","wrong");break;case "extra":raw.put("key","secret");break;
                case "plugin":((Map<String,Object>)raw.get("plugin")).put("name","other");break;
                case "goal":((Map<String,Object>)raw.get("goalRef")).put("id","other");break;
                case "revision":source.put("revision",3L);break;case "generation":source.put("controlGeneration",2L);break;
                case "duplicate":entries.add(new LinkedHashMap<>(entry));break;case "order":entry.put("sequence",0L);break;
                case "outside":entry.put("sequence",4L);break;case "source":source.put("id","other");break;
                case "type":event.put("type","action.execute");break;case "summary":event.put("summary","bad\u001b");break;
                case "time":event.put("occurredAt","old");break;case "cursor":raw.put("nextCursor","invalid cursor");break;
                case "count":raw.put("scannedCount",21L);break;case "retention":raw.put("highWatermark",1001L);break;
                case "more":raw.put("scannedCount",0L);raw.put("entries",new ArrayList<>());break;case "empty":raw.put("highWatermark",0L);break;
            }
            assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.parse(bytes(raw),selection("goal-1"),null),kind);
        }
    }
    @Test void acceptsEmptyJournalButRejectsInvalidUtf8AndOversize() {
        var raw=GoalHistoryFixture.packet("goal-1");raw.put("entries",List.of());raw.put("scannedCount",0L);raw.put("highWatermark",0L);raw.put("hasMore",false);raw.put("nextCursor",null);
        assertFalse(GoalHistoryReplay.parse(bytes(raw),selection("goal-1"),null).hasMore());
        assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.parse(new byte[]{(byte)255},selection("goal-1"),null));
        assertThrows(IllegalArgumentException.class,()->GoalHistoryReplay.parse(new byte[128*1024+1],selection("goal-1"),null));
    }
    @Test void errorMappingNeverForwardsRawPayloads() {
        for(String code:List.of("GOAL_EVENT_HISTORY_GAP","GOAL_EVENT_HISTORY_REGRESSED","GOAL_EVENT_CHECKPOINT_EXISTS","GOAL_EVENT_CHECKPOINT_MISSING","GOAL_EVENT_CHECKPOINT_BINDING_CONFLICT"))
            assertFalse(GoalHistoryReplay.failure("NEVER DISPLAY "+code).contains("NEVER DISPLAY"));
        assertTrue(GoalHistoryReplay.failure("private path").contains("may already have advanced"));
    }
    @Test void realSuccessfulChildCommitsOnlyAfterExit() throws Exception { processJourney("goal-end",true,false); }
    @Test void realValidStdoutWithNonzeroExitIsNotSuccess() throws Exception { processJourney("goal-nonzero",false,false); }
    @Test void realInvalidPacketIsNotSuccess() throws Exception { processJourney("goal-invalid",false,false); }
    @Test void realCancellationReapsCliAndRetainsUnknownCheckpointOutcome() throws Exception { processJourney("goal-live",false,true); }
    private void processJourney(String id,boolean success,boolean cancel) throws Exception {
        var directory=java.nio.file.Files.createTempDirectory("cc-goal-history-");var marker=directory.resolve("child.pid");
        boolean windows=java.io.File.separatorChar=='\\';
        var javaBinary=java.nio.file.Path.of(System.getProperty("java.home"),"bin",windows?"java.exe":"java").toString();
        var fixtureRoot=java.nio.file.Path.of(GoalHistoryFixture.class.getResource("GoalHistoryFixture.class").toURI());
        for(int i=0;i<4;i++)fixtureRoot=fixtureRoot.getParent();
        // MiniJson is a production class; include its output root too.
        var mainResource=MiniJson.class.getResource("MiniJson.class");
        java.nio.file.Path mainRoot;
        if ("jar".equals(mainResource.getProtocol())) {
            String location=mainResource.toURI().getRawSchemeSpecificPart();
            mainRoot=java.nio.file.Path.of(java.net.URI.create(location.substring(0,location.indexOf("!/"))));
        }
        else { mainRoot=java.nio.file.Path.of(mainResource.toURI()); for(int i=0;i<4;i++)mainRoot=mainRoot.getParent(); }
        String classpath=fixtureRoot+java.io.File.pathSeparator+mainRoot;
        var shim=directory.resolve(windows?"history shim.cmd":"history shim.sh");
        String body=windows ? "@echo off\r\n\""+javaBinary+"\" \"-Ddmm.fixture.pid="+marker+"\" -cp \""+classpath+"\" com.chainlesschain.ide.GoalHistoryFixture %*\r\n"
                : "#!/bin/sh\nexec "+quote(javaBinary)+" "+quote("-Ddmm.fixture.pid="+marker)+" -cp "+quote(classpath)+" com.chainlesschain.ide.GoalHistoryFixture \"$@\"\n";
        java.nio.file.Files.writeString(shim,body);if(!windows)assertTrue(shim.toFile().setExecutable(true));
        var executor=java.util.concurrent.Executors.newSingleThreadExecutor();var replay=new GoalHistoryReplay();
        try {
            var result=executor.submit(()->replay.run(shim.toString(),selection(id),null,directory.toFile()));
            if(cancel) {
                long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(10);
                while(!java.nio.file.Files.exists(marker) && System.nanoTime()<deadline)Thread.sleep(20);
                assertTrue(java.nio.file.Files.exists(marker));assertFalse(result.isDone());replay.close();
            }
            var outcome=result.get(15,java.util.concurrent.TimeUnit.SECONDS);assertEquals(success,outcome.page()!=null);
            assertFalse(String.valueOf(outcome).contains("NEVER DISPLAY"));
            long pid=Long.parseLong(java.nio.file.Files.readString(marker));assertFalse(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));
        } finally {replay.close();executor.shutdownNow();java.nio.file.Files.deleteIfExists(marker);java.nio.file.Files.deleteIfExists(shim);java.nio.file.Files.deleteIfExists(directory);}
    }
    private static String quote(String value) {return "'"+value.replace("'","'\\''")+"'";}
}
