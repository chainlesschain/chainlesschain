import java.nio.file.*;
import java.lang.reflect.*;
public final class ExportSnapshot {
    public static void main(String[] args) throws Exception {
        Class<?> c=Class.forName("com.chainlesschain.ide.uitest.UiFailureDiagnostics",false,ExportSnapshot.class.getClassLoader());
        Method m=c.getDeclaredMethod("snapshotScript");m.setAccessible(true);
        Files.writeString(Path.of(args[0]),(String)m.invoke(null));
    }
}
