package com.chainlesschain.ide.intellij;

import com.intellij.DynamicBundle;
import org.jetbrains.annotations.Nls;
import org.jetbrains.annotations.NonNls;
import org.jetbrains.annotations.PropertyKey;

/**
 * Runtime message bundle — the Java-side twin of the VS Code extension's
 * {@code vscode.l10n.t}. Resolves user-facing dialog/notification strings from
 * {@code messages/CcBundle.properties} (English base) + {@code CcBundle_zh}
 * (Chinese) by key, so an English IDE shows English and a 中文 IDE shows 中文.
 *
 * <p>Lives in {@code .intellij} (not the pure {@code com.chainlesschain.ide}
 * package) because it depends on the platform's {@link DynamicBundle}; the pure
 * layers stay SDK-free, so their few display strings are localized at the glue
 * call-site via {@link #message} instead.
 */
public final class CcBundle extends DynamicBundle {
    @NonNls
    public static final String BUNDLE = "messages.CcBundle";
    private static final CcBundle INSTANCE = new CcBundle();

    private CcBundle() {
        super(BUNDLE);
    }

    public static @Nls String message(
            @PropertyKey(resourceBundle = BUNDLE) String key, Object... params) {
        return INSTANCE.getMessage(key, params);
    }
}
