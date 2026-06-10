/**
 * Sidebar tree view for the IDE bridge (Activity Bar → ChainlessChain IDE).
 * Three sections: status, the 4 tools, and the recent tool-call log. Refreshed
 * whenever the bridge state or activity log changes.
 */
function timeStr(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class IdeBridgeTreeProvider {
  /**
   * @param {*} vscode
   * @param {() => {port:number, workspaceFolders?:string[], toolCount?:number}} getState
   * @param {{recent:(n:number)=>any[]}} activityLog
   */
  constructor(vscode, getState, activityLog) {
    this.vscode = vscode;
    this.getState = getState;
    this.log = activityLog;
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(el) {
    return el;
  }

  getChildren(el) {
    const vscode = this.vscode;
    const C = vscode.TreeItemCollapsibleState;

    if (!el) {
      const s = this.getState() || {};
      const running = s.port > 0;

      const status = new vscode.TreeItem(
        running ? `运行中 · 端口 ${s.port}` : "已停止",
        C.None,
      );
      status.iconPath = new vscode.ThemeIcon(
        running ? "pass-filled" : "circle-slash",
      );
      status.description = running ? `${s.toolCount || 0} 次调用` : "";
      status.contextValue = "status";

      const ws = new vscode.TreeItem("工作区", C.Collapsed);
      ws.iconPath = new vscode.ThemeIcon("folder");
      ws.contextValue = "workspace";

      const tools = new vscode.TreeItem("工具 (4)", C.Collapsed);
      tools.iconPath = new vscode.ThemeIcon("tools");
      tools.contextValue = "tools";

      const act = new vscode.TreeItem("最近调用", C.Expanded);
      act.iconPath = new vscode.ThemeIcon("history");
      act.contextValue = "activity";

      return [status, ws, tools, act];
    }

    if (el.contextValue === "workspace") {
      const s = this.getState() || {};
      const folders = s.workspaceFolders || [];
      if (!folders.length) {
        return [leaf(vscode, "(无工作区)", "circle-outline")];
      }
      return folders.map((f) => leaf(vscode, f, "folder-opened"));
    }

    if (el.contextValue === "tools") {
      const descs = {
        getSelection: "当前选区",
        getDiagnostics: "诊断/报错",
        getOpenEditors: "打开的文件",
        openDiff: "原生 diff 评审",
      };
      return Object.keys(descs).map((n) => {
        const t = leaf(vscode, n, "symbol-method");
        t.description = descs[n];
        return t;
      });
    }

    if (el.contextValue === "activity") {
      const recent = this.log.recent(25);
      if (!recent.length) return [leaf(vscode, "暂无调用", "circle-outline")];
      return recent.map((e) => {
        const failed = e.ok === false;
        const label =
          e.type === "tool" ? `${e.tool}${failed ? " ✗" : ""}` : "client 连接";
        const t = leaf(
          vscode,
          label,
          failed ? "error" : e.type === "connect" ? "plug" : "arrow-small-right",
        );
        const summ = e.argsSummary || (failed ? e.error : "");
        t.description = [timeStr(e.ts), summ].filter(Boolean).join("  ");
        t.tooltip = summ || label;
        return t;
      });
    }

    return [];
  }
}

function leaf(vscode, label, icon) {
  const t = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  if (icon) t.iconPath = new vscode.ThemeIcon(icon);
  return t;
}

module.exports = { IdeBridgeTreeProvider };
