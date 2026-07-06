/**
 * PreviewController (slice 2) — spawn dev server, detect the served URL from
 * its output, open it in the browser; idempotent start, stop kills the child.
 * Driven with a fake spawn + fake child, no vscode host.
 */
import { describe, it, expect, vi } from "vitest";
import { PreviewController } from "../../../vscode-extension/src/preview.js";

function makeChild() {
  const handlers = { stdout: [], stderr: [], exit: [] };
  const child = {
    killed: false,
    stdout: { on: (_e, fn) => handlers.stdout.push(fn) },
    stderr: { on: (_e, fn) => handlers.stderr.push(fn) },
    on: (e, fn) => {
      if (e === "exit") handlers.exit.push(fn);
    },
    kill: () => {
      child.killed = true;
    },
    _emitStdout: (s) => handlers.stdout.forEach((fn) => fn(s)),
    _emitStderr: (s) => handlers.stderr.forEach((fn) => fn(s)),
    _emitExit: (code) => handlers.exit.forEach((fn) => fn(code)),
  };
  return child;
}

function makeController(pkg, { child } = {}) {
  const opened = [];
  const statuses = [];
  const theChild = child || makeChild();
  const spawn = vi.fn(() => theChild);
  const ctrl = new PreviewController({
    spawn,
    openUrl: (u) => opened.push(u),
    readPackageJson: () => pkg,
    onStatus: (s) => statuses.push(s),
  });
  return { ctrl, opened, statuses, spawn, child: theChild };
}

describe("PreviewController.start", () => {
  it("picks the dev script, spawns it, and opens the URL once detected", () => {
    const { ctrl, opened, statuses, spawn, child } = makeController({
      scripts: { dev: "vite" },
    });
    const res = ctrl.start("/ws");
    expect(res).toEqual({ started: true, script: "dev" });
    expect(spawn).toHaveBeenCalledWith("dev", "/ws");
    expect(statuses[0]).toMatchObject({ state: "starting", script: "dev" });

    child._emitStdout("VITE ready\n  ➜  Local: http://localhost:5173/\n");
    expect(opened).toEqual(["http://localhost:5173/"]);
    expect(ctrl.url).toBe("http://localhost:5173/");
    expect(statuses.at(-1)).toMatchObject({
      state: "ready",
      url: "http://localhost:5173/",
    });
  });

  it("detects a URL printed on stderr too, and only opens once", () => {
    const { ctrl, opened, child } = makeController({
      scripts: { start: "next dev" },
    });
    ctrl.start("/ws");
    child._emitStderr("started server on http://localhost:3000\n");
    child._emitStdout("compiled http://localhost:3000\n"); // second hit ignored
    expect(opened).toEqual(["http://localhost:3000"]);
  });

  it("errors cleanly when there is no dev script", () => {
    const { ctrl, opened, statuses, spawn } = makeController({
      scripts: { build: "vite build" },
    });
    expect(ctrl.start("/ws")).toEqual({ error: "no-dev-script" });
    expect(spawn).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({ state: "error" });
  });

  it("is idempotent: a second start re-opens the known URL without respawning", () => {
    const { ctrl, opened, spawn, child } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    child._emitStdout("Local: http://localhost:5173/\n");
    const res = ctrl.start("/ws");
    expect(res).toMatchObject({ already: true, url: "http://localhost:5173/" });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([
      "http://localhost:5173/",
      "http://localhost:5173/",
    ]);
  });

  it("an unsolicited exit is reported as a crash (with code + script)", () => {
    const { ctrl, statuses, child } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    expect(ctrl.running).toBe(true);
    child._emitExit(1); // dev server died on its own
    expect(ctrl.running).toBe(false);
    expect(ctrl.child).toBe(null);
    expect(statuses.at(-1)).toMatchObject({
      state: "crashed",
      code: 1,
      script: "dev",
    });
  });
});

describe("PreviewController.stop", () => {
  it("kills the child and resets state", () => {
    const { ctrl, child, statuses } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    ctrl.stop();
    expect(child.killed).toBe(true);
    expect(ctrl.running).toBe(false);
    expect(ctrl.url).toBe(null);
    expect(statuses.at(-1)).toMatchObject({ state: "stopped" });
  });

  it("a stop()-triggered exit stays 'stopped' (no spurious crash)", () => {
    const { ctrl, child, statuses } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    ctrl.stop(); // emits "stopped"
    child._emitExit(0); // the kill makes the child exit afterwards
    expect(statuses.filter((s) => s.state === "crashed")).toHaveLength(0);
    expect(statuses.at(-1)).toMatchObject({ state: "stopped" });
  });

  it("is safe to call with nothing running", () => {
    const { ctrl } = makeController({ scripts: {} });
    expect(() => ctrl.stop()).not.toThrow();
  });
});

describe("PreviewController stop uses the injected kill (process-tree kill seam)", () => {
  it("routes stop() through the injected kill with the running child", () => {
    const child = makeChild();
    const killed = [];
    const ctrl = new PreviewController({
      spawn: () => child,
      readPackageJson: () => ({ scripts: { dev: "vite" } }),
      kill: (c) => killed.push(c),
    });
    ctrl.start("/ws");
    ctrl.stop();
    expect(killed).toEqual([child]); // tree-killer got the child, not child.kill()
    expect(child.killed).toBe(false); // default child.kill() was NOT used
  });

  it("defaults to child.kill() when no kill dep is given", () => {
    const child = makeChild();
    const ctrl = new PreviewController({
      spawn: () => child,
      readPackageJson: () => ({ scripts: { dev: "vite" } }),
    });
    ctrl.start("/ws");
    ctrl.stop();
    expect(child.killed).toBe(true);
  });
});

describe("PreviewController line framing (carry buffer)", () => {
  it("detects a URL split across two stdout chunks", () => {
    const { ctrl, opened, child } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    // The URL straddles a chunk boundary — each half alone never matches, so
    // per-chunk splitting (the old behavior) would miss it forever.
    child._emitStdout("  ➜  Local:   http://localh");
    expect(opened).toEqual([]); // partial line must NOT be probed yet
    child._emitStdout("ost:5173/\n");
    expect(opened).toEqual(["http://localhost:5173/"]);
  });

  it("keeps stdout and stderr carry buffers separate (no cross-stream corruption)", () => {
    const { ctrl, opened, child } = makeController({
      scripts: { dev: "vite" },
    });
    ctrl.start("/ws");
    child._emitStdout("  ➜  Local:   http://localh"); // partial on stdout…
    child._emitStderr("some warning\n"); // …stderr traffic in between
    child._emitStdout("ost:5173/\n"); // stdout completes its own line
    expect(opened).toEqual(["http://localhost:5173/"]);
  });
});
