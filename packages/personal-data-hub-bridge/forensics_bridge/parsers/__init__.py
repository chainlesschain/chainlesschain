"""Parser modules — convert raw app SQLite/files into UnifiedSchema NormalizedBatch.

Each parser exposes a top-level function that the dispatcher routes to.
Forked / adapted from upstream sjqz (MIT). Modifications:
  - Strip CLI / report / web layers (sidecar is headless)
  - Return JSON-serializable dicts matching UnifiedSchema, not dataclasses
  - Funnel typed errors through dispatcher.IpcError
"""
