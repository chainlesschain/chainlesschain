/**
 * Computer Use 使用示例
 *
 * 展示如何使用 ComputerUseAgent 进行自动化操作
 *
 * @example
 * // 在 Node.js 环境中运行
 * node src/main/browser/examples/computer-use-example.js
 */

const { ComputerUseAgent, ActionType } = require('../computer-use-agent');

async function basicExample() {
  console.log('=== 基础示例 ===\n');

  const agent = new ComputerUseAgent({
    maxRetries: 2,
    screenshotOnError: true
  });

  try {
    // 初始化
    await agent.initialize({ headless: false });
    console.log('✓ Agent 初始化完成');

    // 打开网页
    const tab = await agent.openTab('https://www.google.com');
    console.log(`✓ 打开标签页: ${tab.targetId}`);

    // 等待页面加载
    await agent.execute({ type: ActionType.WAIT, duration: 2000 });

    // 截图
    const screenshot = await agent.execute({ type: ActionType.SCREENSHOT });
    console.log(`✓ 截图完成: ${screenshot.screenshot.length} bytes`);

    // 查看页面状态
    const status = agent.getStatus();
    console.log('✓ 状态:', JSON.stringify(status, null, 2));

    // 获取执行历史
    const history = agent.getHistory();
    console.log(`✓ 执行历史: ${history.length} 条记录`);

  } catch (error) {
    console.error('错误:', error.message);
  } finally {
    await agent.close();
    console.log('✓ Agent 已关闭');
  }
}

async function coordinateExample() {
  console.log('\n=== 坐标操作示例 ===\n');

  const agent = new ComputerUseAgent();

  try {
    await agent.initialize();
    await agent.openTab('https://www.example.com');

    // 点击坐标
    await agent.execute({
      type: ActionType.CLICK,
      coordinate: true,
      x: 500,
      y: 300
    });
    console.log('✓ 点击 (500, 300)');

    // 双击
    await agent.execute({
      type: ActionType.DOUBLE_CLICK,
      x: 600,
      y: 400
    });
    console.log('✓ 双击 (600, 400)');

    // 拖拽
    await agent.execute({
      type: ActionType.DRAG,
      fromX: 100,
      fromY: 100,
      toX: 500,
      toY: 500
    });
    console.log('✓ 拖拽完成');

    // 滚动
    await agent.execute({
      type: ActionType.SCROLL,
      deltaY: 300
    });
    console.log('✓ 向下滚动 300px');

  } finally {
    await agent.close();
  }
}

async function keyboardExample() {
  console.log('\n=== 键盘操作示例 ===\n');

  const agent = new ComputerUseAgent();

  try {
    await agent.initialize();
    await agent.openTab('https://www.google.com');
    await agent.execute({ type: ActionType.WAIT, duration: 2000 });

    // 输入文本
    await agent.execute({
      type: ActionType.TYPE,
      text: 'Hello World'
    });
    console.log('✓ 输入文本');

    // 按回车
    await agent.execute({
      type: ActionType.KEY,
      key: 'Enter'
    });
    console.log('✓ 按下 Enter');

    // 快捷键
    await agent.execute({
      type: ActionType.SHORTCUT,
      shortcut: 'Ctrl+A'
    });
    console.log('✓ 执行 Ctrl+A');

  } finally {
    await agent.close();
  }
}

async function visionExample() {
  console.log('\n=== Vision AI 示例 ===\n');
  console.log('注意: 此示例需要配置 LLM 服务');

  const agent = new ComputerUseAgent();

  try {
    await agent.initialize();

    // 检查 Vision 是否可用
    if (!agent.visionAction) {
      console.log('⚠ Vision AI 不可用，请配置 LLM 服务');
      return;
    }

    await agent.openTab('https://www.google.com');
    await agent.execute({ type: ActionType.WAIT, duration: 2000 });

    // 视觉点击
    await agent.execute({
      type: ActionType.VISION_CLICK,
      description: '搜索框'
    });
    console.log('✓ 视觉点击搜索框');

    // 分析页面
    const analysis = await agent.execute({
      type: ActionType.VISION_ANALYZE,
      prompt: '描述这个页面的主要元素'
    });
    console.log('✓ 页面分析:', analysis.analysis?.substring(0, 200));

  } finally {
    await agent.close();
  }
}

async function taskExample() {
  console.log('\n=== 自然语言任务示例 ===\n');
  console.log('注意: 此示例需要配置 LLM 服务');

  const agent = new ComputerUseAgent();

  try {
    await agent.initialize();

    if (!agent.visionAction) {
      console.log('⚠ Vision AI 不可用');
      return;
    }

    await agent.openTab('https://www.google.com');
    await agent.execute({ type: ActionType.WAIT, duration: 2000 });

    // 执行自然语言任务
    const result = await agent.executeTask(
      '在搜索框中输入"人工智能"并点击搜索按钮',
      { maxSteps: 5 }
    );

    console.log('✓ 任务完成:', result.success);
    console.log('  步骤数:', result.totalSteps);

    for (const step of result.steps) {
      console.log(`  - ${step.action}: ${step.target || step.reasoning}`);
    }

  } finally {
    await agent.close();
  }
}

// 运行示例
async function main() {
  console.log('Computer Use 示例程序\n');
  console.log('注意: 运行前请确保已安装 playwright-core 和 robotjs\n');

  try {
    await basicExample();
    // await coordinateExample();
    // await keyboardExample();
    // await visionExample();
    // await taskExample();

    console.log('\n=== 所有示例完成 ===');
  } catch (error) {
    console.error('示例执行失败:', error);
  }

  process.exit(0);
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

module.exports = {
  basicExample,
  coordinateExample,
  keyboardExample,
  visionExample,
  taskExample
};
