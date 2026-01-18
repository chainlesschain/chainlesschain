/**
 * 测试新特性集成
 *
 * 运行方式：在应用运行时，打开 DevTools 控制台执行以下代码
 */

async function testNewFeatures() {
  console.log("==========================================");
  console.log("🧪 开始测试新特性集成...");
  console.log("==========================================\n");

  const results = {
    sessionManager: false,
    multiAgent: false,
    errorMonitor: false,
    manusOptimization: false,
  };

  // 测试 1: 发送一条简单的对话消息
  console.log("📝 测试 1: 发送对话消息...");
  try {
    const response = await window.electronAPI.invoke("llm:chat", {
      messages: [{ role: "user", content: "你好，请用一句话介绍自己" }],
      stream: false,
      enableRAG: false,
      enableCache: true,
      enableCompression: true,
      enableSessionTracking: true,
      enableManusOptimization: true,
      enableMultiAgent: true,
      enableErrorPrecheck: true,
    });

    console.log("✅ 对话响应:", response.content?.substring(0, 100) + "...");
    console.log("📊 集成结果:", {
      sessionUsed: response.sessionUsed,
      sessionId: response.sessionId,
      manusOptimized: response.manusOptimized,
      multiAgentRouted: response.multiAgentRouted,
      agentUsed: response.agentUsed,
      errorPrechecked: response.errorPrechecked,
    });

    results.sessionManager = response.sessionUsed || false;
    results.errorMonitor = response.errorPrechecked || false;
    results.multiAgent = response.multiAgentRouted || false;
  } catch (error) {
    console.error("❌ 对话测试失败:", error.message);
  }

  // 测试 2: 代码生成任务（触发 Multi-Agent）
  console.log("\n📝 测试 2: 代码生成任务（Multi-Agent 路由）...");
  try {
    const codeResponse = await window.electronAPI.invoke("llm:chat", {
      messages: [
        {
          role: "user",
          content: "写一个 JavaScript 函数，计算斐波那契数列的第 n 项",
        },
      ],
      stream: false,
      enableMultiAgent: true,
    });

    console.log(
      "✅ 代码响应:",
      codeResponse.content?.substring(0, 100) + "...",
    );
    console.log("🤖 Agent 路由:", {
      multiAgentRouted: codeResponse.multiAgentRouted,
      agentUsed: codeResponse.agentUsed,
    });

    if (codeResponse.multiAgentRouted) {
      results.multiAgent = true;
    }
  } catch (error) {
    console.error("❌ 代码生成测试失败:", error.message);
  }

  // 测试 3: 检查 SessionManager 状态
  console.log("\n📝 测试 3: SessionManager 状态检查...");
  try {
    const recentSessions = await window.electronAPI.invoke(
      "session:get-recent",
      5,
    );
    console.log("✅ 最近会话数:", recentSessions?.length || 0);
    if (recentSessions && recentSessions.length > 0) {
      console.log("   最新会话:", recentSessions[0].title);
      results.sessionManager = true;
    }
  } catch (error) {
    console.log("⚠️ SessionManager 未通过单独 IPC 访问:", error.message);
  }

  // 测试 4: 检查 ErrorMonitor 状态
  console.log("\n📝 测试 4: ErrorMonitor 状态检查...");
  try {
    const errorStats = await window.electronAPI.invoke("error:get-stats", {
      days: 7,
    });
    console.log("✅ 错误统计:", errorStats);
    results.errorMonitor = true;
  } catch (error) {
    console.log("⚠️ ErrorMonitor 统计:", error.message);
  }

  // 测试 5: 检查 Manus 优化
  console.log("\n📝 测试 5: Manus 优化状态检查...");
  try {
    const manusStats = await window.electronAPI.invoke("manus:get-stats");
    console.log("✅ Manus 统计:", manusStats);
    results.manusOptimization = true;
  } catch (error) {
    console.log("⚠️ Manus 优化:", error.message);
  }

  // 总结
  console.log("\n==========================================");
  console.log("📊 测试结果汇总:");
  console.log("==========================================");
  console.log(
    "SessionManager:",
    results.sessionManager ? "✅ 已集成" : "❌ 未生效",
  );
  console.log(
    "Multi-Agent:",
    results.multiAgent ? "✅ 已集成" : "⚠️ 未触发（可能任务匹配度不够）",
  );
  console.log(
    "ErrorMonitor:",
    results.errorMonitor ? "✅ 已集成" : "❌ 未生效",
  );
  console.log(
    "Manus 优化:",
    results.manusOptimization ? "✅ 已集成" : "⚠️ 需要手动检查",
  );
  console.log("==========================================\n");

  return results;
}

// 导出测试函数
if (typeof module !== "undefined" && module.exports) {
  module.exports = { testNewFeatures };
}

// 如果在浏览器环境中，自动执行
if (typeof window !== "undefined") {
  console.log("💡 请在控制台执行: testNewFeatures()");
}
