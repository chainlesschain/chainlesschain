package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import java.io.File;
import java.nio.file.Path;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class GoalTaskCreateExportTest {
    public static class Child {
        public static void main(String[] args) throws Exception {
            switch (args[0]) {
                case "success" -> System.out.print("valid stdout");
                case "nonzero" -> { System.out.print("valid stdout"); System.exit(1); }
                case "oversized" -> System.out.print("x".repeat(20000));
                case "invalid-utf8" -> System.out.write(new byte[]{(byte)0xc3,0x28});
                case "timeout" -> Thread.sleep(60000);
                default -> throw new IllegalArgumentException();
            }
        }
    }
    private String capture(String mode) throws Exception {
        String javaBinary=Path.of(System.getProperty("java.home"),"bin",File.separatorChar=='\\'?"java.exe":"java").toString();
        String classPath=classRoot(Child.class)+File.pathSeparator+classRoot(GoalTaskCreateExport.class);
        return GoalTaskCreateExport.capture(javaBinary,List.of("-cp",classPath,Child.class.getName(),mode),null,mode.equals("timeout")?1000:10000);
    }
    private static Path classRoot(Class<?> type) throws Exception {
        var url=type.getResource(type.getName().substring(type.getName().lastIndexOf('.')+1)+".class");
        if ("jar".equals(url.getProtocol())) {
            String location=url.toURI().getRawSchemeSpecificPart();
            return Path.of(java.net.URI.create(location.substring(0,location.indexOf("!/"))));
        }
        Path root=Path.of(url.toURI()); for(int i=0;i<4;i++)root=root.getParent(); return root;
    }
    @Test void acceptsOutputOnlyAfterZeroExit() throws Exception { assertEquals("valid stdout",capture("success")); }
    @Test void rejectsValidOutputWithNonzeroExit() throws Exception { assertEquals("",capture("nonzero")); }
    @Test void boundsStdoutBeforeParsing() throws Exception { assertEquals("",capture("oversized")); }
    @Test void rejectsInvalidUtf8() throws Exception { assertEquals("",capture("invalid-utf8")); }
    @Test void reapsTimedOutChild() throws Exception { assertEquals("",capture("timeout")); }
}
