package com.chainlesschain.ide;

import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class WorkspaceMentionIndexPerformanceTest {
    @Test
    void profiles100kPathsAndRapidQueries() throws Exception {
        WorkspaceMentionIndexPerformanceProfile.Evidence evidence =
                WorkspaceMentionIndexPerformanceProfile.measure();
        String output = System.getenv("CC_IDE_INPUT_PERF_JETBRAINS_EVIDENCE");
        if (output != null && !output.isBlank()) {
            WorkspaceMentionIndexPerformanceProfile.write(Path.of(output), evidence);
        }
    }
}
