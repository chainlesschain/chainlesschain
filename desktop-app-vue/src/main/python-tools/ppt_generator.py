#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PPT生成工具
使用python-pptx库创建演示文稿
"""

import sys
import json
import os
from datetime import datetime

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.enum.text import PP_ALIGN
    from pptx.dml.color import RGBColor
except ImportError:
    print(json.dumps({
        'success': False,
        'error': '未安装python-pptx，请运行: pip install python-pptx'
    }, ensure_ascii=False))
    sys.exit(1)

class PPTGenerator:
    """PPT生成器"""

    def __init__(self):
        self.prs = Presentation()
        # 设置幻灯片尺寸（16:9）
        self.prs.slide_width = Inches(10)
        self.prs.slide_height = Inches(5.625)

    def create_presentation(self, params):
        """
        创建PPT演示文稿

        参数:
        - title: 演示文稿标题
        - subtitle: 副标题
        - slides: 幻灯片列表 [{ type, title, content, layout }]
        - output_path: 输出路径
        - template: 模板类型 (business/education/creative)
        """
        title = params.get('title', '未命名演示')
        subtitle = params.get('subtitle', '')
        slides = params.get('slides', [])
        output_path = params.get('output_path')
        template = params.get('template', 'business')

        # 创建封面
        self._create_title_slide(title, subtitle, template)

        # 创建内容幻灯片
        for slide_data in slides:
            self._create_content_slide(slide_data, template)

        # 保存
        if not output_path:
            output_path = f"{title}.pptx"

        output_dir = os.path.dirname(output_path)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir, exist_ok=True)

        self.prs.save(output_path)

        return {
            'success': True,
            'output_path': output_path,
            'file_size': os.path.getsize(output_path),
            'slides_count': len(self.prs.slides),
            'created_at': datetime.now().isoformat()
        }

    def _create_title_slide(self, title, subtitle, template):
        """创建封面幻灯片"""
        slide_layout = self.prs.slide_layouts[0]  # 标题幻灯片布局
        slide = self.prs.slides.add_slide(slide_layout)

        title_shape = slide.shapes.title
        subtitle_shape = slide.placeholders[1]

        title_shape.text = title
        subtitle_shape.text = subtitle if subtitle else datetime.now().strftime('%Y年%m月%d日')

        # 根据模板设置样式
        if template == 'business':
            title_shape.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 153)
            title_shape.text_frame.paragraphs[0].font.size = Pt(44)
        elif template == 'education':
            title_shape.text_frame.paragraphs[0].font.color.rgb = RGBColor(46, 125, 50)
            title_shape.text_frame.paragraphs[0].font.size = Pt(40)
        elif template == 'creative':
            title_shape.text_frame.paragraphs[0].font.color.rgb = RGBColor(156, 39, 176)
            title_shape.text_frame.paragraphs[0].font.size = Pt(48)

    def _create_content_slide(self, slide_data, template):
        """创建内容幻灯片"""
        slide_type = slide_data.get('type', 'title_content')
        slide_title = slide_data.get('title', '')
        content = slide_data.get('content', [])

        if slide_type == 'title_only':
            layout = self.prs.slide_layouts[5]  # 仅标题
        elif slide_type == 'two_content':
            layout = self.prs.slide_layouts[3]  # 两栏内容
        else:
            layout = self.prs.slide_layouts[1]  # 标题和内容

        slide = self.prs.slides.add_slide(layout)

        # 设置标题
        if slide.shapes.title:
            slide.shapes.title.text = slide_title

        # 添加内容
        if slide_type == 'title_content':
            self._add_bullet_points(slide, content)
        elif slide_type == 'two_content':
            self._add_two_column_content(slide, content)
        elif slide_type == 'image':
            self._add_image_slide(slide, content)

    def _add_bullet_points(self, slide, content):
        """添加项目符号列表"""
        if len(slide.placeholders) > 1:
            body_shape = slide.placeholders[1]
            tf = body_shape.text_frame
            tf.clear()

            if isinstance(content, list):
                for item in content:
                    p = tf.add_paragraph()
                    p.text = str(item)
                    p.level = 0
                    p.font.size = Pt(18)
            else:
                p = tf.add_paragraph()
                p.text = str(content)
                p.font.size = Pt(18)

    def _add_two_column_content(self, slide, content):
        """添加两栏内容"""
        # TODO: 实现两栏布局
        pass

    def _add_image_slide(self, slide, content):
        """添加图片幻灯片"""
        # TODO: 实现图片插入
        pass

def main():
    """主函数"""
    try:
        if len(sys.argv) < 2:
            raise ValueError('缺少参数')

        args = json.loads(sys.argv[1])

        generator = PPTGenerator()

        operation = args.get('operation', 'create')

        if operation == 'create':
            result = generator.create_presentation(args)
        else:
            raise ValueError(f"不支持的操作: {operation}")

        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()
