(function () {
  const vscode = acquireVsCodeApi();
  const el = (id) => document.getElementById(id);
  const descriptor = el("descriptor");
  const trustRoot = el("trustRoot");
  const modulePath = el("modulePath");
  let current = null;
  function setBusy(value) {
    for (const button of document.querySelectorAll("button"))
      button.disabled = value;
    if (!value) {
      el("toggle").disabled = !current?.descriptorPath;
      el("replace-test").disabled = current?.deploymentMode !== "test";
    }
  }
  el("browse-descriptor").onclick = () =>
    vscode.postMessage({ type: "browse", target: "descriptor" });
  el("browse-trust").onclick = () =>
    vscode.postMessage({ type: "browse", target: "trustRoot" });
  el("browse-module").onclick = () =>
    vscode.postMessage({ type: "browse", target: "module" });
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
  el("init-test").onclick = () =>
    vscode.postMessage({
      type: "init-test",
      value: { modulePath: modulePath.value.trim() },
    });
  el("replace-test").onclick = () =>
    vscode.postMessage({
      type: "replace-test",
      value: {
        descriptorPath: descriptor.value.trim(),
        trustRootPath: trustRoot.value.trim(),
      },
    });
  window.addEventListener("message", ({ data }) => {
    if (data.type === "busy") setBusy(data.value);
    if (data.type === "picked")
      (data.target === "descriptor"
        ? descriptor
        : data.target === "module"
          ? modulePath
          : trustRoot
      ).value = data.path;
    if (data.type === "notice") {
      el("notice").textContent = data.text;
      el("notice").className = `notice ${data.kind || "info"}`;
    }
    if (data.type === "status") {
      current = data.status;
      descriptor.value = current.descriptorPath || "";
      trustRoot.value = current.trustRootPath || "";
      modulePath.value = current.modulePath || modulePath.value || "";
      el("status").textContent = current.effectiveEnabled ? "已启用" : "未启用";
      el("source").textContent = current.source || "none";
      el("mode").textContent =
        current.deploymentMode === "test"
          ? "TEST（仅限上线前联调）"
          : current.deploymentMode || "none";
      el("verified").textContent = current.verified ? "已通过" : "未通过";
      el("profile").textContent = current.profilePath || "—";
      el("commands").textContent = (current.commands || []).join(", ") || "—";
      el("toggle").textContent = current.profileEnabled ? "停用" : "启用";
      el("toggle").disabled = !current.descriptorPath;
      el("replace-test").disabled = current.deploymentMode !== "test";
      for (const command of ["ask", "agent"]) {
        const row = data.readinessRows?.find(
          (item) => item.command === command,
        );
        el(`readiness-${command}`).textContent =
          `${command}：${row?.summary || "未提供准入诊断"}`;
        el(`readiness-${command}-detail`).textContent =
          row?.detail || "当前 CLI 未提供部署准入诊断，请更新 CLI。";
        el(`readiness-${command}-remediation`).textContent =
          row?.remediation || "";
      }
      if (current.error) {
        el("notice").textContent = current.error;
        el("notice").className = "notice error";
      }
    }
  });
  vscode.postMessage({ type: "ready" });
})();
