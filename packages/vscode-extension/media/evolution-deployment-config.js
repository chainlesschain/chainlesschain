(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  const descriptor = el("descriptor");
  const trustRoot = el("trustRoot");
  let current = null;
  function setBusy(value) {
    for (const button of document.querySelectorAll("button"))
      button.disabled = value;
    if (!value) el("toggle").disabled = !current?.descriptorPath;
  }
  el("browse-descriptor").onclick = () =>
    vscode.postMessage({ type: "browse", target: "descriptor" });
  el("browse-trust").onclick = () =>
    vscode.postMessage({ type: "browse", target: "trustRoot" });
  el("reload").onclick = () => vscode.postMessage({ type: "reload" });
  el("save").onclick = () =>
    vscode.postMessage({
      type: "save",
      value: {
        descriptorPath: descriptor.value.trim(),
        trustRootPath: trustRoot.value.trim(),
      },
    });
  el("toggle").onclick = () => vscode.postMessage({ type: "toggle" });
  window.addEventListener("message", ({ data }) => {
    if (data.type === "busy") setBusy(data.value);
    if (data.type === "picked")
      (data.target === "descriptor" ? descriptor : trustRoot).value = data.path;
    if (data.type === "notice") {
      el("notice").textContent = data.text;
      el("notice").className = `notice ${data.kind || "info"}`;
    }
    if (data.type === "status") {
      current = data.status;
      descriptor.value = current.descriptorPath || "";
      trustRoot.value = current.trustRootPath || "";
      el("status").textContent = current.effectiveEnabled ? "已启用" : "未启用";
      el("source").textContent = current.source || "none";
      el("verified").textContent = current.verified ? "已通过" : "未通过";
      el("profile").textContent = current.profilePath || "—";
      el("commands").textContent = (current.commands || []).join(", ") || "—";
      el("toggle").textContent = current.profileEnabled ? "停用" : "启用";
      el("toggle").disabled = !current.descriptorPath;
      if (current.error) {
        el("notice").textContent = current.error;
        el("notice").className = "notice error";
      }
    }
  });
  vscode.postMessage({ type: "ready" });
})();
