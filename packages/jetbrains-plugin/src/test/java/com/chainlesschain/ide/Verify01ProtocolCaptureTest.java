package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class Verify01ProtocolCaptureTest {
    @TempDir Path temporary;
    private static Map<String,Object> record(String generation, int sequence, String direction) {
        Map<String,Object> value = new LinkedHashMap<>();
        value.put("generation", generation); value.put("sequence", sequence);
        value.put("direction", direction); value.put("event", Map.of("text", "中文😀"));
        return value;
    }
    @Test void rawRecordsRemainIndependentAndNoFileExistsBeforeObservation() throws Exception {
        var capture = Verify01ProtocolCapture.open(temporary, null);
        try (var files = Files.list(temporary)) { assertEquals(0, files.count()); }
        String id = UUID.randomUUID().toString();
        Map<String,Object> first = record(id, 1, "input");
        capture.onEvent(first); first.put("direction", "mutated");
        capture.onEvent(record(id, 2, "exit"));
        var lines = Files.readAllLines(temporary.resolve("protocol-"+id+".jsonl"));
        assertEquals(2, lines.size());
        assertEquals("input", MiniJson.parseObject(lines.getFirst()).get("direction"));
        assertEquals("exit", MiniJson.parseObject(lines.getLast()).get("direction"));
    }
    @Test void staleFilesAndMissingSequencesFailWithoutLaterExit() throws Exception {
        String id = UUID.randomUUID().toString();
        var capture = Verify01ProtocolCapture.open(temporary, null);
        capture.onEvent(record(id,1,"input"));
        assertThrows(IllegalStateException.class, () -> capture.onEvent(record(id,3,"output")));
        capture.onEvent(record(id,4,"exit"));
        assertEquals(1, Files.readAllLines(temporary.resolve("protocol-"+id+".jsonl")).size());
        var stale = Verify01ProtocolCapture.open(temporary, null);
        assertThrows(IllegalStateException.class, () -> stale.onEvent(record(id,1,"input")));
        assertEquals(1, Files.readAllLines(temporary.resolve("protocol-"+id+".jsonl")).size());
    }
    @Test void taskWorkspaceCannotBeItsOwnEvidenceDirectory() throws Exception {
        assertThrows(java.io.IOException.class, () -> Verify01ProtocolCapture.open(temporary, temporary));
        assertThrows(java.io.IOException.class, () -> Verify01ProtocolCapture.open(Path.of("relative"), null));
    }
}
