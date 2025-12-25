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
   * 从Markdown生成PPT
   * @param {string} markdownContent - Markdown内容
   * @param {Object} options - 生成选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateFromMarkdown(markdownContent, options = {}) {
    const {
      theme = 'business',
      author = '作者',
      outputPath,
      llmManager
    } = options;

    console.log('[PPT Engine] 从Markdown生成PPT');

    try {
      // 解析Markdown结构
      const outline = this.parseMarkdownToOutline(markdownContent);

      // 如果解析失败或内容不够，使用LLM增强
      if (!outline.sections || outline.sections.length === 0) {
        console.log('[PPT Engine] Markdown解析内容不足，使用LLM增强...');
        const enhancedOutline = await this.generateOutlineFromDescription(
          markdownContent.substring(0, 1000),
          llmManager
        );
        outline.sections = enhancedOutline.sections;
      }

      // 生成PPT
      return await this.generateFromOutline(outline, {
        theme,
        author,
        outputPath,
        llmManager
      });
    } catch (error) {
      console.error('[PPT Engine] 从Markdown生成PPT失败:', error);
      throw new Error(`从Markdown生成PPT失败: ${error.message}`);
    }
  }

  /**
   * 解析Markdown为PPT大纲
   * @param {string} markdown - Markdown内容
   * @returns {Object} PPT大纲
   */
  parseMarkdownToOutline(markdown) {
    const lines = markdown.split('\n');
    const outline = {
      title: '',
      subtitle: '',
      sections: []
    };

    let currentSection = null;
    let currentSubsection = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 一级标题作为PPT标题
      if (line.startsWith('# ')) {
        if (!outline.title) {
          outline.title = line.substring(2).trim();
        } else {
          // 如果已有标题，一级标题作为章节
          if (currentSection) {
            outline.sections.push(currentSection);
          }
          currentSection = {
            title: line.substring(2).trim(),
            subsections: []
          };
          currentSubsection = null;
        }
      }
      // 二级标题作为章节
      else if (line.startsWith('## ')) {
        if (currentSection) {
          outline.sections.push(currentSection);
        }
        currentSection = {
          title: line.substring(3).trim(),
          subsections: []
        };
        currentSubsection = null;
      }
      // 三级标题作为子主题
      else if (line.startsWith('### ')) {
        if (currentSection) {
          if (currentSubsection) {
            currentSection.subsections.push(currentSubsection);
          }
          currentSubsection = {
            title: line.substring(4).trim(),
            points: []
          };
        }
      }
      // 列表项作为要点
      else if (line.match(/^[-*+]\s+(.+)$/)) {
        const point = line.replace(/^[-*+]\s+/, '').trim();
        if (currentSubsection) {
          currentSubsection.points.push(point);
        } else if (currentSection) {
          // 如果没有子主题，创建一个默认子主题
          if (!currentSubsection) {
            currentSubsection = {
              title: currentSection.title,
              points: []
            };
          }
          currentSubsection.points.push(point);
        }
      }
      // 数字列表
      else if (line.match(/^\d+\.\s+(.+)$/)) {
        const point = line.replace(/^\d+\.\s+/, '').trim();
        if (currentSubsection) {
          currentSubsection.points.push(point);
        } else if (currentSection) {
          if (!currentSubsection) {
            currentSubsection = {
              title: currentSection.title,
              points: []
            };
          }
          currentSubsection.points.push(point);
        }
      }
      // 普通段落文本作为要点
      else if (line && !line.startsWith('#') && currentSection) {
        // 跳过太短的行和分隔线
        if (line.length > 10 && !line.match(/^[-=]+$/)) {
          if (!currentSubsection) {
            currentSubsection = {
              title: currentSection.title,
              points: []
            };
          }
          // 限制每个要点的长度
          if (line.length > 100) {
            currentSubsection.points.push(line.substring(0, 100) + '...');
          } else {
            currentSubsection.points.push(line);
          }
        }
      }
    }

    // 添加最后的子主题和章节
    if (currentSubsection && currentSection) {
      currentSection.subsections.push(currentSubsection);
    }
    if (currentSection) {
      outline.sections.push(currentSection);
    }

    // 如果没有标题，使用第一个章节的标题
    if (!outline.title && outline.sections.length > 0) {
      outline.title = outline.sections[0].title;
      outline.sections.shift();
    }

    // 设置默认副标题
    if (!outline.subtitle) {
      outline.subtitle = new Date().toLocaleDateString('zh-CN');
    }

    return outline;
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

  /**
   * 添加图表到幻灯片
   * @param {Object} slide - pptxgenjs幻灯片对象
   * @param {Object} chartData - 图表数据
   * @param {Object} theme - 主题配置
   */
  addChart(slide, chartData, theme) {
    const {
      type = 'bar',
      title = '图表',
      data = [],
      position = { x: 1, y: 2, w: 8, h: 4 }
    } = chartData;

    try {
      // 添加图表标题
      slide.addText(title, {
        x: position.x,
        y: position.y - 0.5,
        w: position.w,
        h: 0.4,
        fontSize: 18,
        bold: true,
        color: theme.primaryColor,
        fontFace: 'Microsoft YaHei'
      });

      // 准备图表数据
      const chartConfig = {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
        chartColors: [theme.primaryColor, theme.secondaryColor, '10B981', 'F59E0B', 'EF4444']
      };

      // 根据类型添加图表
      slide.addChart(type, data, chartConfig);
    } catch (error) {
      console.error('[PPT Engine] 添加图表失败:', error);
    }
  }

  /**
   * 添加图片到幻灯片
   * @param {Object} slide - pptxgenjs幻灯片对象
   * @param {Object} imageData - 图片数据
   */
  addImage(slide, imageData) {
    const {
      path: imagePath,
      data: imageDataUrl,
      position = { x: 2, y: 2, w: 6, h: 4 }
    } = imageData;

    try {
      const imageConfig = {
        x: position.x,
        y: position.y,
        w: position.w,
        h: position.h,
        sizing: { type: 'contain' }
      };

      // 支持文件路径或Data URL
      if (imagePath) {
        imageConfig.path = imagePath;
      } else if (imageDataUrl) {
        imageConfig.data = imageDataUrl;
      }

      slide.addImage(imageConfig);
    } catch (error) {
      console.error('[PPT Engine] 添加图片失败:', error);
    }
  }
}

module.exports = PPTEngine;
