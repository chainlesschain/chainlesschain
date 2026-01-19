/**
 * Phase 3 真实功能测试
 * 测试视频处理的真实实现
 */

// 设置环境变量启用真实实现
process.env.USE_REAL_TOOLS = 'true';

const FunctionCaller = require('../ai-engine/function-caller');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;

// 配置FFmpeg路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

async function testPhase3RealTools() {
  console.log('========================================');
  console.log('Phase 3 真实功能测试 - 视频处理');
  console.log('========================================\n');

  const functionCaller = new FunctionCaller();
  const testDir = path.join(__dirname, '../../test-output');

  // 确保测试目录存在
  await fs.mkdir(testDir, { recursive: true });

  let passedTests = 0;
  let failedTests = 0;
  const results = [];

  // ==================== 准备测试视频 ====================
  console.log('📝 准备测试视频\n');

  const video1Path = path.join(testDir, 'test-video1.mp4');
  const video2Path = path.join(testDir, 'test-video2.mp4');

  try {
    // 创建第一个测试视频（10秒，红色背景）
    await createTestVideo(video1Path, 10, 'red', '测试视频1');
    console.log(`   ✅ 测试视频1创建成功`);
    console.log(`   → 路径: ${video1Path}`);
    console.log(`   → 时长: 10秒`);
    console.log(`   → 背景: 红色\n`);

    // 创建第二个测试视频（8秒，蓝色背景）
    await createTestVideo(video2Path, 8, 'blue', '测试视频2');
    console.log(`   ✅ 测试视频2创建成功`);
    console.log(`   → 路径: ${video2Path}`);
    console.log(`   → 时长: 8秒`);
    console.log(`   → 背景: 蓝色\n`);
  } catch (error) {
    console.log(`   ❌ 创建测试视频失败: ${error.message}\n`);
    process.exit(1);
  }

  // ==================== 测试1: 视频裁剪 (开始+时长) ====================
  console.log('📝 测试1: 视频裁剪 (开始时间 + 时长)\n');
  try {
    const result = await functionCaller.call('video_cutter', {
      input_path: video1Path,
      output_path: path.join(testDir, 'test-cut-duration.mp4'),
      start_time: '00:00:02',
      duration: '00:00:05'
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        console.log('   ✅ 视频裁剪成功 (时长方式)!');
        console.log(`   → 输出路径: ${result.output_path}`);
        console.log(`   → 开始时间: ${result.start_time}`);
        console.log(`   → 时长: ${result.duration}`);
        console.log(`   → 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        if (result.video_codec) {console.log(`   → 视频编码: ${result.video_codec}`);}
        if (result.resolution) {console.log(`   → 分辨率: ${result.resolution}`);}
        console.log('');

        passedTests++;
        results.push({ test: '视频裁剪(时长)', status: '通过', file: result.output_path });
      } catch (fileError) {
        console.log(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '视频裁剪(时长)', status: '失败', error: '文件验证失败' });
      }
    } else {
      console.log(`   ❌ 裁剪失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '视频裁剪(时长)', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '视频裁剪(时长)', status: '异常', error: error.message });
  }

  // ==================== 测试2: 视频裁剪 (开始+结束) ====================
  console.log('📝 测试2: 视频裁剪 (开始时间 + 结束时间)\n');
  try {
    const result = await functionCaller.call('video_cutter', {
      input_path: video1Path,
      output_path: path.join(testDir, 'test-cut-range.mp4'),
      start_time: '00:00:01',
      end_time: '00:00:06'
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        console.log('   ✅ 视频裁剪成功 (时间范围)!');
        console.log(`   → 输出路径: ${result.output_path}`);
        console.log(`   → 开始时间: ${result.start_time}`);
        console.log(`   → 结束时间: ${result.end_time}`);
        console.log(`   → 时长: ${result.duration}`);
        console.log(`   → 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        if (result.video_codec) {console.log(`   → 视频编码: ${result.video_codec}`);}
        console.log('');

        passedTests++;
        results.push({ test: '视频裁剪(范围)', status: '通过', file: result.output_path });
      } catch (fileError) {
        console.log(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '视频裁剪(范围)', status: '失败', error: '文件验证失败' });
      }
    } else {
      console.log(`   ❌ 裁剪失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '视频裁剪(范围)', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '视频裁剪(范围)', status: '异常', error: error.message });
  }

  // ==================== 测试3: 视频合并 (2个文件) ====================
  console.log('📝 测试3: 视频合并 (2个文件)\n');
  try {
    const result = await functionCaller.call('video_merger', {
      input_files: [video1Path, video2Path],
      output_path: path.join(testDir, 'test-merged.mp4')
    });

    if (result.success) {
      try {
        const stats = await fs.stat(result.output_path);

        console.log('   ✅ 视频合并成功!');
        console.log(`   → 输出路径: ${result.output_path}`);
        console.log(`   → 合并文件数: ${result.files_merged}`);
        console.log(`   → 总时长: ${result.total_duration}`);
        console.log(`   → 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        if (result.video_codec) {console.log(`   → 视频编码: ${result.video_codec}`);}
        if (result.resolution) {console.log(`   → 分辨率: ${result.resolution}`);}
        console.log('');

        passedTests++;
        results.push({ test: '视频合并(2文件)', status: '通过', file: result.output_path });
      } catch (fileError) {
        console.log(`   ❌ 文件验证失败: ${fileError.message}\n`);
        failedTests++;
        results.push({ test: '视频合并(2文件)', status: '失败', error: '文件验证失败' });
      }
    } else {
      console.log(`   ❌ 合并失败: ${result.error}\n`);
      failedTests++;
      results.push({ test: '视频合并(2文件)', status: '失败', error: result.error });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '视频合并(2文件)', status: '异常', error: error.message });
  }

  // ==================== 测试4: 裁剪后合并 ====================
  console.log('📝 测试4: 组合操作 - 裁剪后合并\n');
  try {
    // 先裁剪两个视频片段
    const cut1Path = path.join(testDir, 'test-cut1-for-merge.mp4');
    const cut2Path = path.join(testDir, 'test-cut2-for-merge.mp4');

    const cut1Result = await functionCaller.call('video_cutter', {
      input_path: video1Path,
      output_path: cut1Path,
      start_time: '00:00:00',
      duration: '00:00:03'
    });

    const cut2Result = await functionCaller.call('video_cutter', {
      input_path: video2Path,
      output_path: cut2Path,
      start_time: '00:00:00',
      duration: '00:00:03'
    });

    if (cut1Result.success && cut2Result.success) {
      // 然后合并裁剪后的片段
      const mergeResult = await functionCaller.call('video_merger', {
        input_files: [cut1Path, cut2Path],
        output_path: path.join(testDir, 'test-cut-then-merge.mp4')
      });

      if (mergeResult.success) {
        const stats = await fs.stat(mergeResult.output_path);

        console.log('   ✅ 组合操作成功!');
        console.log(`   → 步骤1: 裁剪视频1 (0-3秒) ✅`);
        console.log(`   → 步骤2: 裁剪视频2 (0-3秒) ✅`);
        console.log(`   → 步骤3: 合并两个片段 ✅`);
        console.log(`   → 最终输出: ${mergeResult.output_path}`);
        console.log(`   → 文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
        console.log('');

        passedTests++;
        results.push({ test: '组合操作', status: '通过', file: mergeResult.output_path });
      } else {
        console.log(`   ❌ 合并失败: ${mergeResult.error}\n`);
        failedTests++;
        results.push({ test: '组合操作', status: '失败', error: mergeResult.error });
      }
    } else {
      console.log(`   ❌ 裁剪失败\n`);
      failedTests++;
      results.push({ test: '组合操作', status: '失败', error: '裁剪阶段失败' });
    }
  } catch (error) {
    console.log(`   ❌ 异常: ${error.message}\n`);
    failedTests++;
    results.push({ test: '组合操作', status: '异常', error: error.message });
  }

  // ==================== 测试总结 ====================
  console.log('========================================');
  console.log('测试总结');
  console.log('========================================\n');

  const totalTests = passedTests + failedTests;
  const successRate = totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(1) : 0;

  console.log(`总测试数: ${totalTests}`);
  console.log(`通过: ${passedTests} ✅`);
  console.log(`失败: ${failedTests} ❌`);
  console.log(`成功率: ${successRate}%\n`);

  console.log('详细结果:');
  results.forEach((result, index) => {
    const statusIcon = result.status === '通过' ? '✅' :
                      result.status === '跳过' ? '⏭️' : '❌';
    console.log(`${index + 1}. ${statusIcon} ${result.test} - ${result.status}`);
    if (result.file) {console.log(`   文件: ${result.file}`);}
    if (result.error) {console.log(`   错误: ${result.error}`);}
  });

  console.log('\n========================================');
  console.log(`测试输出目录: ${testDir}`);
  console.log('========================================\n');

  return {
    total: totalTests,
    passed: passedTests,
    failed: failedTests,
    successRate: successRate,
    results: results
  };
}

/**
 * 创建测试视频
 * @param {string} outputPath - 输出路径
 * @param {number} duration - 时长(秒)
 * @param {string} color - 背景颜色
 * @param {string} text - 显示文本
 */
function createTestVideo(outputPath, duration, color, text) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=${color}:s=640x480:d=${duration}`)
      .inputFormat('lavfi')
      .input(`anullsrc=r=44100:cl=mono`)
      .inputFormat('lavfi')
      .outputOptions([
        `-t ${duration}`,
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-shortest'
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        reject(new Error(`创建测试视频失败: ${err.message}`));
      })
      .run();
  });
}

// 运行测试
if (require.main === module) {
  testPhase3RealTools()
    .then((summary) => {
      if (summary.failed === 0) {
        console.log('🎉 所有测试通过!');
        process.exit(0);
      } else {
        console.log('⚠️ 有测试失败');
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('❌ 测试执行失败:', error);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { testPhase3RealTools };
