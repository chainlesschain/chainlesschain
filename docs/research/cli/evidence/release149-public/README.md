# CLI 0.166.149 and paired IDE publication evidence

Checked 2026-11-14 (Asia/Shanghai). Immutable release source:
`168a3d561b5a16e9d27b060944c63b2264c99df0`, merged through
[PR #617](https://github.com/chainlesschain/chainlesschain/pull/617) into
`main@47dfaaa99a2fdfd0e71aa86482cddd0088556bc9`.

| Channel   | Version   | Current evidence                                                                                   |
| --------- | --------- | -------------------------------------------------------------------------------------------------- |
| npm CLI   | 0.166.149 | Verified public through Actions OIDC; archive bytes and official provenance passed                 |
| Open VSX  | 0.37.188  | Public, listed and downloadable; independent archive digest matches the official VSIX              |
| JetBrains | 0.4.203   | Official tag workflow passed; uploaded, awaiting Marketplace approval/public download verification |

Both new IDE versions recommend CLI 0.166.149. Verified public JetBrains
0.4.202 retains CLI 0.166.148 pairing until the new channel is verified.

- [gates.json](./gates.json): exact-source CLI CI 76/76 and Strict Sandbox 6/6,
  including all configured Linux, Windows and macOS jobs.
- [cli.json](./cli.json): official immutable archive manifest, public npm
  readback and independent exact byte comparison. The 9,632,233-byte archive
  has SHA-256 `ec7036ec2e8e81a845e059f21c6fa3d106bc9809476ee18667ccfcf103cdbbf7`.
  Cryptographic provenance verification was performed by the official OIDC
  workflow; it was not independently rerun locally.
- [npm-provenance.json](./npm-provenance.json): official workflow receipt binding
  the npm attestation to the exact release tag, source and workflow attempt;
  the signature audit reported zero invalid or missing attestations.
- [open-vsx.json](./open-vsx.json): complete tag workflow and independent
  public registry readback. The 772,316-byte VSIX has SHA-256
  `e139894f26449c44041a61744b0de18378085d427636d393b85acf31be278bbc`.
- [jetbrains.json](./jetbrains.json): official attempt 3 passed 13 jobs, with
  6 other-channel jobs not applicable. Marketplace upload succeeded; independent
  readback still reports `version-not-visible`. The official 1,608,990-byte ZIP
  has SHA-256 `d4b3e47d696b8d8a33a97979e316b6862db7a0604d807b81d47754695efab0ff`.
  Its plugin identity and compiled CLI recommendation were independently checked.
  [Official build artifact](https://github.com/chainlesschain/chainlesschain/actions/runs/43478484313/artifacts/14069240606).
- [publication.json](./publication.json): per-channel status, source identities,
  workflow links, pairing and release limits.

The IDE browser aggregate binds all three producer fragments to one source,
workflow run and run attempt. Runner-acquisition failures require a full IDE
workflow rerun to obtain a coherent three-platform evidence set; failed-only
reruns cannot combine producer evidence across attempts.

This release checks local original catalog/head directory metadata in retained
history. Complete runtime producer/storage graphs, independent installer/pins,
A/B/C evaluation, business effects and automatic promotion remain incomplete.
Production authority and runtime evidence remain false. No additional model-task
acceptance is claimed. **NOT_PAID_READY / NOT_ADMITTED / HOLD** remain.
Public PC/mobile clients remain v5.0.3.145; these IDE tag workflows do not publish
Microsoft Marketplace or new clients.
