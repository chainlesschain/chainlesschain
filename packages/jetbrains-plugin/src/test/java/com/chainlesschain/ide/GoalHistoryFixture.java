package com.chainlesschain.ide;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** A real CLI-shaped child for recovery process tests. */
public final class GoalHistoryFixture {
    static Map<String,Object> packet(String id) {
        Map<String,Object> goal=new LinkedHashMap<>(Map.of("id",id,"storeId","project-goals-12345678-1234-1234-1234-123456789abc","revision",2L,"controlGeneration",1L));
        String time="2026-11-04T12:00:00.000Z";
        Map<String,Object> event=new LinkedHashMap<>(Map.of("type","risk.review.completed","goalRef",new LinkedHashMap<>(goal),"summary","<script>Historical observation</script>","occurredAt",time));
        Map<String,Object> entry=new LinkedHashMap<>(Map.of("id","goal-event-"+"a".repeat(64),"sequence",1L,"sourceRef",new LinkedHashMap<>(goal),"recordedAt",time,"event",event));
        Map<String,Object> raw=new LinkedHashMap<>();
        raw.put("schema","chainlesschain.goal-extension-history/v1");raw.put("goalRef",goal);
        raw.put("plugin",new LinkedHashMap<>(Map.of("name","observer","scope","project","version","0.1.0")));
        raw.put("observedAt",time);raw.put("delivery","at-least-once");raw.put("entries",new java.util.ArrayList<>(List.of(entry)));
        raw.put("scannedCount",2L);raw.put("nextCursor","signed_cursor");raw.put("hasMore",true);raw.put("truncated",false);raw.put("retainedFrom",1L);raw.put("highWatermark",3L);
        return raw;
    }
    public static void main(String[] args) throws Exception {
        java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("dmm.fixture.pid")),Long.toString(ProcessHandle.current().pid()));
        String id=args[2];
        System.err.print("NEVER DISPLAY raw private path");
        System.out.print(id.equals("goal-invalid") ? "invalid JSON" : MiniJson.stringify(packet(id)));
        System.out.flush();
        if(id.equals("goal-live"))Thread.sleep(60000);
        if(id.equals("goal-nonzero"))System.exit(1);
    }
}
