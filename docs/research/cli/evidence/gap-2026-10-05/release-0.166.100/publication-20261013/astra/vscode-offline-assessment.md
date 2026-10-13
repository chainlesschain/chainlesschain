# VS Code / Open VSX final offline review

PASS. Retained run38331570568/source6a8/tag ide-vscode-v0.37.144/attempt1 evidence binds exactly14 expected jobs:11 success and3 expected JetBrains skips. Five critical Linux publish/verify steps succeeded; three optional Microsoft Marketplace steps were skipped.

Actions artifact archive digest258c81789661f7eccc497a16b5830c97371a3589e59a72b7570900cd12ff2547 matches metadata and receipt. Its embedded candidate is identical to retained candidate.vsix and public.vsix:716016 bytes, SHA256f3a9e5b5e8b221078b4ea1be2846e8cb3a9c5fa284c68a9e42e2a2ce655c6884. All178 ZIP entries match, with independently recomputed canonical content digest e679cf88e4b15cb703241740681a2bb550259c2bae643f3ec7a2a4b14e705b5f. Embedded manifest version0.37.144 and recommended CLI0.166.100 match. Receipt reports exact ready/downloadable/listed/latest state. This verification is offline; no fresh network or test execution occurred.

The previously observed activation404 was followed by the original workflow's successful verification, so no recovery authority or rerun is needed. The release is Open VSX only; Microsoft Marketplace remains outside this tag-push channel.

Archive-script re-review confirms the final requested change: both VS and JB ready branches now compare candidate/public ZIP entry names and every entry byte before archive creation. Syntax check passes. Its pending branch remains JetBrains-only/PENDING_NOT_PUBLIC/publicPackage=null; formal36+9 remain NOT_RUN. The script can archive the two actual receipts after JetBrains readback, retaining whatever genuine ready/pending result it reports. No script or publication mutation was performed by this reviewer.
