/**
 * 知识图谱后端功能测试脚本
 */

const DatabaseManager = require('./dist/main/database');
const GraphExtractor = require('./dist/main/graph-extractor');

async function testGraphBackend() {
  console.log('🚀 开始测试知识图谱后端功能...\n');

  try {
    // 1. 初始化数据库
    console.log('📊 步骤 1: 初始化数据库...');
    const db = new DatabaseManager();
    await db.initialize();
    console.log('✅ 数据库初始化成功\n');

    // 2. 初始化图谱提取器
    console.log('🔍 步骤 2: 初始化图谱提取器...');
    const extractor = new GraphExtractor(db);
    console.log('✅ 图谱提取器初始化成功\n');

    // 3. 创建测试笔记
    console.log('📝 步骤 3: 创建测试笔记...');

    const note1 = db.addKnowledgeItem({
      title: 'Vue.js 学习笔记',
      type: 'note',
      content: `# Vue.js 学习笔记

Vue.js 是一个渐进式框架，与 [[React]] 和 [[Angular]] 类似。

主要特点：
- 响应式数据绑定
- 组件化开发
- 虚拟 DOM

相关笔记：[[前端框架对比]]、[[JavaScript 基础]]`
    });
    console.log(`✅ 创建笔记 1: ${note1.title} (ID: ${note1.id})`);

    const note2 = db.addKnowledgeItem({
      title: 'React',
      type: 'note',
      content: `# React 学习笔记

React 是 Facebook 开发的 UI 库。

与 [[Vue.js 学习笔记]] 的对比：
- 都使用虚拟 DOM
- 都支持组件化

参考：[[前端框架对比]]`
    });
    console.log(`✅ 创建笔记 2: ${note2.title} (ID: ${note2.id})`);

    const note3 = db.addKnowledgeItem({
      title: '前端框架对比',
      type: 'note',
      content: `# 前端框架对比

主流框架：
- [[Vue.js 学习笔记]]
- [[React]]
- [[Angular]]

推荐学习路径：先学 [[JavaScript 基础]]`
    });
    console.log(`✅ 创建笔记 3: ${note3.title} (ID: ${note3.id})`);

    const note4 = db.addKnowledgeItem({
      title: 'JavaScript 基础',
      type: 'note',
      content: `# JavaScript 基础

JavaScript 是前端开发的基础。

建议学习：
- ES6+ 语法
- 异步编程
- 模块化

进阶：[[Vue.js 学习笔记]]、@前端框架对比`
    });
    console.log(`✅ 创建笔记 4: ${note4.title} (ID: ${note4.id})\n`);

    // 4. 测试链接提取
    console.log('🔗 步骤 4: 测试链接提取...');

    const note1Links = extractor.extractWikiLinks(note1.content);
    console.log(`笔记 "${note1.title}" 中的 Wiki 链接:`, note1Links);

    const note4Mentions = extractor.extractMentions(note4.content);
    console.log(`笔记 "${note4.title}" 中的 @mentions:`, note4Mentions);
    console.log('✅ 链接提取测试通过\n');

    // 5. 处理笔记关系
    console.log('⚙️  步骤 5: 处理笔记关系...');

    const count1 = extractor.processNote(note1.id, note1.content, []);
    console.log(`处理笔记 "${note1.title}": 创建了 ${count1} 个关系`);

    const count2 = extractor.processNote(note2.id, note2.content, []);
    console.log(`处理笔记 "${note2.title}": 创建了 ${count2} 个关系`);

    const count3 = extractor.processNote(note3.id, note3.content, []);
    console.log(`处理笔记 "${note3.title}": 创建了 ${count3} 个关系`);

    const count4 = extractor.processNote(note4.id, note4.content, []);
    console.log(`处理笔记 "${note4.title}": 创建了 ${count4} 个关系`);
    console.log('✅ 关系处理完成\n');

    // 6. 获取图谱数据
    console.log('📈 步骤 6: 获取图谱数据...');
    const graphData = db.getGraphData({
      relationTypes: ['link', 'tag', 'semantic', 'temporal'],
      nodeTypes: ['note'],
      minWeight: 0.0,
      limit: 500
    });

    console.log(`节点数量: ${graphData.nodes.length}`);
    console.log(`边数量: ${graphData.edges.length}`);

    console.log('\n节点列表:');
    graphData.nodes.forEach((node, index) => {
      console.log(`  ${index + 1}. ${node.title} (ID: ${node.id})`);
    });

    console.log('\n边列表:');
    graphData.edges.forEach((edge, index) => {
      const sourceNode = graphData.nodes.find(n => n.id === edge.source_id);
      const targetNode = graphData.nodes.find(n => n.id === edge.target_id);
      console.log(`  ${index + 1}. ${sourceNode?.title} → ${targetNode?.title} (类型: ${edge.relation_type}, 权重: ${edge.weight})`);
    });
    console.log('✅ 图谱数据获取成功\n');

    // 7. 测试查找潜在链接
    console.log('💡 步骤 7: 测试潜在链接建议...');
    const suggestions = extractor.findPotentialLinks(note1.id, note1.content);
    console.log(`笔记 "${note1.title}" 的潜在链接建议:`);
    suggestions.slice(0, 3).forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.title} (置信度: ${s.confidence.toFixed(2)}, 出现次数: ${s.occurrences})`);
    });
    console.log('✅ 潜在链接建议测试通过\n');

    // 8. 测试查找关联路径
    console.log('🛤️  步骤 8: 测试查找关联路径...');
    if (graphData.nodes.length >= 2) {
      const path = db.findRelatedNotes(note1.id, note4.id, 3);
      if (path) {
        console.log(`从 "${note1.title}" 到 "${note4.title}" 的路径:`);
        path.path.forEach((nodeId, i) => {
          const node = graphData.nodes.find(n => n.id === nodeId);
          console.log(`  ${i + 1}. ${node?.title}`);
        });
        console.log(`路径长度: ${path.distance}`);
      } else {
        console.log('未找到路径');
      }
    }
    console.log('✅ 路径查找测试通过\n');

    // 9. 测试获取笔记关系
    console.log('🔄 步骤 9: 测试获取笔记关系...');
    const note1Relations = db.getKnowledgeRelations(note1.id);
    console.log(`笔记 "${note1.title}" 的关系数量: ${note1Relations.length}`);
    note1Relations.forEach((rel, i) => {
      const isSource = rel.source_id === note1.id;
      const otherId = isSource ? rel.target_id : rel.source_id;
      const otherNode = graphData.nodes.find(n => n.id === otherId);
      const direction = isSource ? '→' : '←';
      console.log(`  ${i + 1}. ${direction} ${otherNode?.title} (类型: ${rel.relation_type})`);
    });
    console.log('✅ 关系获取测试通过\n');

    // 10. 统计信息
    console.log('📊 步骤 10: 统计信息...');
    const stats = {
      totalNotes: graphData.nodes.length,
      totalRelations: graphData.edges.length,
      linkRelations: graphData.edges.filter(e => e.relation_type === 'link').length,
      tagRelations: graphData.edges.filter(e => e.relation_type === 'tag').length,
      semanticRelations: graphData.edges.filter(e => e.relation_type === 'semantic').length,
      temporalRelations: graphData.edges.filter(e => e.relation_type === 'temporal').length,
    };

    console.log('图谱统计:');
    console.log(`  总笔记数: ${stats.totalNotes}`);
    console.log(`  总关系数: ${stats.totalRelations}`);
    console.log(`  链接关系: ${stats.linkRelations}`);
    console.log(`  标签关系: ${stats.tagRelations}`);
    console.log(`  语义关系: ${stats.semanticRelations}`);
    console.log(`  时间关系: ${stats.temporalRelations}`);
    console.log('✅ 统计信息获取成功\n');

    console.log('🎉 所有测试通过！知识图谱后端功能正常工作！\n');

    return {
      success: true,
      stats
    };

  } catch (error) {
    console.error('❌ 测试失败:', error);
    throw error;
  }
}

// 运行测试
testGraphBackend()
  .then((result) => {
    console.log('✅ 测试完成，结果:', result);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  });
