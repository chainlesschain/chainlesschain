/**
 * 第十二批工具调用测试
 * 验证新添加的20个日常实用工具是否可以被正常调用
 */

const { logger } = require("../utils/logger.js");
const FunctionCaller = require("../ai-engine/function-caller");

async function testBatch12Tools() {
  logger.info("========== 第十二批工具调用测试 ==========\n");

  const functionCaller = new FunctionCaller();

  // 获取所有可用工具
  const allTools = functionCaller.getAvailableTools();
  const batch12Tools = allTools.filter((tool) => {
    const batch12ToolNames = [
      "file_compressor",
      "file_decompressor",
      "image_editor",
      "image_filter",
      "video_cutter",
      "video_merger",
      "pdf_converter",
      "office_converter",
      "qrcode_generator_advanced",
      "qrcode_scanner",
      "screenshot_tool",
      "screen_recorder",
      "calendar_manager",
      "reminder_scheduler",
      "note_editor",
      "note_searcher",
      "password_generator_advanced",
      "password_vault",
      "network_speed_tester",
      "network_diagnostic_tool",
    ];
    return batch12ToolNames.includes(tool.name);
  });

  logger.info(`✅ 已注册的第十二批工具数量: ${batch12Tools.length}/20\n`);

  // 测试案例
  const testCases = [
    {
      name: "文件压缩器",
      toolName: "file_compressor",
      params: {
        files: ["file1.txt", "file2.pdf", "file3.jpg"],
        output_path: "archive.zip",
        format: "zip",
        compression_level: "normal",
        password: "test123",
      },
    },
    {
      name: "文件解压器",
      toolName: "file_decompressor",
      params: {
        archive_path: "archive.zip",
        output_dir: "./extracted",
        password: "test123",
        overwrite: true,
      },
    },
    {
      name: "图片编辑器",
      toolName: "image_editor",
      params: {
        input_path: "photo.jpg",
        output_path: "photo_edited.jpg",
        operations: [
          { type: "resize", params: { width: 800, height: 600 } },
          { type: "rotate", params: { angle: 90 } },
        ],
        format: "jpg",
        quality: 85,
      },
    },
    {
      name: "图片滤镜器",
      toolName: "image_filter",
      params: {
        input_path: "photo.jpg",
        output_path: "photo_filtered.jpg",
        filter: "vintage",
        brightness: 10,
        contrast: 5,
        watermark: {
          text: "Copyright 2024",
          position: "bottom-right",
        },
      },
    },
    {
      name: "视频剪辑器",
      toolName: "video_cutter",
      params: {
        input_path: "video.mp4",
        output_path: "clip.mp4",
        start_time: "00:01:30",
        end_time: "00:03:45",
        extract_audio: true,
        audio_format: "mp3",
      },
    },
    {
      name: "视频合并器",
      toolName: "video_merger",
      params: {
        input_files: ["clip1.mp4", "clip2.mp4", "clip3.mp4"],
        output_path: "merged.mp4",
        output_format: "mp4",
        codec: "h264",
        resolution: "1920x1080",
      },
    },
    {
      name: "PDF转换器",
      toolName: "pdf_converter",
      params: {
        input_path: "document.pdf",
        output_path: "document.docx",
        conversion_type: "from_pdf",
        target_format: "docx",
        options: {
          quality: "high",
          ocr: false,
        },
      },
    },
    {
      name: "Office文档转换器",
      toolName: "office_converter",
      params: {
        input_path: "report.docx",
        output_path: "report.pdf",
        source_format: "docx",
        target_format: "pdf",
        preserve_formatting: true,
      },
    },
    {
      name: "高级二维码生成器",
      toolName: "qrcode_generator_advanced",
      params: {
        content: "https://chainlesschain.com",
        output_path: "qrcode.png",
        size: 512,
        error_correction: "H",
        style: {
          foreground_color: "#000000",
          background_color: "#FFFFFF",
          shape: "rounded",
        },
      },
    },
    {
      name: "二维码扫描器",
      toolName: "qrcode_scanner",
      params: {
        image_path: "qrcode.png",
        scan_type: "auto",
        multiple: false,
      },
    },
    {
      name: "截图工具",
      toolName: "screenshot_tool",
      params: {
        output_path: "screenshot.png",
        capture_type: "region",
        region: {
          x: 100,
          y: 100,
          width: 800,
          height: 600,
        },
        include_cursor: false,
        delay: 0,
      },
    },
    {
      name: "屏幕录制器",
      toolName: "screen_recorder",
      params: {
        output_path: "recording.mp4",
        output_format: "mp4",
        capture_type: "fullscreen",
        fps: 30,
        quality: "high",
        record_audio: true,
        duration: 60,
      },
    },
    {
      name: "日历管理器",
      toolName: "calendar_manager",
      params: {
        action: "create",
        event: {
          title: "团队会议",
          description: "讨论项目进度",
          start_time: "2024-01-15T10:00:00",
          end_time: "2024-01-15T11:00:00",
          location: "会议室A",
          attendees: ["user1@example.com", "user2@example.com"],
        },
        calendar_id: "default",
      },
    },
    {
      name: "提醒调度器",
      toolName: "reminder_scheduler",
      params: {
        action: "create",
        reminder: {
          title: "每日站会",
          description: "参加晨会",
          remind_time: "09:00",
          repeat: "daily",
          priority: "high",
        },
      },
    },
    {
      name: "笔记编辑器",
      toolName: "note_editor",
      params: {
        action: "create",
        note: {
          title: "AI技术笔记",
          content: "# AI技术\n\n深度学习和神经网络的基础知识...",
          tags: ["AI", "技术"],
          folder: "技术笔记",
          format: "markdown",
        },
      },
    },
    {
      name: "笔记搜索器",
      toolName: "note_searcher",
      params: {
        query: "AI",
        filters: {
          tags: ["技术"],
          folder: "技术笔记",
        },
        sort_by: "relevance",
        limit: 20,
      },
    },
    {
      name: "高级密码生成器",
      toolName: "password_generator_advanced",
      params: {
        length: 16,
        include_uppercase: true,
        include_lowercase: true,
        include_numbers: true,
        include_symbols: true,
        exclude_ambiguous: true,
        memorable: false,
      },
    },
    {
      name: "密码保险库",
      toolName: "password_vault",
      params: {
        action: "add",
        entry: {
          title: "GitHub账户",
          username: "user@example.com",
          password: "SecurePass123!",
          url: "https://github.com",
          notes: "工作账户",
          tags: ["工作", "开发"],
        },
        master_password: "master123",
      },
    },
    {
      name: "网速测试器",
      toolName: "network_speed_tester",
      params: {
        test_type: "both",
        duration: 10,
      },
    },
    {
      name: "网络诊断工具",
      toolName: "network_diagnostic_tool",
      params: {
        operation: "ping",
        target: "www.google.com",
        options: {
          count: 4,
          timeout: 1000,
        },
      },
    },
  ];

  logger.info("开始测试工具调用...\n");

  let successCount = 0;
  let failCount = 0;

  for (const testCase of testCases) {
    try {
      logger.info(`📝 测试: ${testCase.name} (${testCase.toolName})`);

      const result = await functionCaller.call(
        testCase.toolName,
        testCase.params,
      );

      if (result.success) {
        logger.info(`   ✅ 成功!`);
        // 显示部分结果
        const keys = Object.keys(result)
          .filter((k) => k !== "success" && k !== "error")
          .slice(0, 3);
        keys.forEach((key) => {
          const value = result[key];
          const displayValue =
            typeof value === "object"
              ? JSON.stringify(value).substring(0, 50) + "..."
              : value;
          logger.info(`   → ${key}: ${displayValue}`);
        });
        successCount++;
      } else {
        logger.info(`   ❌ 失败: ${result.error}`);
        failCount++;
      }
    } catch (error) {
      logger.info(`   ❌ 异常: ${error.message}`);
      failCount++;
    }
    logger.info("");
  }

  logger.info("========== 测试结果汇总 ==========");
  logger.info(`总测试数: ${testCases.length}`);
  logger.info(`成功: ${successCount}`);
  logger.info(`失败: ${failCount}`);
  logger.info(
    `成功率: ${((successCount / testCases.length) * 100).toFixed(1)}%`,
  );
  logger.info("================================\n");

  // 列出所有第十二批工具
  logger.info("========== 第十二批工具列表 ==========");
  const batch12ToolNames = [
    "file_compressor",
    "file_decompressor",
    "image_editor",
    "image_filter",
    "video_cutter",
    "video_merger",
    "pdf_converter",
    "office_converter",
    "qrcode_generator_advanced",
    "qrcode_scanner",
    "screenshot_tool",
    "screen_recorder",
    "calendar_manager",
    "reminder_scheduler",
    "note_editor",
    "note_searcher",
    "password_generator_advanced",
    "password_vault",
    "network_speed_tester",
    "network_diagnostic_tool",
  ];

  batch12ToolNames.forEach((toolName, index) => {
    const tool = allTools.find((t) => t.name === toolName);
    if (tool) {
      logger.info(`${index + 1}. ✅ ${tool.name} - ${tool.description}`);
    } else {
      logger.info(`${index + 1}. ❌ ${toolName} - 未注册`);
    }
  });

  logger.info("================================\n");

  return {
    total: testCases.length,
    success: successCount,
    failed: failCount,
  };
}

// 运行测试
if (require.main === module) {
  testBatch12Tools()
    .then((result) => {
      if (result.failed === 0) {
        logger.info("🎉 所有工具测试通过!");
        process.exit(0);
      } else {
        logger.info("⚠️ 部分工具测试失败");
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error("测试执行失败:", error);
      process.exit(1);
    });
}

module.exports = { testBatch12Tools };
