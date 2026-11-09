# Current HEAD VS Code real Extension Host rerun (2026-11-09)

The packaged VSIX 0.37.181 was installed into a fresh VS Code 1.145.2 Windows profile and activated. The harness verified a two-root workspace and 19 registered commands. The required bridge lockfile did not appear within 45 seconds, so the real DOM/multi-window journey failed closed before bridge control; diagnostics identify the boundary as bridge startup/self-probe reachability, not VSIX discovery or activation.

This is current Windows host evidence only and does not close bridge loopback, JetBrains, macOS/Linux host, or full IDE/desktop acceptance.
