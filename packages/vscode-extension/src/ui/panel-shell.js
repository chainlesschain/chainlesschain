"use strict";
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function panelHtml(vscode, webview, { title, body, script }) {
  const nonce = randomBytes(24).toString("base64");
  const uri = (name) =>
    escapeHtml(
      webview.asWebviewUri(
        vscode.Uri.file(path.join(__dirname, "../../media", name)),
      ),
    );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(webview.cspSource)}; script-src 'nonce-${nonce}';"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${uri("settings-workbench.css")}"></head><body>${body}<script nonce="${nonce}" src="${uri(script)}"></script></body></html>`;
}
function panelOptions(vscode) {
  return {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(__dirname, "../../media"))],
  };
}
module.exports = { panelHtml, panelOptions, escapeHtml };
