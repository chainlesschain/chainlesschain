#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
环境检查工具
检查Python版本和必需的依赖包
"""

import sys
import json

def check_environment():
    """检查Python环境"""
    result = {
        'success': True,
        'python_version': f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        'dependencies': {}
    }

    # 需要检查的依赖包
    required_packages = [
        'docx',           # python-docx (Word)
        'openpyxl',       # Excel
        'pptx',           # python-pptx (PPT)
        'reportlab',      # PDF
        'pandas',         # 数据分析
        'matplotlib',     # 图表
        'PIL',            # Pillow (图像处理)
    ]

    for package_name in required_packages:
        try:
            __import__(package_name)
            result['dependencies'][package_name] = {
                'installed': True,
                'version': get_package_version(package_name)
            }
        except ImportError:
            result['dependencies'][package_name] = {
                'installed': False,
                'version': None
            }
            result['success'] = False

    return result

def get_package_version(package_name):
    """获取包版本"""
    try:
        import importlib.metadata
        return importlib.metadata.version(package_name)
    except:
        try:
            import pkg_resources
            return pkg_resources.get_distribution(package_name).version
        except:
            return 'unknown'

if __name__ == '__main__':
    try:
        # 获取参数（如果有）
        if len(sys.argv) > 1:
            args = json.loads(sys.argv[1])
        else:
            args = {}

        # 执行检查
        result = check_environment()

        # 输出JSON结果
        print(json.dumps(result, ensure_ascii=False, indent=2))

    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'type': type(e).__name__
        }
        print(json.dumps(error_result, ensure_ascii=False))
        sys.exit(1)
