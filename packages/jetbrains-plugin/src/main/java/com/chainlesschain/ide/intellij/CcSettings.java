package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.components.PersistentStateComponent;
import com.intellij.openapi.components.State;
import com.intellij.openapi.components.Storage;
import org.jetbrains.annotations.NotNull;

/**
 * Application-level persisted settings for the plugin (Settings → Tools →
 * ChainlessChain IDE, via {@link CcConfigurable}). Stored in
 * {@code chainlesschain-ide.xml} under the IDE config dir.
 *
 * <p>The nested {@link CcState} is deliberately named (not "State") to avoid a
 * clash with the {@code @State} annotation's simple name. {@link #applyToRuntime}
 * pushes the settings the SDK-free pure layer consumes (currently the cc path)
 * into that layer's process-wide state, so a saved path takes effect without an
 * IDE restart.
 */
@State(name = "ChainlessChainIdeSettings", storages = @Storage("chainlesschain-ide.xml"))
public final class CcSettings implements PersistentStateComponent<CcSettings.CcState> {

    /** Serialized fields (public for the IDE's XML (de)serializer). */
    public static final class CcState {
        /** Explicit cc binary/path; blank = auto-detect. */
        public String ccPath = "";
        /** Show the chat panel's context-window indicator. */
        public boolean contextIndicator = true;
    }

    private CcState state = new CcState();

    public static CcSettings getInstance() {
        return ApplicationManager.getApplication().getService(CcSettings.class);
    }

    @Override
    public @NotNull CcState getState() {
        return state;
    }

    @Override
    public void loadState(@NotNull CcState s) {
        this.state = s;
        applyToRuntime();
    }

    public String getCcPath() {
        return state.ccPath == null ? "" : state.ccPath;
    }

    public void setCcPath(String v) {
        state.ccPath = v == null ? "" : v.trim();
        applyToRuntime();
    }

    public boolean isContextIndicatorEnabled() {
        return state.contextIndicator;
    }

    public void setContextIndicatorEnabled(boolean enabled) {
        state.contextIndicator = enabled;
    }

    /** Push runtime-consumed settings into the pure layer (idempotent). */
    public void applyToRuntime() {
        AgentChatSession.setConfiguredBinary(getCcPath());
    }
}
