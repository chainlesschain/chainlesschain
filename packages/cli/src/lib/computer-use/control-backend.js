/**
 * Computer-use OS control backend. The default backend drives Windows via
 * PowerShell + .NET (System.Windows.Forms / System.Drawing) with zero npm
 * deps; every primitive is a small injectable `runPowerShell` call so the
 * server logic is testable without a display. POSIX support is a documented
 * gap (returns an unsupported error) — the Windows-first host matches the
 * project's U-Key/hardware posture.
 */

import executionBroker from "../process-execution-broker/index.js";

export const _deps = {
  spawnSync: (...args) => executionBroker.spawnSync(...args),
  platform: () => process.platform,
};

/** Run a PowerShell script, returning { ok, stdout, stderr }. */
function runPowerShell(script, deps = _deps) {
  const res = deps.spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      origin: "computer-use:powershell",
      scope: "computer-use",
      policy: "allow",
      shell: false,
    },
  );
  if (res.error) return { ok: false, stdout: "", stderr: res.error.message };
  return {
    ok: res.status === 0,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };
}

// PowerShell script fragments kept as constants so tests can assert the backend
// dispatches the right one per verb without a real display.
export const PS = {
  screenshot: (outPath) => `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$bmp.Save(${JSON.stringify(outPath)}, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "$($b.Width)x$($b.Height)"`,
  windowList: `
Get-Process | Where-Object { $_.MainWindowTitle } |
  Select-Object -Property Id, ProcessName, MainWindowTitle |
  ConvertTo-Json -Compress`,
  clipboardRead: `Get-Clipboard -Raw`,
  clipboardWrite: (text) =>
    `Set-Clipboard -Value ${JSON.stringify(String(text))}`,
  click: (x, y) => `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Number(x)}, ${Number(y)})
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int e);' -Name U -Namespace W
[W.U]::mouse_event(0x02,0,0,0,0); [W.U]::mouse_event(0x04,0,0,0,0)`,
  type: (text) => `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${JSON.stringify(escapeSendKeys(String(text)))})`,
  scroll: (amount) => `
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int e);' -Name S -Namespace W
[W.S]::mouse_event(0x0800,0,0,${Number(amount) * 120},0)`,
};

/** SendKeys treats +^%~(){}[] as control chars — escape literals in braces. */
export function escapeSendKeys(text) {
  return text.replace(/[+^%~(){}\[\]]/g, (ch) => `{${ch}}`);
}

export function createWindowsBackend(deps = _deps) {
  const ps = (script) => runPowerShell(script, deps);
  const unsupported = (verb) => ({
    ok: false,
    error: `computer-use ${verb} is only implemented on Windows in this build`,
  });
  const guard = (verb, fn) =>
    deps.platform() === "win32" ? fn() : unsupported(verb);

  return {
    platform: deps.platform(),
    screenshot(outPath) {
      return guard("screenshot", () => {
        const r = ps(PS.screenshot(outPath));
        return r.ok
          ? { ok: true, path: outPath, size: r.stdout.trim() }
          : { ok: false, error: r.stderr || "screenshot failed" };
      });
    },
    windowList() {
      return guard("window_list", () => {
        const r = ps(PS.windowList);
        if (!r.ok)
          return { ok: false, error: r.stderr || "window list failed" };
        try {
          const parsed = r.stdout.trim() ? JSON.parse(r.stdout) : [];
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          return {
            ok: true,
            windows: rows.map((w) => ({
              pid: w.Id,
              app: w.ProcessName,
              title: w.MainWindowTitle,
            })),
          };
        } catch {
          return { ok: false, error: "could not parse window list" };
        }
      });
    },
    clipboardRead() {
      return guard("clipboard_read", () => {
        const r = ps(PS.clipboardRead);
        return r.ok
          ? { ok: true, text: r.stdout.replace(/\r?\n$/, "") }
          : { ok: false, error: r.stderr || "clipboard read failed" };
      });
    },
    clipboardWrite(text) {
      return guard("clipboard_write", () => {
        const r = ps(PS.clipboardWrite(text));
        return r.ok ? { ok: true } : { ok: false, error: r.stderr };
      });
    },
    click(x, y) {
      return guard("click", () => {
        const r = ps(PS.click(x, y));
        return r.ok ? { ok: true, x, y } : { ok: false, error: r.stderr };
      });
    },
    type(text) {
      return guard("type", () => {
        const r = ps(PS.type(text));
        return r.ok ? { ok: true } : { ok: false, error: r.stderr };
      });
    },
    scroll(amount) {
      return guard("scroll", () => {
        const r = ps(PS.scroll(amount));
        return r.ok ? { ok: true } : { ok: false, error: r.stderr };
      });
    },
    appLaunch(app, args = []) {
      return guard("app_launch", () => {
        const res = deps.spawnSync(app, args, {
          windowsHide: false,
          detached: true,
          stdio: "ignore",
          origin: "computer-use:app-launch",
          scope: "computer-use",
          policy: "allow",
          shell: false,
        });
        return res.error
          ? { ok: false, error: res.error.message }
          : { ok: true, app };
      });
    },
  };
}
