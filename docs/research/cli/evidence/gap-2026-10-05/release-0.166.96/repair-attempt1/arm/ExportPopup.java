import java.lang.reflect.Method;
import java.nio.file.*;
public final class ExportPopup {
    public static void main(String[] args)throws Exception {
        Class<?> driver=Class.forName("com.chainlesschain.ide.uitest.IdeUiSmokeTest",false,ExportPopup.class.getClassLoader());
        Method activation=driver.getDeclaredMethod("popupActivationScript",String.class,boolean.class,String.class,String.class);
        Method receipt=driver.getDeclaredMethod("popupReceiptScript",String.class,boolean.class,String.class,String.class,String.class);
        Method cleanup=driver.getDeclaredMethod("popupReceiptCleanupScript",String.class,String.class);
        activation.setAccessible(true);receipt.setAccessible(true);cleanup.setAccessible(true);
        Files.writeString(Path.of(args[0],"gradle-activation.js"),(String)activation.invoke(null,"Restore code",false,"contract-token","contract-owner"));
        Files.writeString(Path.of(args[0],"gradle-receipt.js"),(String)receipt.invoke(null,"Restore code",false,"contract-token","contract-owner","contract-target"));
        Files.writeString(Path.of(args[0],"gradle-cleanup.js"),(String)cleanup.invoke(null,"contract-token","contract-owner"));
    }
}
