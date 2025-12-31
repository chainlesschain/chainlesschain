# -*- coding: utf-8 -*-
import json
import re

files = [
    'desktop-app-vue/src/main/templates/ecommerce/product-detail-page.json',
    'desktop-app-vue/src/main/templates/travel/cultural-immersion-trip.json'
]

for filepath in files:
    print(f'\n修复: {filepath}')

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 找到 "prompt_template": "..." 然后紧跟着 "variables_schema":
    # 需要在中间添加逗号

    # 方法：找到prompt_template的结束引号位置
    # 然后检查下一个非空白字符是否是逗号

    lines = content.split('\n')
    fixed = False

    for i, line in enumerate(lines):
        # 找到包含 variables_schema 的行
        if '"variables_schema":' in line and i > 0:
            prev_line = lines[i-1]
            # 检查上一行是否以引号结尾但没有逗号
            if prev_line.rstrip().endswith('"') and not prev_line.rstrip().endswith('",'):
                # 在引号后添加逗号
                lines[i-1] = prev_line.rstrip() + ','
                fixed = True
                print(f'  在第 {i} 行前添加逗号')
                break

    if fixed:
        new_content = '\n'.join(lines)

        # 验证JSON
        try:
            json.loads(new_content)
            # 保存
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print('  ✅ 修复并验证成功')
        except json.JSONDecodeError as e:
            print(f'  ❌ 验证失败: {e}')
    else:
        print('  ⚠️  未找到需要修复的位置')
