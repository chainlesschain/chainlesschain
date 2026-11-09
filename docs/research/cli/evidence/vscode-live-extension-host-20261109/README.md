# VS Code live Extension Host attempt (2026-11-09)

The repository's real installed VS Code Extension Host runner launched an isolated VS Code profile, installed the existing `chainlesschain-ide-gap-a3296d55f.vsix`, opened a two-root workspace, and activated the packaged extension. The host and extension activation evidence is complete. The journey then failed when the driver could not connect to the extension's localhost bridge at `127.0.0.1:53123` (`ETIMEDOUT`), so this does not count as a completed VS Code task/recovery journey.

The run used the repository's cached VS Code test distribution and an isolated work directory. No account credentials or provider calls were used, and no repository or remote state was changed. The raw host diagnostics and VSIX digest are preserved with the sanitized journey receipt.
