import java.nio.file.*;
import java.lang.reflect.Method;
public final class ExportActual {
    public static void main(String[] args) throws Exception {
        Class<?> type=Class.forName("com.chainlesschain.ide.uitest.IdeUiSmokeTest",false,ExportActual.class.getClassLoader());
        Method method=type.getDeclaredMethod("popupActivationScript",String.class,boolean.class);
        method.setAccessible(true);
        Files.writeString(Path.of(args[0]),(String)method.invoke(null,"Restore code + conversation",false));
    }
}
