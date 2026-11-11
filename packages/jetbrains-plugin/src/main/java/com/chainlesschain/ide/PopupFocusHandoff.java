package com.chainlesschain.ide;

import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Wait for native focus restoration and leave that callback before opening a popup. */
public final class PopupFocusHandoff {
    private PopupFocusHandoff() {}

    public static void schedule(Consumer<Runnable> dispatch,
            Consumer<Runnable> whenFocusSettles, BooleanSupplier isCurrent,
            Runnable open, Runnable stale) {
        Objects.requireNonNull(dispatch);
        Objects.requireNonNull(whenFocusSettles);
        Objects.requireNonNull(isCurrent);
        Objects.requireNonNull(open);
        Objects.requireNonNull(stale);
        // A popup selection can be called from its close/disposal dispatch.
        // Focus restoration can then outlive a single invokeLater. Conversely,
        // the platform may call whenFocusSettles synchronously: opening in that
        // callback can still race its own cleanup, so always dispatch once more.
        dispatch.accept(() -> {
            if (!isCurrent.getAsBoolean()) {
                stale.run();
                return;
            }
            whenFocusSettles.accept(() -> {
                if (!isCurrent.getAsBoolean()) {
                    stale.run();
                    return;
                }
                dispatch.accept(() -> {
                    if (isCurrent.getAsBoolean()) open.run();
                    else stale.run();
                });
            });
        });
    }
}
