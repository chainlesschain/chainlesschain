# Windows scheduler soak failure

Source 1e0272fb491db46c3b46eb03170b67bb7136d132 failed in Windows run 38283485238, job 114926160748. The observed SCHEDULER_LEASE_LOST abort occurred before execute, 690 ms after recorded lease expiry; no target side effect was created. The underlying timing cause is undetermined. This evidence does not establish CPU starvation, database contention, an infrastructure outage or a particular runtime defect. Aggregate invariant fields not reached are not independent failures.

The original log, API responses, ZIP, extracted result, source snapshots and diagnosis are preserved. ZIP bytes match the GitHub artifact digest. No source or test behavior was changed.

Formal evaluation remains NOT_RUN, 0/36 tasks and 0/9 first-run observations. This archive is not release approval. Duplicate source bytes are marked in the manifest and do not count as additional tests. See [summary.json](./summary.json) and [manifest.json](./manifest.json).
