/**
 * PPT生成引擎
 * 负责根据大纲或Markdown内容生成PowerPoint演示文稿
 * 使用PptxGenJS库实现
 */

const pptxgen = require('pptxgenjs');
const fs = require('fs').promises;
const path = require('path');

class PPTEngine {
  constructor() {
    // PPT主题配置
    this.themes = {
      business: {
        name: '商务主题',
        primaryColor: '1E40AF',
        secondaryColor: '3B82F6',
        backgroundColor: 'FFFFFF',
        textColor: '1F2937'
      },
      academic: {
        name: '学术主题',
        primaryColor: '7C3AED',
        secondaryColor: 'A78BFA',
        backgroundColor: 'FFFFFF',
        textColor: '374151'
      },
      creative: {
        name: '创意主题',
        primaryColor: 'EC4899',
        secondaryColor: 'F472B6',
        backgroundColor: 'FFFFFF',
        textColor: '111827'
      },
      dark: {
        name: '深色主题',
        primaryColor: '3B82F6',
        secondaryColor: '60A5FA',
        backgroundColor: '1F2937',
        textColor: 'F9FAFB'
      }
    };
  }

  /**
   * 从大纲生成PPT
   * @param {Object} outline - PPT大纲
   * @param {Object} options - 生成选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateFromOutline(outline, options = {}) {
    const {
      theme = 'business',
      author = '作者',
      outputPath,
      llmManager
    } = options;

    console.log('[PPT Engine] 开始生成PPT:', outline.title);

    try {
      const ppt = new pptxgen();
      ppt.author = author;
      ppt.title = outline.title || '演示文稿';
      ppt.company = 'ChainlessChain';

      const themeConfig = this.themes[theme] || this.themes.business;

      // 生成标题页
      this.createTitleSlide(ppt, outline.title, outline.subtitle, author, themeConfig);

      // 生成内容页
      if (outline.sections) {
        for (const section of outline.sections) {
          this.createSectionSlide(ppt, section.title, themeConfig);

          if (section.subsections) {
            for (const subsection of section.subsections) {
              this.createContentSlide(ppt, {
                title: subsection.title,
                bulletPoints: subsection.points,
                layout: 'content'
              }, themeConfig);
            }
          }
        }
      }

      // 生成结束页
      this.createEndSlide(ppt, '谢谢观看', themeConfig);

      // 保存文件
      const fileName = `${outline.title || 'presentation'}.pptx`;
      const filePath = outputPath || path.join(process.cwd(), fileName);

      await ppt.writeFile({ fileName: filePath });

      console.log('[PPT Engine] PPT生成成功:', filePath);

      return {
        success: true,
        path: filePath,
        fileName,
        slideCount: ppt.slides.length,
        theme
      };
    } catch (error) {
      console.error('[PPT Engine] 生成PPT失败:', error);
      throw new Error(`生成PPT失败: ${error.message}`);
    }
  }

  /**
   * 创建标题页
   */
  createTitleSlide(ppt, title, subtitle, author, theme) {
    const slide = ppt.addSlide();
    slide.background = { color: theme.backgroundColor };

    slide.addText(title || '演示文稿标题', {
      x: 0.5, y: 2.0, w: 9, h: 1.5,
      fontSize: 44, bold: true,
      color: theme.primaryColor,
      align: 'center',
      fontFace: 'Microsoft YaHei'
    });

    if (subtitle) {
      slide.addText(subtitle, {
        x: 0.5, y: 3.8, w: 9, h: 0.8,
        fontSize: 24,
        color: theme.secondaryColor,
        align: 'center',
        fontFace: 'Microsoft YaHei'
      });
    }

    const date = new Date().toLocaleDateString('zh-CN');
    slide.addText(`${author} | ${date}`, {
      x: 0.5, y: 5.0, w: 9, h: 0.5,
      fontSize: 14,
      color: theme.textColor,
      align: 'center',
      fontFace: 'Microsoft YaHei'
    });
  }

  /**
   * 创建章节页
   */
  createSectionSlide(ppt, sectionTitle, theme) {
    const slide = ppt.addSlide();
    slide.background = { color: theme.primaryColor, transparency: 10 };

    slide.addText(sectionTitle, {
      x: 0.5, y: 2.5, w: 9, h: 1.5,
      fontSize: 40, bold: true,
      color: theme.primaryColor,
      align: 'center',
      fontFace: 'Microsoft YaHei'
    });
  }

  /**
   * 创建内容页
   */
  createContentSlide(ppt, slideData, theme) {
    const slide = ppt.addSlide();
    slide.background = { color: theme.backgroundColor };

    slide.addText(slideData.title || '内容标题', {
      x: 0.5, y: 0.5, w: 9, h: 0.8,
      fontSize: 32, bold: true,
      color: theme.primaryColor,
      fontFace: 'Microsoft YaHei'
    });

    if (slideData.bulletPoints && slideData.bulletPoints.length > 0) {
      const bulletItems = slideData.bulletPoints.map(point => ({
        text: point,
        options: {
          bullet: { type: 'number' },
          fontSize: 18,
          color: theme.textColor
        }
      }));

      slide.addText(bulletItems, {
        x: 1.0, y: 1.8, w: 8, h: 3.5,
        fontSize: 18,
        color: theme.textColor,
        fontFace: 'Microsoft YaHei'
      });
    }
  }

  /**
   * 创建结束页
   */
  createEndSlide(ppt, message, theme) {
    const slide = ppt.addSlide();
    slide.background = { color: theme.backgroundColor };

    slide.addText(message || '谢谢观看', {
      x: 0.5, y: 2.5, w: 9, h: 1.5,
      fontSize: 48, bold: true,
      color: theme.primaryColor,
      align: 'center',
      fontFace: 'Microsoft YaHei'
    });
  }

  /**
   * 处理项目任务
   * @param {Object} params - 任务参数
   */
  async handleProjectTask(params) {
    const { description, projectPath, llmManager } = params;

    console.log('[PPT Engine] 处理PPT生成任务');

    try {
      const outline = await this.generateOutlineFromDescription(description, llmManager);
      const result = await this.generateFromOutline(outline, {
        outputPath: path.join(projectPath, `${outline.title}.pptx`),
        llmManager
      });

      return {
        type: 'presentation',
        ...result
      };
    } catch (error) {
      console.error('[PPT Engine] 任务执行失败:', error);
      throw error;
    }
  }

  /**
   * 从描述生成PPT大纲
   */
  async generateOutlineFromDescription(description, llmManager) {
    const prompt = `请根据以下描述生成一份PPT大纲（JSON格式）：

${description}

返回JSON格式：
{
  "title": "PPT标题",
  "subtitle": "副标题",
  "sections": [
    {
      "title": "章节1",
      "subsections": [
        {"title": "子主题1", "points": ["要点1", "要点2"]}
      ]
    }
  ]
}`;

    const response = await llmManager.query(prompt, {
      temperature: 0.7,
      maxTokens: 2000
    });

    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return {
        title: description.substring(0, 50),
        subtitle: '使用ChainlessChain生成',
        sections: []
      };
    } catch (error) {
      return {
        title: description.substring(0, 50),
        subtitle: '使用ChainlessChain生成',
        sections: []
      };
    }
  }
}

module.exports = PPTEngine;
