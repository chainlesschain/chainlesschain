# CLI 0.166.142 / DMM release record

Prepared 2026-11-05. Publication status: **pending**.

Candidate versions: Session Core **0.3.25**, CLI **0.166.142**, Open VSX
**0.37.178**, JetBrains **0.4.195**. The required release order is changed child
packages → CLI → both IDEs → mobile/PC. npm authentication uses the existing
GitHub Actions OIDC Trusted Publishing workflow only.

Source work starts from `4032b29349`; feature branch
`feature/dmm-goal-events-replay-20261104` has been pushed. The immutable release
source, PR, exact-SHA matrix runs and public readback results will be recorded
after they exist. No old matrix or local-only result authorizes publication.

Local preparation passed 93 tests across five files, JetBrains metadata checks,
public IDE capability-manifest checks and command registry/help/completion checks.
The independent [DMM-08 engineering batch](../../../agents/evidence/dmm-delivery-assistant-2026-11-04/README.md)
passed 245 tests with one POSIX-only skip on Windows. Historical batches are not
summed with these results. These are not release-commit CI evidence.

Feature scope: separately authorized goal observations, a transactional retained
event journal and signed cursor, durable one-page replay/checkpoint modes,
explicit IDE recovery and a data-only combined delivery scenario. Native approval
remains authoritative. Replay is at least once; records and description edits do
not establish goal completion. Real GUI and business-effect acceptance remain
separate from package publication.
