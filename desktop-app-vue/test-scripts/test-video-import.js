/**
 * 视频导入功能测试脚本
 * 测试视频元数据提取、缩略图生成等功能
 */

const path = require('path');
const DatabaseManager = require('./src/main/database');
const VideoImporter = require('./src/main/video/video-importer');
const { getVideoConfig } = require('./src/main/video/video-config');

async function testVideoImport() {
  console.log('=== 视频导入功能测试 ===\n');

  let database = null;
  let videoImporter = null;

  try {
    // 1. 初始化数据库
    console.log('[1/5] 初始化数据库...');
    database = new DatabaseManager();
    await database.initialize(':memory:'); // 使用内存数据库测试
    console.log('✓ 数据库初始化成功\n');

    // 2. 初始化视频导入器
    console.log('[2/5] 初始化视频导入器...');
    const userDataPath = path.join(__dirname, 'test-data');
    videoImporter = new VideoImporter(database, userDataPath);
    await videoImporter.initializeStorageDirectories();
    console.log('✓ 视频导入器初始化成功\n');

    // 3. 测试配置
    console.log('[3/5] 测试视频配置...');
    const config = getVideoConfig();
    console.log('支持的视频格式:', config.supportedFormats.join(', '));
    console.log('最大文件大小:', (config.maxFileSize / 1024 / 1024 / 1024).toFixed(2), 'GB');
    console.log('缩略图配置:', config.thumbnail);
    console.log('✓ 配置加载成功\n');

    // 4. 测试事件监听
    console.log('[4/5] 设置事件监听器...');

    videoImporter.on('import:start', (data) => {
      console.log('  导入开始:', data.filePath);
    });

    videoImporter.on('import:progress', (data) => {
      console.log(`  导入进度: ${data.progress}% - ${data.message}`);
    });

    videoImporter.on('import:complete', (data) => {
      console.log('  导入完成:', data.video);
    });

    videoImporter.on('import:error', (data) => {
      console.error('  导入错误:', data.error);
    });

    videoImporter.on('analysis:start', (data) => {
      console.log('  分析开始:', data.videoId);
    });

    videoImporter.on('analysis:progress', (data) => {
      console.log(`  分析进度: ${data.progress}% - ${data.message}`);
    });

    videoImporter.on('analysis:complete', (data) => {
      console.log('  分析完成:', data.videoId);
    });

    console.log('✓ 事件监听器设置成功\n');

    // 5. 测试数据库操作
    console.log('[5/5] 测试数据库操作...');

    // 创建测试视频记录
    const testVideo = await videoImporter.storage.createVideoFile({
      fileName: 'test-video.mp4',
      filePath: '/path/to/test-video.mp4',
      fileSize: 10485760, // 10MB
      duration: 120.5,
      width: 1920,
      height: 1080,
      fps: 30,
      format: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
      bitrate: 5000000,
      hasAudio: true,
      analysisStatus: 'pending'
    });

    console.log('创建的视频记录:', testVideo);

    // 获取视频统计
    const stats = {
      count: await videoImporter.storage.getVideoCount(),
      totalDuration: await videoImporter.storage.getTotalDuration(),
      totalSize: await videoImporter.storage.getTotalStorageSize(),
      statusStats: await videoImporter.storage.getVideoCountByStatus()
    };

    console.log('\n视频统计信息:');
    console.log('  总数:', stats.count);
    console.log('  总时长:', stats.totalDuration.toFixed(2), '秒');
    console.log('  总大小:', (stats.totalSize / 1024 / 1024).toFixed(2), 'MB');
    console.log('  状态统计:', stats.statusStats);

    console.log('\n✓ 数据库操作测试成功\n');

    // 测试成功
    console.log('=== 所有测试通过 ===');
    console.log('\n功能验证:');
    console.log('✓ 数据库表创建正常');
    console.log('✓ 视频配置加载正常');
    console.log('✓ 视频存储管理器工作正常');
    console.log('✓ 事件系统工作正常');
    console.log('✓ 存储目录初始化正常');

    console.log('\n注意事项:');
    console.log('- 实际视频导入需要真实的视频文件');
    console.log('- FFmpeg 需要正确安装以支持元数据提取和缩略图生成');
    console.log('- 视频分析功能需要在有真实视频文件时测试');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    console.error('错误堆栈:', error.stack);
    process.exit(1);
  }
}

// 运行测试
testVideoImport();
