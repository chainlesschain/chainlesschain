package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** Real JUnit 5 coverage for the pure {@link FixWithCc} (diagnostics quick-fix) layer. */
class FixWithCcTest {

    private static final FixWithCc.Diag ERROR =
            new FixWithCc.Diag(12, "Error", "Cannot find symbol foo", "javac", "compiler.err");
    private static final FixWithCc.Diag WARN =
            new FixWithCc.Diag(0, "Warning", "unused\n   import", null, null);

    @Test
    void formatDiagnosticLineIsOneBasedWithSourceAndCode() {
        assertEquals("- [Error] line 13: Cannot find symbol foo (javac compiler.err)",
                FixWithCc.formatDiagnosticLine(ERROR));
    }

    @Test
    void formatDiagnosticLineCollapsesWhitespace() {
        assertEquals("- [Warning] line 1: unused import",
                FixWithCc.formatDiagnosticLine(WARN));
    }

    @Test
    void formatFixPromptReferencesFileWithForwardSlashesAndPlural() {
        String prompt = FixWithCc.formatFixPrompt("src\\Main.java", Arrays.asList(ERROR, WARN));
        assertTrue(prompt.startsWith("Fix the following problems in @src/Main.java"));
        assertTrue(prompt.contains("line 13") && prompt.contains("line 1"));
        assertTrue(prompt.endsWith("\n"));
    }

    @Test
    void formatFixPromptSingularWithNoPathUsesThisFile() {
        String one = FixWithCc.formatFixPrompt("", Arrays.asList(ERROR));
        assertTrue(one.startsWith("Fix the following problem in this file"));
    }

    @Test
    void formatFixPromptEmptyWhenNoDiagnostics() {
        assertEquals("", FixWithCc.formatFixPrompt("x", new ArrayList<FixWithCc.Diag>()));
    }

    @Test
    void buildFixActionTitleCountedAndSingular() {
        assertEquals("Fix 3 problems with ChainlessChain", FixWithCc.buildFixActionTitle(3));
        assertEquals("Fix with ChainlessChain", FixWithCc.buildFixActionTitle(1));
    }
}
