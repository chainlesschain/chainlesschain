// Display-only projection of CLI admission. Never authorize a model request here.
export function deploymentReadinessRows(status) {
  return ["ask", "agent"].map((command) => {
    const value = status?.readiness?.[command];
    const admitted = value?.state === "admitted";
    const known =
      value?.scope === "deployment-admission" &&
      value.runtimeVerification === "not_checked" &&
      Array.isArray(value.requiredCommands) &&
      value.requiredCommands.includes(command) &&
      (admitted
        ? value.ready === true && value.taskReady === null
        : [
            "not_configured",
            "disabled",
            "invalid",
            "command_not_allowed",
          ].includes(value.state) &&
          value.ready === false &&
          value.taskReady === false);
    return {
      command,
      state: known ? value.state : "unknown",
      summary: known
        ? admitted
          ? "部署准入通过"
          : "部署准入被阻断"
        : "未提供准入诊断",
      detail:
        known && typeof value.detail === "string"
          ? value.detail
          : "当前 CLI 未提供可识别的部署准入诊断，请更新 CLI。",
      remediation:
        known && typeof value.remediation === "string" ? value.remediation : "",
    };
  });
}

export function replaceDeploymentStatus(target, value) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(
    target,
    {
      source: "none",
      effectiveEnabled: false,
      profileEnabled: false,
      verified: false,
      commands: [],
      readiness: null,
    },
    value || {},
  );
}
