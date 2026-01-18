/**
 * 插件系统测试脚本
 * 测试插件的安装、启用、禁用、权限管理等功能
 */

const path = require('path');

// 模拟测试流程
async function testPluginSystem() {
  console.log('\n========================================');
  console.log('🧪 开始测试插件系统');
  console.log('========================================\n');

  const testPluginPath = path.join(__dirname, 'test-plugin');
  const testPluginId = 'com.chainlesschain.hello-world';

  console.log('📦 测试插件信息:');
  console.log('  - 路径:', testPluginPath);
  console.log('  - ID:', testPluginId);
  console.log('  - 名称: Hello World Plugin');
  console.log('  - 版本: 1.0.0');
  console.log('  - 权限: database:read, ui:component');
  console.log('  - 扩展点: ui.menu');
  console.log('');

  // 测试步骤
  const steps = [
    {
      step: 1,
      title: '安装测试插件',
      description: '从本地目录安装 Hello World 插件',
      instructions: [
        '1. 在插件管理页面点击 "安装插件" 按钮',
        '2. 选择安装方式: "本地目录"',
        '3. 点击 "选择目录" 按钮',
        `4. 选择目录: ${testPluginPath}`,
        '5. 点击 "确定" 按钮',
        '6. 等待安装完成提示',
      ],
      expectedResult: '插件列表中出现 "Hello World Plugin"，状态为已禁用',
    },
    {
      step: 2,
      title: '查看插件详情',
      description: '验证插件元数据正确显示',
      instructions: [
        '1. 在插件卡片上点击 "详情" 按钮',
        '2. 检查以下信息:',
        '   - 插件ID: com.chainlesschain.hello-world',
        '   - 名称: Hello World Plugin',
        '   - 版本: 1.0.0',
        '   - 作者: ChainlessChain Team',
        '   - 描述: 一个简单的测试插件，用于验证插件系统',
        '   - 许可证: MIT',
        '   - 主页: https://github.com/chainlesschain/hello-world-plugin',
        '   - 分类: custom (自定义)',
        '   - 安装路径正确',
        '3. 关闭详情对话框',
      ],
      expectedResult: '所有元数据信息正确显示',
    },
    {
      step: 3,
      title: '启用插件',
      description: '测试插件启用功能',
      instructions: [
        '1. 找到 "Hello World Plugin" 插件卡片',
        '2. 点击插件卡片右上角的开关，从关闭切换到开启',
        '3. 观察控制台输出',
        '4. 检查插件卡片左侧的状态指示器',
      ],
      expectedResult: [
        '✅ 控制台输出: "[HelloWorldPlugin] 插件已启用"',
        '✅ 状态指示器变为绿色',
        '✅ 插件卡片不再半透明',
        '✅ 显示成功提示: "插件 Hello World Plugin 已启用"',
      ],
    },
    {
      step: 4,
      title: '查看权限管理',
      description: '验证权限系统正常工作',
      instructions: [
        '1. 在插件卡片上点击 "权限" 按钮',
        '2. 检查权限列表:',
        '   - 数据库读取 (database:read) - 默认应该是"允许"',
        '   - UI组件 (ui:component) - 默认应该是"允许"',
        '3. 尝试切换权限开关',
        '4. 点击 "确定" 保存更改',
      ],
      expectedResult: [
        '✅ 显示 2 个权限项',
        '✅ 权限名称和描述正确显示',
        '✅ 可以切换权限状态',
        '✅ 保存成功提示: "权限设置已保存"',
      ],
    },
    {
      step: 5,
      title: '测试扩展点',
      description: '验证插件扩展点已注册',
      instructions: [
        '1. 打开浏览器控制台 (F12)',
        '2. 运行命令检查扩展点:',
        '   ```javascript',
        '   // 检查扩展点是否注册',
        '   await window.electronAPI.plugin.getPlugin("com.chainlesschain.hello-world")',
        '   ```',
        '3. 查看返回的扩展点信息',
        '4. 在插件卡片底部查看扩展点标签',
      ],
      expectedResult: [
        '✅ 返回对象包含 extension_points 字段',
        '✅ 扩展点包含: ui.menu',
        '✅ 插件卡片底部显示 "ui.menu" 标签',
      ],
    },
    {
      step: 6,
      title: '禁用插件',
      description: '测试插件禁用功能',
      instructions: [
        '1. 点击插件卡片的启用开关，从开启切换到关闭',
        '2. 观察控制台输出',
        '3. 检查插件卡片状态',
      ],
      expectedResult: [
        '✅ 控制台输出: "[HelloWorldPlugin] 插件已禁用"',
        '✅ 状态指示器变为灰色',
        '✅ 插件卡片变为半透明',
        '✅ 显示成功提示: "插件 Hello World Plugin 已禁用"',
      ],
    },
    {
      step: 7,
      title: '测试搜索和筛选',
      description: '验证搜索和筛选功能',
      instructions: [
        '1. 在搜索框输入 "hello" 并回车',
        '2. 验证只显示 Hello World Plugin',
        '3. 清空搜索框',
        '4. 在状态筛选下拉框选择 "已禁用"',
        '5. 验证插件仍然显示',
        '6. 选择 "已启用"，验证插件消失',
        '7. 恢复筛选为 "全部"',
        '8. 在分类筛选选择 "自定义"',
        '9. 验证插件仍然显示',
      ],
      expectedResult: '✅ 搜索和筛选功能正常工作',
    },
    {
      step: 8,
      title: '卸载插件',
      description: '测试插件卸载功能',
      instructions: [
        '1. 在插件卡片上点击 "卸载" 按钮',
        '2. 在确认对话框中点击 "确定"',
        '3. 观察控制台输出',
        '4. 等待插件列表刷新',
      ],
      expectedResult: [
        '✅ 控制台输出: "[HelloWorldPlugin] 插件已卸载"',
        '✅ 显示成功提示: "插件 Hello World Plugin 已卸载"',
        '✅ 插件从列表中消失',
        '✅ 显示 "暂无插件" 提示',
      ],
    },
    {
      step: 9,
      title: '重新安装测试',
      description: '验证可以重复安装',
      instructions: [
        '1. 重复步骤 1 再次安装插件',
        '2. 验证安装成功',
      ],
      expectedResult: '✅ 可以成功重新安装插件',
    },
    {
      step: 10,
      title: '打开插件目录',
      description: '测试工具功能',
      instructions: [
        '1. 点击 "打开插件目录" 按钮',
        '2. 验证文件浏览器打开',
        '3. 检查目录路径',
      ],
      expectedResult: '✅ 文件浏览器打开，显示插件目录 (应该在 AppData/Roaming/chainlesschain-desktop-vue/plugins)',
    },
  ];

  // 打印测试步骤
  steps.forEach((step) => {
    console.log(`\n📋 步骤 ${step.step}: ${step.title}`);
    console.log('─'.repeat(60));
    console.log(`📝 描述: ${step.description}\n`);

    console.log('🔧 操作步骤:');
    step.instructions.forEach((instruction) => {
      console.log(`   ${instruction}`);
    });

    console.log('\n🎯 预期结果:');
    if (Array.isArray(step.expectedResult)) {
      step.expectedResult.forEach((result) => {
        console.log(`   ${result}`);
      });
    } else {
      console.log(`   ${step.expectedResult}`);
    }
  });

  console.log('\n========================================');
  console.log('✅ 测试流程说明已生成');
  console.log('========================================\n');

  console.log('💡 提示:');
  console.log('  1. 请在 Electron 应用中打开 "系统设置 > 插件管理"');
  console.log('  2. 按照上述步骤逐一测试');
  console.log('  3. 打开浏览器控制台 (F12) 查看日志输出');
  console.log('  4. 每个步骤完成后，确认预期结果是否达成\n');

  console.log('🔍 调试命令 (在浏览器控制台中运行):');
  console.log('  // 检查 plugin API 是否可用');
  console.log('  console.log(window.electronAPI?.plugin);\n');
  console.log('  // 获取所有插件');
  console.log('  await window.electronAPI.plugin.getPlugins({});\n');
  console.log('  // 获取特定插件');
  console.log('  await window.electronAPI.plugin.getPlugin("com.chainlesschain.hello-world");\n');
  console.log('  // 获取插件权限');
  console.log('  await window.electronAPI.plugin.getPermissions("com.chainlesschain.hello-world");\n');
}

// 运行测试
testPluginSystem().catch(console.error);
