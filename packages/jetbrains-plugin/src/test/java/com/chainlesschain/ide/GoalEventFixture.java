package com.chainlesschain.ide;

/** Real protocol child used only by the observer process lifecycle tests. */
public final class GoalEventFixture {
    public static void main(String[] args) throws Exception {
        java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty("dmm.fixture.pid")),Long.toString(ProcessHandle.current().pid()));
        String id=args[2];
        String ref="{\"id\":\""+id+"\",\"storeId\":\"project-goals-12345678-1234-1234-1234-123456789abc\",\"revision\":2,\"controlGeneration\":1}";
        String base="\"schema\":\"chainlesschain.goal-extension-stream/v1\",\"source\":\"desktop-project\",\"plugin\":{\"name\":\"observer\",\"scope\":\"project\",\"version\":\"0.1.0\"},\"observedAt\":\"2026-11-04T12:00:00.000Z\",\"delivery\":\"polling\",\"replay\":false";
        if(id.endsWith("invalid"))System.out.println("{\"key\":\"NEVER DISPLAY\"}");
        else {
            System.out.println("{"+base+",\"kind\":\"ready\",\"goalRef\":"+ref+"}");
            System.out.println("{"+base+",\"kind\":\"event\",\"event\":{\"type\":\"risk.review.completed\",\"goalRef\":"+ref+",\"summary\":\"Real child observation\",\"occurredAt\":\"2026-11-04T12:00:00.000Z\"}}");
        }
        System.out.flush();
        if(!id.endsWith("end"))Thread.sleep(30000);
    }
}
