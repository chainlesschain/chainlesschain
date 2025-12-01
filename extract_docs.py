import docx
import sys

def extract_docx(filepath):
    """Extract text from .docx file"""
    try:
        doc = docx.Document(filepath)
        text = []
        for para in doc.paragraphs:
            text.append(para.text)
        return '\n'.join(text)
    except Exception as e:
        return f"Error reading {filepath}: {str(e)}"

if __name__ == "__main__":
    files = [
        "一种基于U盾和SIMKey的个人移动AI知识库.docx",
        "（提交版本）一种基于U盾和SIMKey的个人移动去中心化AI社交方法.doc",
        "一种基于U盾和SIMKey的移动去中心化AI辅助达成交易的构建方法-定稿.doc"
    ]

    for filepath in files:
        print(f"\n{'='*80}")
        print(f"FILE: {filepath}")
        print(f"{'='*80}\n")
        content = extract_docx(filepath)
        print(content)
        print("\n")
