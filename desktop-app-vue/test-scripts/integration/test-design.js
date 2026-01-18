/**
 * 设计工具测试脚本
 * 在浏览器控制台中运行此脚本来测试设计功能
 */

// 测试 1：创建设计项目
async function testCreateDesignProject() {
  console.log('🧪 测试 1: 创建设计项目...');

  try {
    const project = await window.electronAPI.invoke('design:create-project', {
      userId: 'test-user-001',
      name: '我的第一个设计作品',
      description: 'Figma 风格的 UI/UX 设计工具测试项目',
      width: 1920,
      height: 1080,
      tags: ['测试', '设计工具', 'MVP']
    });

    console.log('✅ 项目创建成功！');
    console.log('项目 ID:', project.id);
    console.log('默认画板 ID:', project.defaultArtboardId);
    console.log('项目详情:', project);

    return project;
  } catch (error) {
    console.error('❌ 创建项目失败:', error);
    throw error;
  }
}

// 测试 2：获取设计项目
async function testGetDesignProject(projectId) {
  console.log('🧪 测试 2: 获取设计项目...');

  try {
    const project = await window.electronAPI.invoke('design:get-project', projectId);

    console.log('✅ 获取项目成功！');
    console.log('项目信息:', project);
    console.log('画板数量:', project.artboards.length);

    return project;
  } catch (error) {
    console.error('❌ 获取项目失败:', error);
    throw error;
  }
}

// 测试 3：添加设计对象
async function testAddObject(artboardId) {
  console.log('🧪 测试 3: 添加设计对象...');

  try {
    // 添加一个矩形
    const rect = await window.electronAPI.invoke('design:add-object', {
      artboardId: artboardId,
      objectType: 'rect',
      name: '测试矩形',
      fabricJson: {
        type: 'rect',
        left: 100,
        top: 100,
        width: 200,
        height: 150,
        fill: '#3B82F6',
        stroke: '#1E40AF',
        strokeWidth: 2
      }
    });

    console.log('✅ 添加矩形成功！对象 ID:', rect.id);

    // 添加一个圆形
    const circle = await window.electronAPI.invoke('design:add-object', {
      artboardId: artboardId,
      objectType: 'circle',
      name: '测试圆形',
      fabricJson: {
        type: 'circle',
        left: 400,
        top: 150,
        radius: 75,
        fill: '#EF4444',
        stroke: '#DC2626',
        strokeWidth: 2
      }
    });

    console.log('✅ 添加圆形成功！对象 ID:', circle.id);

    // 添加一个文本
    const text = await window.electronAPI.invoke('design:add-object', {
      artboardId: artboardId,
      objectType: 'text',
      name: '测试文本',
      fabricJson: {
        type: 'text',
        left: 100,
        top: 300,
        text: 'Hello, Design Tool! 🎨',
        fontSize: 32,
        fontFamily: 'Arial',
        fill: '#1F2937'
      }
    });

    console.log('✅ 添加文本成功！对象 ID:', text.id);

    return { rect, circle, text };
  } catch (error) {
    console.error('❌ 添加对象失败:', error);
    throw error;
  }
}

// 测试 4：获取画板对象
async function testGetArtboardObjects(artboardId) {
  console.log('🧪 测试 4: 获取画板对象...');

  try {
    const data = await window.electronAPI.invoke('design:get-artboard', artboardId);

    console.log('✅ 获取画板成功！');
    console.log('画板信息:', data.artboard);
    console.log('对象数量:', data.objects.length);
    console.log('对象列表:', data.objects);

    return data;
  } catch (error) {
    console.error('❌ 获取画板失败:', error);
    throw error;
  }
}

// 测试 5：更新对象
async function testUpdateObject(objectId) {
  console.log('🧪 测试 5: 更新对象...');

  try {
    const result = await window.electronAPI.invoke('design:update-object', {
      id: objectId,
      fabricJson: {
        type: 'rect',
        left: 150,
        top: 150,
        width: 250,
        height: 200,
        fill: '#10B981',
        stroke: '#059669',
        strokeWidth: 3
      }
    });

    console.log('✅ 更新对象成功！', result);

    return result;
  } catch (error) {
    console.error('❌ 更新对象失败:', error);
    throw error;
  }
}

// 测试 6：保存画板
async function testSaveArtboard(artboardId) {
  console.log('🧪 测试 6: 保存画板...');

  try {
    // 模拟画布对象
    const objects = [
      {
        id: 'obj-1',
        fabric_json: {
          type: 'rect',
          left: 200,
          top: 200,
          width: 300,
          height: 200,
          fill: '#8B5CF6'
        }
      }
    ];

    const result = await window.electronAPI.invoke('design:save-artboard', {
      artboard_id: artboardId,
      objects: objects
    });

    console.log('✅ 保存画板成功！', result);

    return result;
  } catch (error) {
    console.error('❌ 保存画板失败:', error);
    throw error;
  }
}

// 完整测试流程
async function runAllTests() {
  console.log('🚀 开始完整测试流程...\n');

  try {
    // 步骤 1: 创建项目
    const project = await testCreateDesignProject();
    console.log('\n---\n');

    // 步骤 2: 获取项目
    await testGetDesignProject(project.id);
    console.log('\n---\n');

    // 步骤 3: 添加对象
    const objects = await testAddObject(project.defaultArtboardId);
    console.log('\n---\n');

    // 步骤 4: 获取画板对象
    await testGetArtboardObjects(project.defaultArtboardId);
    console.log('\n---\n');

    // 步骤 5: 更新对象
    await testUpdateObject(objects.rect.id);
    console.log('\n---\n');

    // 步骤 6: 保存画板
    await testSaveArtboard(project.defaultArtboardId);
    console.log('\n---\n');

    console.log('🎉 所有测试通过！');
    console.log('\n📌 现在可以访问设计编辑器：');
    console.log(`   window.location.hash = '#/design/${project.id}'`);
    console.log('\n或者直接跳转：');
    console.log(`   window.location.href = '#/design/${project.id}'`);

    return {
      success: true,
      projectId: project.id,
      artboardId: project.defaultArtboardId
    };
  } catch (error) {
    console.error('💥 测试失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 快速创建并跳转到设计编辑器
async function quickStart() {
  console.log('🎨 快速启动设计工具...');

  try {
    const project = await testCreateDesignProject();

    console.log('\n🚀 正在跳转到设计编辑器...');
    window.location.href = `#/design/${project.id}`;

    return project;
  } catch (error) {
    console.error('❌ 快速启动失败:', error);
    throw error;
  }
}

// 导出函数到全局
window.designTests = {
  createProject: testCreateDesignProject,
  getProject: testGetDesignProject,
  addObject: testAddObject,
  getArtboard: testGetArtboardObjects,
  updateObject: testUpdateObject,
  saveArtboard: testSaveArtboard,
  runAll: runAllTests,
  quickStart: quickStart
};

console.log(`
╔════════════════════════════════════════════════════════════════╗
║           🎨 ChainlessChain 设计工具测试脚本                  ║
╚════════════════════════════════════════════════════════════════╝

📖 使用方法：

1. 运行所有测试：
   await window.designTests.runAll()

2. 快速创建项目并跳转：
   await window.designTests.quickStart()

3. 单独测试：
   - 创建项目：await window.designTests.createProject()
   - 获取项目：await window.designTests.getProject(projectId)
   - 添加对象：await window.designTests.addObject(artboardId)
   - 获取画板：await window.designTests.getArtboard(artboardId)

4. 手动跳转到设计编辑器：
   window.location.href = '#/design/<项目ID>'

🎯 推荐：运行 quickStart() 快速开始测试！
`);
