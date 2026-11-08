"use strict";
const { randomUUID } = require("node:crypto");
const {
  ProjectGoalTransferService,
} = require("@chainlesschain/session-core/project-goal-transfer");
const {
  upgradeLegacyGoal,
  goalError,
} = require("@chainlesschain/session-core/goal-contract");
const {
  digestBusinessObjectContent,
} = require("@chainlesschain/session-core/business-object-contract");
const {
  validateGoalTransfer,
  validateGoalImportTarget,
} = require("@chainlesschain/session-core/goal-transfer-contract");
const {
  readTransferJsonFile,
  writeTransferJsonFile,
} = require("@chainlesschain/session-core/goal-transfer-files");

function params(input, required, optional = []) {
  try {
    digestBusinessObjectContent(input);
  } catch {
    throw goalError("GOAL_INVALID_REQUEST");
  }
  if (
    !input ||
    Array.isArray(input) ||
    required.some((k) => !Object.hasOwn(input, k)) ||
    Object.keys(input).some((k) => ![...required, ...optional].includes(k))
  )
    throw goalError("GOAL_INVALID_REQUEST");
}
function visible(value) {
  return JSON.stringify(value, null, 2).replace(
    /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
function writeReceipt(file, value, validator) {
  try {
    writeTransferJsonFile(file, value);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (
      digestBusinessObjectContent(
        readTransferJsonFile(file, validator, 4096),
      ) !== digestBusinessObjectContent(value)
    )
      throw goalError("GOAL_TRANSFER_OUTPUT_EXISTS");
  }
}

function createProjectGoalTransferHost({ capture, dialog, clock = Date.now }) {
  function context(event) {
    const pinned = capture(event),
      service = new ProjectGoalTransferService({
        db: pinned.db,
        getActor: pinned.getActor,
        clock,
      });
    return { ...pinned, service };
  }
  return {
    list(event, input) {
      params(input, ["projectId", "afterId"]);
      return context(event).service.list(input);
    },
    async exportTarget(event, input) {
      params(input, ["projectId"], ["requestId"]);
      const c = context(event),
        initial = c.service.adapter.describeProject(input.projectId);
      const saved = await dialog().showSaveDialog(c.parent, {
        title: "导出 CLI 目标导入凭据",
        defaultPath: "goal-import-target.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      c.getActor();
      if (saved.canceled || !saved.filePath) return { state: "cancelled" };
      const choice = await dialog().showMessageBox(c.parent, {
        type: "question",
        title: "准备 CLI 目标移交",
        message: "允许将一个 CLI 目标移交到当前个人项目？",
        detail: `项目：${visible(initial.projectRef)}\n\nCLI 将保留原始备份并冻结源目标。导入后目标保持暂停，授权、记忆、调度和完成证明需要重新设置。只可在导入目标尚无后续数据时回退；失败或超时不自动恢复源目标。`,
        buttons: ["取消", "导出导入凭据"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      c.getActor();
      if (choice.response !== 1) return { state: "cancelled" };
      const current = c.service.adapter.describeProject(input.projectId);
      if (
        digestBusinessObjectContent(current) !==
        digestBusinessObjectContent(initial)
      )
        throw goalError("GOAL_PROJECT_VERSION_CONFLICT");
      const result = c.service.prepare({
        projectId: input.projectId,
        requestId: input.requestId ?? `transfer-${randomUUID()}`,
      });
      writeReceipt(saved.filePath, result.target, validateGoalImportTarget);
      c.getActor();
      return result;
    },
    async importTransfer(event, input) {
      params(input, ["projectId"]);
      const c = context(event);
      c.service.adapter.describeProject(input.projectId);
      const opened = await dialog().showOpenDialog(c.parent, {
        title: "选择 CLI 目标移交文件",
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      c.getActor();
      if (opened.canceled || opened.filePaths?.length !== 1)
        return { state: "cancelled" };
      const file = opened.filePaths[0],
        transfer = readTransferJsonFile(file, validateGoalTransfer);
      if (transfer.target.projectRef.id !== input.projectId)
        throw goalError("GOAL_TRANSFER_TARGET_MISMATCH");
      const before = c.service.status({ targetId: transfer.target.id });
      if (
        digestBusinessObjectContent(before.target) !==
        digestBusinessObjectContent(transfer.target)
      )
        throw goalError("GOAL_TRANSFER_TARGET_MISMATCH");
      const source = upgradeLegacyGoal(
        JSON.parse(transfer.backup),
        transfer.source.storeId,
      );
      const choice = await dialog().showMessageBox(c.parent, {
        type: "question",
        title: "导入 CLI 目标",
        message: "核对来源与原始内容后导入？",
        detail: `移交：${visible(transfer.source)}\n目标项目：${visible(transfer.target.projectRef)}\n备份摘要：${transfer.backupDigest}\n\n原始备份：\n${visible(JSON.parse(transfer.backup))}\n\n新目标保持暂停。原状态 ${source.status} 和完成声明只保留为历史，不授予动作、监控、记忆或完成权限。`,
        buttons: ["取消", "导入并保存映射与备份"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      c.getActor();
      if (choice.response !== 1) return { state: "cancelled" };
      const again = readTransferJsonFile(file, validateGoalTransfer);
      if (again.digest !== transfer.digest)
        throw goalError("GOAL_TRANSFER_SOURCE_CHANGED");
      const result = c.service.importTransfer(again);
      c.getActor();
      return result;
    },
    async cancel(event, input) {
      params(input, ["projectId", "targetId"]);
      const c = context(event),
        before = c.service.status({ targetId: input.targetId });
      if (before.target.projectRef.id !== input.projectId)
        throw goalError("GOAL_TRANSFER_TARGET_MISMATCH");
      const saved = await dialog().showSaveDialog(c.parent, {
        title: "保存 CLI 目标回退回执",
        defaultPath: "goal-transfer-cancellation.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      c.getActor();
      if (saved.canceled || !saved.filePath) return { state: "cancelled" };
      const choice = await dialog().showMessageBox(c.parent, {
        type: "warning",
        title: "作废目标移交",
        message: "作废此导入凭据并签发回退回执？",
        detail: `${visible(before)}\n\n若已导入，仅在目标保持初始版本且无后续目标数据时移除导入目标。原始备份、映射与作废记录保留；CLI 须显式读取此签名回执才能恢复。文件保存失败时可重新导出同一回执。`,
        buttons: ["取消", "作废并导出回退回执"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      c.getActor();
      if (choice.response !== 1) return { state: "cancelled" };
      const current = c.service.status({ targetId: input.targetId });
      if (
        digestBusinessObjectContent(current) !==
        digestBusinessObjectContent(before)
      )
        throw goalError("GOAL_TRANSFER_CONFLICT");
      const result = c.service.cancel({ targetId: input.targetId });
      writeReceipt(saved.filePath, result.cancellation, (v) => v);
      c.getActor();
      return result;
    },
  };
}
module.exports = { createProjectGoalTransferHost };
