import { nextTick } from "vue";
import { message as antMessage } from "ant-design-vue";
import { logger } from "@/utils/logger";
import { TaskPlanner } from "../utils/taskPlanner";
import {
  MessageType,
  createSystemMessage,
  createUserMessage,
  createInterviewMessage,
  createTaskPlanMessage,
} from "../utils/messageTypes";
import {
  sanitizeJSONString,
  resolveProjectOutput,
  cleanForIPC,
} from "../components/projects/chatPanelUtils";

/**
 * ChatPanel 任务规划子系统。从 ChatPanel.vue 提取的 ~1200 LOC composable。
 *
 * 职责：
 *   - shouldUsePlanning: 启发式判断输入是否进入规划流程
 *   - startTaskPlanning: 用户输入 → 需求分析 → 采访 or 直接生成计划
 *   - generateTaskPlanMessage: 任务计划生成 + 按类型（PPT/Word/Excel/MD/HTML）
 *     自动产出对应文件
 *
 * @param {Object} deps - 由父组件注入的引用 / 函数 / props
 * @param {import('vue').Ref<Array>} deps.messages - 消息列表 ref
 * @param {import('vue').Ref<Object>} deps.currentConversation - 当前对话 ref
 * @param {import('vue').Ref<string>} deps.contextMode - 上下文模式 ref
 * @param {Object} deps.props - ChatPanel props（响应式 proxy）
 * @param {Function} deps.scrollToBottom - 滚到底部
 * @param {Function} deps.createConversation - 创建对话（若不存在）
 * @param {Function} deps.safeSetTimeout - useMemoryLeakGuard 提供
 * @param {Function} deps.safeRegisterListener - useMemoryLeakGuard 提供
 * @param {Function} deps.emit - 组件 emit，用于 `files-changed` 等
 */
export function useTaskPlanning({
  messages,
  currentConversation,
  contextMode,
  props,
  scrollToBottom,
  createConversation,
  safeSetTimeout,
  safeRegisterListener,
  emit,
}) {
  /**
   * 判断是否需要使用任务规划
   * @param {string} input - 用户输入
   * @returns {boolean}
   */
  const shouldUsePlanning = (input) => {
    const keywords = [
      "创建",
      "生成",
      "制作",
      "写",
      "做",
      "开发",
      "设计",
      "ppt",
      "PPT",
      "文档",
      "报告",
    ];
    return keywords.some((keyword) => input.includes(keyword));
  };

  /**
   * 启动任务规划流程（基于消息流）
   * @param {string} userInput
   */
  const startTaskPlanning = async (userInput) => {
    logger.info("[ChatPanel] 🚀 启动任务规划流程:", userInput);

    try {
      if (!currentConversation.value) {
        logger.info("[ChatPanel] 对话不存在，创建新对话...");
        await createConversation();

        if (!currentConversation.value) {
          throw new Error("创建对话失败，无法开始任务规划");
        }
      }

      let projectType = "document";
      try {
        const { useProjectStore } = await import("@/stores/project");
        const projectStore = useProjectStore();
        if (props.projectId && projectStore.currentProject?.type) {
          projectType = projectStore.currentProject.type;
        } else if (props.currentFile?.type) {
          const fileTypeMap = {
            md: "document",
            txt: "document",
            doc: "document",
            docx: "document",
            xlsx: "data",
            xls: "data",
            csv: "data",
            ppt: "ppt",
            pptx: "ppt",
            html: "web",
            css: "web",
            js: "web",
            py: "code",
            java: "code",
            ts: "code",
          };
          const ext = props.currentFile.name?.split(".").pop()?.toLowerCase();
          projectType = fileTypeMap[ext] || "document";
        }
      } catch (e) {
        logger.warn("[ChatPanel] 无法获取项目类型，使用默认值:", e);
      }

      const userMessage = createUserMessage(
        userInput,
        currentConversation.value.id,
      );
      messages.value.push(userMessage);
      logger.info(
        "[ChatPanel] 💬 用户消息已添加到列表，当前消息数:",
        messages.value.length,
      );

      await nextTick();
      scrollToBottom();

      if (currentConversation.value && currentConversation.value.id) {
        try {
          await window.electronAPI.conversation.createMessage({
            id: userMessage.id,
            conversation_id: currentConversation.value.id,
            role: "user",
            content: userInput,
            timestamp: userMessage.timestamp,
          });
          logger.info("[ChatPanel] 💾 用户消息已保存，id:", userMessage.id);
        } catch (error) {
          logger.error("[ChatPanel] 保存用户消息失败:", error);
        }
      }

      const analyzingMsg = createSystemMessage(
        "🤔 正在分析您的需求，请稍候...（最长可能需要10分钟）",
        { type: "loading" },
      );
      messages.value.push(analyzingMsg);

      await nextTick();
      scrollToBottom();

      const llmService = {
        chat: async (prompt) => {
          const thinkingMsg = createSystemMessage("💭 AI 思考中...", {
            type: "thinking",
          });
          messages.value.push(thinkingMsg);
          await nextTick();
          scrollToBottom();

          return new Promise((resolve, reject) => {
            let fullResponse = "";
            let streamStarted = false;

            const handleChunk = (chunkData) => {
              if (!streamStarted) {
                streamStarted = true;
                thinkingMsg.content = "";
                thinkingMsg.metadata.type = "streaming";
              }

              fullResponse = chunkData.fullContent;
              thinkingMsg.content = fullResponse;

              const thinkingIndex = messages.value.findIndex(
                (m) => m.id === thinkingMsg.id,
              );
              if (thinkingIndex !== -1) {
                messages.value[thinkingIndex] = {
                  ...thinkingMsg,
                  metadata: { ...thinkingMsg.metadata },
                };
                messages.value = [...messages.value];
              }

              nextTick(() => scrollToBottom());
            };

            const handleComplete = () => {
              const thinkingIndex = messages.value.findIndex(
                (m) => m.id === thinkingMsg.id,
              );
              if (thinkingIndex !== -1) {
                messages.value.splice(thinkingIndex, 1);
              }
              resolve(fullResponse);
            };

            const handleError = (error) => {
              thinkingMsg.content = `❌ LLM调用失败: ${error.message}`;
              thinkingMsg.metadata.type = "error";
              messages.value = [...messages.value];
              reject(new Error(error.message));
            };

            safeRegisterListener("project:aiChatStream-chunk", handleChunk);
            safeRegisterListener(
              "project:aiChatStream-complete",
              handleComplete,
            );
            safeRegisterListener("project:aiChatStream-error", handleError);

            window.electronAPI.project
              .aiChatStream({
                projectId: props.projectId,
                userMessage: prompt,
                conversationHistory: [],
                contextMode: contextMode.value,
                currentFile: null,
                projectInfo: null,
                fileList: [],
              })
              .catch((error) => {
                logger.error("[ChatPanel] ❌ API 调用失败:", error);
                handleError(error);
              });
          });
        },
      };

      const analysis = await TaskPlanner.analyzeRequirements(
        userInput,
        projectType,
        llmService,
      );
      logger.info("[ChatPanel] ✅ 需求分析完成:", analysis);

      analyzingMsg.content = "✅ 需求分析完成";
      analyzingMsg.metadata.type = "success";
      messages.value = [...messages.value];

      await nextTick();

      safeSetTimeout(() => {
        const analyzingIndex = messages.value.findIndex(
          (m) => m.id === analyzingMsg.id,
        );
        if (analyzingIndex !== -1) {
          messages.value.splice(analyzingIndex, 1);
        }
      }, 1000);

      if (analysis.isComplete && analysis.confidence > 0.7) {
        logger.info("[ChatPanel] 需求完整，直接生成任务计划");

        const completeMsgContent = createSystemMessage(
          "✅ 需求分析完成，正在生成任务计划...",
          { type: "success" },
        );
        messages.value.push(completeMsgContent);

        await nextTick();
        scrollToBottom();

        await generateTaskPlanMessage(userInput, analysis, {});
        return;
      }

      if (
        analysis.needsInterview &&
        analysis.suggestedQuestions &&
        analysis.suggestedQuestions.length > 0
      ) {
        logger.info(
          "[ChatPanel] 需求不完整，启动采访模式，问题数:",
          analysis.suggestedQuestions.length,
        );

        const interviewMsg = createInterviewMessage(
          analysis.suggestedQuestions,
          0,
        );
        interviewMsg.metadata.userInput = userInput;
        interviewMsg.metadata.analysis = analysis;

        messages.value.push(interviewMsg);

        if (currentConversation.value && currentConversation.value.id) {
          try {
            await window.electronAPI.conversation.createMessage({
              id: interviewMsg.id,
              conversation_id: currentConversation.value.id,
              role: "system",
              content: interviewMsg.content,
              timestamp: interviewMsg.timestamp,
              type: MessageType.INTERVIEW,
              metadata: cleanForIPC(interviewMsg.metadata),
            });
            logger.info(
              "[ChatPanel] 💾 采访消息已保存到数据库，id:",
              interviewMsg.id,
            );
          } catch (error) {
            logger.error("[ChatPanel] 保存采访消息失败:", error);
          }
        }

        await nextTick();
        scrollToBottom();

        safeSetTimeout(() => {
          scrollToBottom();
        }, 100);

        return;
      }

      const errorMsg = createSystemMessage(
        "❌ 无法分析您的需求，请提供更多详细信息",
        { type: "error" },
      );
      messages.value.push(errorMsg);
    } catch (error) {
      logger.error("[ChatPanel] ❌ 任务规划启动失败:", error);

      const errorMsg = createSystemMessage(`任务规划失败: ${error.message}`, {
        type: "error",
      });
      messages.value.push(errorMsg);

      antMessage.error("任务规划失败: " + error.message);
    }
  };

  /**
   * 生成并添加任务计划消息
   * @param {string} userInput
   * @param {Object} analysis
   * @param {Object} interviewAnswers
   */
  const generateTaskPlanMessage = async (
    userInput,
    analysis,
    interviewAnswers = {},
  ) => {
    logger.info("[ChatPanel] 🔨 开始生成任务计划...");

    try {
      const generatingMsg = createSystemMessage("⚙️ 正在生成任务计划...", {
        type: "loading",
      });
      messages.value.push(generatingMsg);

      await nextTick();
      scrollToBottom();

      const llmService = {
        chat: async (prompt) => {
          const planGenerationMsg = createSystemMessage(
            "📝 正在编写任务计划...",
            { type: "thinking" },
          );
          messages.value.push(planGenerationMsg);
          await nextTick();
          scrollToBottom();

          return new Promise((resolve, reject) => {
            let fullResponse = "";
            let streamStarted = false;

            const handleChunk = (chunkData) => {
              if (!streamStarted) {
                streamStarted = true;
                planGenerationMsg.content = "";
                planGenerationMsg.metadata.type = "streaming";
              }

              fullResponse = chunkData.fullContent;
              planGenerationMsg.content = fullResponse;

              const planGenIndex = messages.value.findIndex(
                (m) => m.id === planGenerationMsg.id,
              );
              if (planGenIndex !== -1) {
                messages.value[planGenIndex] = {
                  ...planGenerationMsg,
                  metadata: { ...planGenerationMsg.metadata },
                };
                messages.value = [...messages.value];
              }
              nextTick(() => scrollToBottom());
            };

            const handleComplete = () => {
              const planGenIndex = messages.value.findIndex(
                (m) => m.id === planGenerationMsg.id,
              );
              if (planGenIndex !== -1) {
                messages.value.splice(planGenIndex, 1);
              }
              resolve(fullResponse);
            };

            const handleError = (error) => {
              planGenerationMsg.content = `❌ 生成失败: ${error.message}`;
              planGenerationMsg.metadata.type = "error";
              messages.value = [...messages.value];
              reject(new Error(error.message));
            };

            safeRegisterListener("project:aiChatStream-chunk", handleChunk);
            safeRegisterListener(
              "project:aiChatStream-complete",
              handleComplete,
            );
            safeRegisterListener("project:aiChatStream-error", handleError);

            window.electronAPI.project
              .aiChatStream({
                projectId: props.projectId,
                userMessage: prompt,
                conversationId: currentConversation.value?.id,
                context: contextMode.value,
              })
              .catch((error) => {
                handleError(error);
              });
          });
        },
      };

      const fakeSession = {
        userInput,
        projectType: "document",
        analysis: {
          collected: analysis.collected || {},
        },
        interview: {
          answers: interviewAnswers,
        },
      };

      const plan = await TaskPlanner.generatePlan(fakeSession, llmService);

      if (!plan) {
        logger.error(
          "[ChatPanel] ❌ TaskPlanner.generatePlan 返回 null/undefined",
        );
        const generatingIndex = messages.value.findIndex(
          (m) => m.id === generatingMsg.id,
        );
        if (generatingIndex !== -1) {
          messages.value.splice(generatingIndex, 1);
        }
        const errorMsg = createSystemMessage("任务计划生成失败，请重试", {
          type: "error",
        });
        messages.value.push(errorMsg);
        return;
      }

      if (!Array.isArray(plan.tasks)) {
        plan.tasks = [];
      }

      logger.info("[ChatPanel] ✅ 任务计划生成完成:", plan);

      const generatingIndex = messages.value.findIndex(
        (m) => m.id === generatingMsg.id,
      );
      if (generatingIndex !== -1) {
        messages.value.splice(generatingIndex, 1);
      }

      const planMsg = createTaskPlanMessage(plan);
      messages.value.push(planMsg);

      if (currentConversation.value && currentConversation.value.id) {
        try {
          await window.electronAPI.conversation.createMessage({
            id: planMsg.id,
            conversation_id: currentConversation.value.id,
            role: "system",
            content: planMsg.content,
            timestamp: planMsg.timestamp,
            type: MessageType.TASK_PLAN,
            metadata: cleanForIPC(planMsg.metadata),
          });
          logger.info(
            "[ChatPanel] 💾 任务计划消息已保存到数据库，id:",
            planMsg.id,
          );
        } catch (error) {
          logger.error("[ChatPanel] 保存任务计划消息失败:", error);
        }
      }

      const isPPTTask =
        userInput.toLowerCase().includes("ppt") ||
        userInput.toLowerCase().includes("演示") ||
        userInput.toLowerCase().includes("幻灯片") ||
        userInput.toLowerCase().includes("powerpoint") ||
        (plan.title && plan.title.toLowerCase().includes("ppt"));

      const isWordTask =
        userInput.toLowerCase().includes("word") ||
        userInput.toLowerCase().includes("docx") ||
        userInput.toLowerCase().includes("文档") ||
        userInput.toLowerCase().includes("报告") ||
        userInput.toLowerCase().includes("总结") ||
        (plan.title &&
          (plan.title.toLowerCase().includes("word") ||
            plan.title.toLowerCase().includes("文档") ||
            plan.title.toLowerCase().includes("报告") ||
            plan.title.toLowerCase().includes("总结")));

      const isExcelTask =
        userInput.toLowerCase().includes("excel") ||
        userInput.toLowerCase().includes("表格") ||
        userInput.toLowerCase().includes("数据分析") ||
        userInput.toLowerCase().includes("xlsx") ||
        userInput.toLowerCase().includes("csv") ||
        (plan.title &&
          (plan.title.toLowerCase().includes("excel") ||
            plan.title.toLowerCase().includes("表格") ||
            plan.title.toLowerCase().includes("数据")));

      const isMarkdownTask =
        userInput.toLowerCase().includes("markdown") ||
        userInput.toLowerCase().includes("md文件") ||
        userInput.toLowerCase().includes("技术文档") ||
        userInput.toLowerCase().includes("笔记") ||
        (plan.title &&
          (plan.title.toLowerCase().includes("markdown") ||
            plan.title.toLowerCase().includes("技术文档")));

      const isWebTask =
        userInput.toLowerCase().includes("网页") ||
        userInput.toLowerCase().includes("html") ||
        userInput.toLowerCase().includes("网站") ||
        userInput.toLowerCase().includes("前端页面") ||
        (plan.title &&
          (plan.title.toLowerCase().includes("网页") ||
            plan.title.toLowerCase().includes("html") ||
            plan.title.toLowerCase().includes("网站")));

      if (isPPTTask) {
        await generatePPT({ plan, llmService });
      }

      if (isWordTask) {
        await generateWord({ plan, llmService });
      }

      if (isExcelTask) {
        await generateExcel({ plan, llmService });
      }

      if (isMarkdownTask) {
        await generateMarkdown({ plan, llmService });
      }

      if (isWebTask) {
        await generateHTML({ plan, llmService });
      }

      await nextTick();
      scrollToBottom();
    } catch (error) {
      logger.error("[ChatPanel] ❌ 任务计划生成失败:", error);

      const generatingIndex = messages.value.findIndex(
        (m) => m.type === MessageType.SYSTEM && m.content.includes("正在生成"),
      );
      if (generatingIndex !== -1) {
        messages.value.splice(generatingIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `生成任务计划失败: ${error.message}`,
        { type: "error" },
      );
      messages.value.push(errorMsg);

      antMessage.error("生成任务计划失败: " + error.message);
    }
  };

  // ─── file-type generators (extracted from generateTaskPlanMessage for clarity) ───

  const generatePPT = async ({ plan, llmService }) => {
    logger.info("[ChatPanel] 🎨 检测到PPT任务，开始生成PPT文件...");

    const generatingPPTMsg = createSystemMessage("⏳ 正在生成PPT文件...", {
      type: "info",
    });
    messages.value.push(generatingPPTMsg);
    await nextTick();
    scrollToBottom();

    try {
      const outlinePrompt = `请根据以下任务计划，生成一个详细的PPT演示文稿大纲。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成一个包含标题、副标题和多个章节的PPT大纲，每个章节包含标题和要点列表。

要求返回JSON格式：
\`\`\`json
{
  "title": "PPT标题",
  "subtitle": "副标题",
  "sections": [
    {
      "title": "章节1标题",
      "subsections": [
        {
          "title": "子章节标题",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    }
  ]
}
\`\`\``;

      const outlineResponse = await llmService.chat(outlinePrompt);

      const jsonMatch =
        outlineResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        outlineResponse.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error("无法从LLM响应中提取PPT大纲JSON");
      }

      const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
      const outline = JSON.parse(sanitizedJSON);

      generatingPPTMsg.content = "⏳ 正在写入PPT文件...";
      messages.value = [...messages.value];

      const { outputPath } = await resolveProjectOutput(
        props.projectId,
        outline.title || "presentation",
        "pptx",
        "presentation",
      );

      const result = await window.electronAPI.aiEngine.generatePPT({
        outline,
        theme: "business",
        author: "用户",
        outputPath,
      });

      if (result.success) {
        logger.info("[ChatPanel] ✅ PPT文件生成成功:", result.fileName);

        const genPPTIndex = messages.value.findIndex(
          (m) => m.id === generatingPPTMsg.id,
        );
        if (genPPTIndex !== -1) {
          messages.value.splice(genPPTIndex, 1);
        }

        const successMsg = createSystemMessage(
          `✅ PPT文件已生成: ${result.fileName}\n📁 保存位置: ${result.path}\n📊 幻灯片数量: ${result.slideCount}`,
          { type: "success" },
        );
        messages.value.push(successMsg);

        antMessage.success(`PPT文件已生成: ${result.fileName}`);

        safeSetTimeout(() => {
          emit("files-changed");
        }, 2000);
      } else {
        throw new Error(result.error || "生成PPT失败");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[ChatPanel] ❌ 生成PPT文件失败:", {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });

      const genPPTIndex = messages.value.findIndex(
        (m) => m.id === generatingPPTMsg.id,
      );
      if (genPPTIndex !== -1) {
        messages.value.splice(genPPTIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `⚠️ PPT文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建PPT`,
        { type: "warning" },
      );
      messages.value.push(errorMsg);

      antMessage.warning("PPT文件生成失败，但任务计划已完成");
    }
  };

  const generateWord = async ({ plan, llmService }) => {
    logger.info("[ChatPanel] 📝 检测到Word文档任务，开始生成Word文件...");

    const generatingWordMsg = createSystemMessage("⏳ 正在生成Word文档...", {
      type: "info",
    });
    messages.value.push(generatingWordMsg);
    await nextTick();
    scrollToBottom();

    try {
      const structurePrompt = `请根据以下任务计划，生成一个详细的Word文档结构。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成一个包含标题和多个段落的文档结构，内容要正式、专业。

要求返回JSON格式：
\`\`\`json
{
  "title": "文档标题",
  "paragraphs": [
    {
      "heading": "章节标题",
      "level": 1,
      "content": "段落内容"
    }
  ]
}
\`\`\``;

      const structureResponse = await llmService.chat(structurePrompt);

      const jsonMatch =
        structureResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        structureResponse.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error("无法从LLM响应中提取文档结构JSON");
      }

      const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
      const rawDocumentStructure = JSON.parse(sanitizedJSON);

      // LLM 返回 { heading: "string", level: number, content: "string" }；
      // word-engine 期望 { text: "string", heading: number }
      const documentStructure = {
        title: rawDocumentStructure.title || "文档",
        paragraphs: (rawDocumentStructure.paragraphs || []).map((para) => ({
          text: para.content || para.text || para.heading || "",
          heading:
            para.level ||
            (typeof para.heading === "number" ? para.heading : undefined),
          alignment: para.alignment || "left",
          style: para.style || {},
          spacing: para.spacing || { after: 200 },
        })),
      };

      generatingWordMsg.content = "⏳ 正在写入Word文件...";
      messages.value = [...messages.value];

      const { outputPath } = await resolveProjectOutput(
        props.projectId,
        documentStructure.title || "document",
        "docx",
        "document",
      );

      const result = await window.electronAPI.aiEngine.generateWord({
        structure: documentStructure,
        outputPath,
      });

      if (result.success) {
        logger.info("[ChatPanel] ✅ Word文件生成成功:", result.fileName);

        const genWordIndex = messages.value.findIndex(
          (m) => m.id === generatingWordMsg.id,
        );
        if (genWordIndex !== -1) {
          messages.value.splice(genWordIndex, 1);
        }

        const successMsg = createSystemMessage(
          `✅ Word文档已生成: ${result.fileName}\n📁 保存位置: ${result.path}\n📄 段落数量: ${result.paragraphCount || 0}`,
          { type: "success" },
        );
        messages.value.push(successMsg);

        antMessage.success(`Word文档已生成: ${result.fileName}`);

        safeSetTimeout(() => {
          emit("files-changed");
        }, 2000);
      } else {
        throw new Error(result.error || "生成Word文档失败");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[ChatPanel] ❌ 生成Word文件失败:", {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });

      const genWordIndex = messages.value.findIndex(
        (m) => m.id === generatingWordMsg.id,
      );
      if (genWordIndex !== -1) {
        messages.value.splice(genWordIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `⚠️ Word文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Word文档`,
        { type: "warning" },
      );
      messages.value.push(errorMsg);

      antMessage.warning("Word文件生成失败，但任务计划已完成");
    }
  };

  const generateExcel = async ({ plan, llmService }) => {
    logger.info("[ChatPanel] 📊 检测到Excel任务，开始生成Excel文件...");

    const generatingExcelMsg = createSystemMessage("⏳ 正在生成Excel文件...", {
      type: "info",
    });
    messages.value.push(generatingExcelMsg);
    await nextTick();
    scrollToBottom();

    try {
      const dataPrompt = `请根据以下任务计划，生成一个Excel数据结构。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成包含表头和数据行的结构。

要求返回JSON格式：
\`\`\`json
{
  "sheetName": "Sheet1",
  "headers": ["列1", "列2", "列3"],
  "data": [
    ["数据1", "数据2", "数据3"],
    ["数据4", "数据5", "数据6"]
  ]
}
\`\`\``;

      const dataResponse = await llmService.chat(dataPrompt);

      const jsonMatch =
        dataResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        dataResponse.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error("无法从LLM响应中提取数据结构JSON");
      }

      const sanitizedJSON = sanitizeJSONString(jsonMatch[1]);
      const dataStructure = JSON.parse(sanitizedJSON);

      generatingExcelMsg.content = "⏳ 正在写入Excel文件...";
      messages.value = [...messages.value];

      const { fileName, outputPath } = await resolveProjectOutput(
        props.projectId,
        plan.title || "data",
        "xlsx",
        "data",
      );

      await window.electronAPI.file.writeExcel(outputPath, {
        sheetName: dataStructure.sheetName || "Sheet1",
        headers: dataStructure.headers,
        data: dataStructure.data,
      });

      logger.info("[ChatPanel] ✅ Excel文件生成成功");

      const genExcelIndex = messages.value.findIndex(
        (m) => m.id === generatingExcelMsg.id,
      );
      if (genExcelIndex !== -1) {
        messages.value.splice(genExcelIndex, 1);
      }

      const successMsg = createSystemMessage(
        `✅ Excel文件已生成: ${fileName}\n📁 保存位置: ${outputPath}\n📊 数据行数: ${dataStructure.data.length}`,
        { type: "success" },
      );
      messages.value.push(successMsg);

      antMessage.success(`Excel文件已生成: ${fileName}`);

      safeSetTimeout(() => {
        emit("files-changed");
      }, 2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[ChatPanel] ❌ 生成Excel文件失败:", {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });

      const genExcelIndex = messages.value.findIndex(
        (m) => m.id === generatingExcelMsg.id,
      );
      if (genExcelIndex !== -1) {
        messages.value.splice(genExcelIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `⚠️ Excel文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Excel文件`,
        { type: "warning" },
      );
      messages.value.push(errorMsg);

      antMessage.warning("Excel文件生成失败，但任务计划已完成");
    }
  };

  const generateMarkdown = async ({ plan, llmService }) => {
    logger.info("[ChatPanel] 📄 检测到Markdown任务，开始生成Markdown文件...");

    const generatingMdMsg = createSystemMessage("⏳ 正在生成Markdown文档...", {
      type: "info",
    });
    messages.value.push(generatingMdMsg);
    await nextTick();
    scrollToBottom();

    try {
      const mdPrompt = `请根据以下任务计划，生成一个Markdown文档内容。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成完整的Markdown格式内容，包含标题、章节、列表等。`;

      const mdResponse = await llmService.chat(mdPrompt);

      generatingMdMsg.content = "⏳ 正在写入Markdown文件...";
      messages.value = [...messages.value];

      const { fileName, outputPath } = await resolveProjectOutput(
        props.projectId,
        plan.title || "document",
        "md",
        "document",
      );

      await window.electronAPI.file.writeContent(outputPath, mdResponse);

      logger.info("[ChatPanel] ✅ Markdown文件生成成功");

      const genMdIndex = messages.value.findIndex(
        (m) => m.id === generatingMdMsg.id,
      );
      if (genMdIndex !== -1) {
        messages.value.splice(genMdIndex, 1);
      }

      const successMsg = createSystemMessage(
        `✅ Markdown文档已生成: ${fileName}\n📁 保存位置: ${outputPath}`,
        { type: "success" },
      );
      messages.value.push(successMsg);

      antMessage.success(`Markdown文档已生成: ${fileName}`);

      safeSetTimeout(() => {
        emit("files-changed");
      }, 2000);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("[ChatPanel] ❌ 生成Markdown文件失败:", {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });

      const genMdIndex = messages.value.findIndex(
        (m) => m.id === generatingMdMsg.id,
      );
      if (genMdIndex !== -1) {
        messages.value.splice(genMdIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `⚠️ Markdown文件生成失败: ${errorMessage || "未知错误"}\n📋 任务计划已生成，您可以稍后手动创建Markdown文档`,
        { type: "warning" },
      );
      messages.value.push(errorMsg);

      antMessage.warning("Markdown文件生成失败，但任务计划已完成");
    }
  };

  const generateHTML = async ({ plan, llmService }) => {
    logger.info("[ChatPanel] 🌐 检测到网页任务，开始生成HTML文件...");

    const generatingWebMsg = createSystemMessage("⏳ 正在生成网页文件...", {
      type: "info",
    });
    messages.value.push(generatingWebMsg);
    await nextTick();
    scrollToBottom();

    try {
      const htmlPrompt = `请根据以下任务计划，生成一个完整的HTML网页。

任务标题: ${plan.title}
任务摘要: ${plan.summary || ""}
任务列表:
${plan.tasks.map((task, index) => `${index + 1}. ${task.title || task.description}`).join("\n")}

请生成包含HTML、CSS和基本交互的完整网页代码。`;

      const htmlResponse = await llmService.chat(htmlPrompt);

      let htmlContent = htmlResponse;
      const htmlMatch = htmlResponse.match(/```(?:html)?\s*([\s\S]*?)\s*```/);
      if (htmlMatch) {
        htmlContent = htmlMatch[1];
      }

      generatingWebMsg.content = "⏳ 正在写入HTML文件...";
      messages.value = [...messages.value];

      const { fileName, outputPath } = await resolveProjectOutput(
        props.projectId,
        plan.title || "index",
        "html",
        "index",
      );

      await window.electronAPI.file.writeContent(outputPath, htmlContent);

      logger.info("[ChatPanel] ✅ 网页文件生成成功");

      const genWebIndex = messages.value.findIndex(
        (m) => m.id === generatingWebMsg.id,
      );
      if (genWebIndex !== -1) {
        messages.value.splice(genWebIndex, 1);
      }

      const successMsg = createSystemMessage(
        `✅ 网页文件已生成: ${fileName}\n📁 保存位置: ${outputPath}`,
        { type: "success" },
      );
      messages.value.push(successMsg);

      antMessage.success(`网页文件已生成: ${fileName}`);

      safeSetTimeout(() => {
        emit("files-changed");
      }, 2000);
    } catch (error) {
      logger.error("[ChatPanel] ❌ 生成网页文件失败:", error);

      const genWebIndex = messages.value.findIndex(
        (m) => m.id === generatingWebMsg.id,
      );
      if (genWebIndex !== -1) {
        messages.value.splice(genWebIndex, 1);
      }

      const errorMsg = createSystemMessage(
        `⚠️ 网页文件生成失败: ${error.message}\n📋 任务计划已生成，您可以稍后手动创建网页`,
        { type: "warning" },
      );
      messages.value.push(errorMsg);

      antMessage.warning("网页文件生成失败，但任务计划已完成");
    }
  };

  return {
    shouldUsePlanning,
    startTaskPlanning,
    generateTaskPlanMessage,
  };
}
