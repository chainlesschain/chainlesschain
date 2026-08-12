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
        /**
         * Lean chat context (VS Code {@code chainlesschain.chat.leanContext}
         * parity): inject {@code CC_PROJECT_MEMORY=lean} into the chat panel's
         * {@code cc agent} child so the system prompt keeps only the primary
         * entry file and sheds CLAUDE.local.md / .claude/rules / rules.md.
         */
        public boolean leanContext = true;
        /**
         * Consult the plugin-managed cc copy when every global probe fails
         * (VS Code {@code chainlesschain.cli.managed.enabled} parity). Never
         * applies when an explicit cc path is set.
         */
        public boolean managedCliEnabled = true;
        /** Opt-in automatic ghost text; false prevents surprise model cost. */
        public boolean automaticCompletionEnabled = false;
        public int automaticCompletionDebounceMs = 650;
        public int automaticCompletionMaxRequestsPerHour = 60;
        public int automaticCompletionMaxContextCharsPerHour = 240_000;
        public int automaticCompletionCacheTtlMs = 30_000;
        public int automaticCompletionMaxChars = 800;
        public int automaticCompletionMaxLines = 12;
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

    public boolean isLeanContextEnabled() {
        return state.leanContext;
    }

    public void setLeanContextEnabled(boolean enabled) {
        state.leanContext = enabled;
    }

    public boolean isManagedCliEnabled() {
        return state.managedCliEnabled;
    }

    public void setManagedCliEnabled(boolean enabled) {
        state.managedCliEnabled = enabled;
        applyToRuntime();
    }

    public boolean isAutomaticCompletionEnabled() {
        return state.automaticCompletionEnabled;
    }

    public void setAutomaticCompletionEnabled(boolean enabled) {
        state.automaticCompletionEnabled = enabled;
    }

    public com.chainlesschain.ide.CcAutomaticCompletionPolicy.Options
            getAutomaticCompletionOptions() {
        return new com.chainlesschain.ide.CcAutomaticCompletionPolicy.Options(
                state.automaticCompletionDebounceMs,
                state.automaticCompletionCacheTtlMs,
                64,
                state.automaticCompletionMaxRequestsPerHour,
                state.automaticCompletionMaxContextCharsPerHour,
                state.automaticCompletionMaxChars,
                state.automaticCompletionMaxLines);
    }

    public void setAutomaticCompletionOptions(
            int debounceMs, int maxRequestsPerHour, int maxContextCharsPerHour,
            int cacheTtlMs, int maxChars, int maxLines) {
        state.automaticCompletionDebounceMs = debounceMs;
        state.automaticCompletionMaxRequestsPerHour = maxRequestsPerHour;
        state.automaticCompletionMaxContextCharsPerHour = maxContextCharsPerHour;
        state.automaticCompletionCacheTtlMs = cacheTtlMs;
        state.automaticCompletionMaxChars = maxChars;
        state.automaticCompletionMaxLines = maxLines;
    }

    /** Push runtime-consumed settings into the pure layer (idempotent). */
    public void applyToRuntime() {
        AgentChatSession.setConfiguredBinary(getCcPath());
        // Managed-CLI candidate source: consulted only after every global
        // probe fails, never for an explicit path (both enforced inside
        // AgentChatSession.resolveBinary). Disabled ⇒ no supplier at all.
        AgentChatSession.setManagedCliSupplier(state.managedCliEnabled
                ? com.chainlesschain.ide.ManagedCliRuntime::defaultResolveCommand
                : null);
    }
}
