; ChainlessChain custom NSIS installer hooks
;
; Fixes the "ChainlessChain 无法关闭，请手动关闭它，然后单击重试以继续"
; manual-retry dialog that appears when an instance of ChainlessChain.exe is
; running while the installer (or electron-updater) tries to overwrite the
; binary. electron-builder's default NSIS template surfaces the file-busy
; check as a Retry/Cancel prompt — it does not auto-kill.
;
; We hook `preInit` (runs at the very start of .onInit, BEFORE the install
; wizard pages and the file-extraction section) and force-terminate any
; running ChainlessChain.exe process tree. The same kill is repeated in
; `customInit` to catch any process the user may have re-launched between
; .onInit and the file-busy check.

!macro killRunningApp
  ; /F = force, /IM = by image name. We intentionally do NOT pass /T:
  ; during auto-update, electron-updater spawns this installer as a child
  ; of the running ChainlessChain.exe, and /T would cascade-kill the
  ; installer itself. Only ChainlessChain.exe holds the lock on its own
  ; binary (subprocesses lock their own images, not the parent .exe).
  ; Exit code is non-zero when the process isn't running — ignore it.
  nsExec::Exec 'taskkill /F /IM "ChainlessChain.exe"'
  Pop $0
  ; Brief pause so Windows releases the .exe file handle before file write.
  Sleep 800
!macroend

!macro preInit
  !insertmacro killRunningApp
!macroend

!macro customInit
  !insertmacro killRunningApp
!macroend

!macro customUnInit
  !insertmacro killRunningApp
!macroend
