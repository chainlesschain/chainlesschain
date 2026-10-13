# Final three-site deployment offline review

PASS: retained evidence supports documentation/website deployment and public readback completed for source `d898d4e04d036bc51909d24f24e58842af568ce6`.

- Exact dispatch38336873726 completed successfully; job115098840423's actual `git log -1` output matches d898, independently of API head_sha.
- All56 cached HTTP responses rehash to recorded bytes/SHA256 and status200.17 HTML,35 build-resource responses and3 source manifests match corresponding local build bytes/inventories. The remaining response is existing `/u/script.js` analytics: availability-only, with no static-build identity claim.
- Three deployment tarballs match predeploy/remote/public receipt SHA256 and sizes. Tar manifests agree with local source manifests and source d898. HTML counts are636 docs,279 design,20 website; total packaged file counts1937/865/37 include two deployment metadata files per site.
- deploy.sh SHA256 matches the remote receipt. Retained server stdout confirms three tar checksum checks, staging, live swaps and DEPLOYMENT_COMPLETE.
- Actual preservedFiles is empty. Only website `.well-known` operational content was retained from server. Logos were already build artifacts; no claim is made that seven logos were copied back from the server. Retention allowlisting is policy, not an executed preservation event.
- Initial failed readback directory retains12 HTML responses. Its analytics classification error is historical evidence; the later successful receipt correctly separates the analytics proxy from build resources. No failed observation is overwritten or reclassified as a success.

The source manifests retain JB0.4.161 public and candidate0.4.162 PENDING_NOT_PUBLIC. Three-site completion does not imply JetBrains approval or public ZIP availability. Formal36+9 remain NOT_RUN; PR436 budget development remains outside runtime release. CLI/OpenVSX public release verification stays distinct from documentation deployment.

This audit was offline only: no website request, SSH, merge, deployment, test rerun or source change. It substantiates the retained deployed/public-byte observations, not browser interaction, accessibility, or full native acceptance.
