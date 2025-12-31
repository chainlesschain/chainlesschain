#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Fix CSS layout issues in style.css"""

import re
import codecs

css_file = 'css/style.css'

with codecs.open(css_file, 'r', 'utf-8') as f:
    content = f.read()

# Fix 1: Download button layout - change from vertical to horizontal
old_btn = (r'\.btn-download-quick \{\s*'
           r'display: inline-flex;\s*'
           r'flex-direction: column;\s*'
           r'align-items: center;\s*'
           r'padding: 20px 48px;\s*'
           r'background: white;\s*'
           r'color: var\(--primary-color\);\s*'
           r'border: none;\s*'
           r'border-radius: var\(--radius-md\);\s*'
           r'font-size: 18px;\s*'
           r'font-weight: 700;\s*'
           r'cursor: pointer;\s*'
           r'transition: var\(--transition\);\s*'
           r'margin-bottom: 20px;\s*'
           r'\}\s*'
           r'\.btn-download-quick:hover \{\s*'
           r'transform: scale\(1\.05\);\s*'
           r'box-shadow: var\(--shadow-lg\);\s*'
           r'\}\s*'
           r'\.btn-download-quick \.icon \{\s*'
           r'font-size: 32px;\s*'
           r'margin-bottom: 8px;\s*'
           r'\}')

new_btn = '''.btn-download-quick {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 18px 48px;
    background: white;
    color: var(--primary-color);
    border: none;
    border-radius: var(--radius-md);
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
    transition: var(--transition);
    margin-bottom: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.btn-download-quick:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.btn-download-quick .icon {
    font-size: 24px;
    line-height: 1;
}'''

content = re.sub(old_btn, new_btn, content, flags=re.MULTILINE)

# Write the fixed content
with codecs.open(css_file, 'w', 'utf-8') as f:
    f.write(content)

print("CSS layout fixes applied successfully!")
print("1. Download button now displays icon and text horizontally")
