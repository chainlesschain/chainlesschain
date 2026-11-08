# IntelliJ live-host attempt (2026-11-09)

The repository's live IntelliJ 2024.2 UI-host driver was invoked against the cached IDE distribution. Two bounded attempts were made: the default configured JDK and an isolated JDK 17/IPv4/Gradle-home retry. Both stopped during Gradle preparation before the IDE or Robot host started because the Gradle single-use daemon could not accept a localhost connection (`Connection timed out` / `Could not connect to the Gradle daemon`). The generated journey receipts correctly mark `evidenceComplete:false` and `required-artifact-missing`.

This is stronger current-host evidence than a missing executable check, but it does not count as live IDE acceptance. No repository or remote state was changed by the run.
