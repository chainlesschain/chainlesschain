/**
 * 智能合约 IPC 处理器
 * 负责注册所有与智能合约相关的 IPC 通信处理器
 */

const { logger } = require("../utils/logger.js");

// Module-level let + seams for vi.mock CJS interop (RFC T1).
let _ipcMain = require("electron").ipcMain;
let _getContractTemplates = () => require("../trade/contract-templates");

function _setIpcMainForTesting(impl) {
  _ipcMain = impl ?? require("electron").ipcMain;
}

function _setContractTemplatesForTesting(impl) {
  _getContractTemplates = impl
    ? () => impl
    : () => require("../trade/contract-templates");
}

/**
 * 注册智能合约相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.contractEngine - 智能合约引擎实例
 */
function registerContractIPC({ contractEngine }) {
  // 创建合约
  _ipcMain.handle("contract:create", async (_event, options) => {
    try {
      if (!contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }

      return await contractEngine.createContract(options);
    } catch (error) {
      logger.error("[Main] 创建合约失败:", error);
      throw error;
    }
  });

  // 激活合约
  _ipcMain.handle("contract:activate", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }

      return await contractEngine.activateContract(contractId);
    } catch (error) {
      logger.error("[Main] 激活合约失败:", error);
      throw error;
    }
  });

  // 签名合约
  _ipcMain.handle("contract:sign", async (_event, contractId, signature) => {
    try {
      if (!contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }

      return await contractEngine.signContract(contractId, signature);
    } catch (error) {
      logger.error("[Main] 签名合约失败:", error);
      throw error;
    }
  });

  // 检查合约条件
  _ipcMain.handle("contract:check-conditions", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        return { allMet: false, conditions: [] };
      }

      return await contractEngine.checkConditions(contractId);
    } catch (error) {
      logger.error("[Main] 检查合约条件失败:", error);
      throw error;
    }
  });

  // 执行合约
  _ipcMain.handle("contract:execute", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }

      return await contractEngine.executeContract(contractId);
    } catch (error) {
      logger.error("[Main] 执行合约失败:", error);
      throw error;
    }
  });

  // 取消合约
  _ipcMain.handle("contract:cancel", async (_event, contractId, reason) => {
    try {
      if (!contractEngine) {
        throw new Error("智能合约引擎未初始化");
      }

      return await contractEngine.cancelContract(contractId, reason);
    } catch (error) {
      logger.error("[Main] 取消合约失败:", error);
      throw error;
    }
  });

  // 获取合约详情
  _ipcMain.handle("contract:get", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        return null;
      }

      return await contractEngine.getContract(contractId);
    } catch (error) {
      logger.error("[Main] 获取合约详情失败:", error);
      throw error;
    }
  });

  // 获取合约列表
  _ipcMain.handle("contract:get-list", async (_event, filters) => {
    try {
      if (!contractEngine) {
        return [];
      }

      return await contractEngine.getContracts(filters);
    } catch (error) {
      logger.error("[Main] 获取合约列表失败:", error);
      throw error;
    }
  });

  // 获取合约条件
  _ipcMain.handle("contract:get-conditions", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        return [];
      }

      return await contractEngine.getContractConditions(contractId);
    } catch (error) {
      logger.error("[Main] 获取合约条件失败:", error);
      throw error;
    }
  });

  // 获取合约事件
  _ipcMain.handle("contract:get-events", async (_event, contractId) => {
    try {
      if (!contractEngine) {
        return [];
      }

      return await contractEngine.getContractEvents(contractId);
    } catch (error) {
      logger.error("[Main] 获取合约事件失败:", error);
      throw error;
    }
  });

  // 发起仲裁
  _ipcMain.handle(
    "contract:initiate-arbitration",
    async (_event, contractId, reason, evidence) => {
      try {
        if (!contractEngine) {
          throw new Error("智能合约引擎未初始化");
        }

        return await contractEngine.initiateArbitration(
          contractId,
          reason,
          evidence,
        );
      } catch (error) {
        logger.error("[Main] 发起仲裁失败:", error);
        throw error;
      }
    },
  );

  // 解决仲裁
  _ipcMain.handle(
    "contract:resolve-arbitration",
    async (_event, arbitrationId, resolution) => {
      try {
        if (!contractEngine) {
          throw new Error("智能合约引擎未初始化");
        }

        return await contractEngine.resolveArbitration(
          arbitrationId,
          resolution,
        );
      } catch (error) {
        logger.error("[Main] 解决仲裁失败:", error);
        throw error;
      }
    },
  );

  // 获取合约模板列表
  _ipcMain.handle("contract:get-templates", async () => {
    try {
      const ContractTemplates = _getContractTemplates();
      return ContractTemplates.getAllTemplates();
    } catch (error) {
      logger.error("[Main] 获取合约模板列表失败:", error);
      throw error;
    }
  });

  // 从模板创建合约
  _ipcMain.handle(
    "contract:create-from-template",
    async (_event, templateId, params) => {
      try {
        const ContractTemplates = _getContractTemplates();

        // 验证参数
        const validation = ContractTemplates.validateParams(templateId, params);
        if (!validation.valid) {
          throw new Error(`参数验证失败: ${validation.errors.join(", ")}`);
        }

        // 从模板创建合约
        const contractOptions = ContractTemplates.createFromTemplate(
          templateId,
          params,
        );

        // 调用合约引擎创建合约
        if (!contractEngine) {
          throw new Error("智能合约引擎未初始化");
        }

        return await contractEngine.createContract(contractOptions);
      } catch (error) {
        logger.error("[Main] 从模板创建合约失败:", error);
        throw error;
      }
    },
  );

  // 获取合约的区块链部署信息
  _ipcMain.handle(
    "contract:get-blockchain-info",
    async (_event, contractId) => {
      try {
        if (!contractEngine) {
          return null;
        }

        return await contractEngine._getDeployedContract(contractId);
      } catch (error) {
        logger.error("[Main] 获取合约部署信息失败:", error);
        return null;
      }
    },
  );

  logger.info("[ContractIPC] 智能合约 IPC 处理器已注册 (15个处理器)");
}

module.exports = {
  registerContractIPC,
  _setIpcMainForTesting,
  _setContractTemplatesForTesting,
};
