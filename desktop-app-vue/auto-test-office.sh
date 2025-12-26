#!/bin/bash

# Office文件预览自动化测试脚本
# 用法: bash auto-test-office.sh

echo "================================"
echo "  Office文件预览自动化测试"
echo "================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试结果统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
test_result() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $2"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ FAIL${NC}: $2"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

# 1. 检查项目目录
echo -e "${BLUE}[1/6]${NC} 检查项目目录..."
PROJECT_DIR="C:/code/chainlesschain/data/projects"
if [ -d "$PROJECT_DIR" ]; then
    PROJECT_COUNT=$(ls -1 "$PROJECT_DIR" | wc -l)
    test_result 0 "项目目录存在，共 $PROJECT_COUNT 个项目"
else
    test_result 1 "项目目录不存在"
    exit 1
fi

# 2. 统计Office文件
echo ""
echo -e "${BLUE}[2/6]${NC} 统计Office文件..."

WORD_COUNT=$(find "$PROJECT_DIR" -name "*.docx" 2>/dev/null | wc -l)
EXCEL_COUNT=$(find "$PROJECT_DIR" -name "*.xlsx" 2>/dev/null | wc -l)
PPT_COUNT=$(find "$PROJECT_DIR" -name "*.pptx" 2>/dev/null | wc -l)

echo "  Word文档: $WORD_COUNT 个"
echo "  Excel表格: $EXCEL_COUNT 个"
echo "  PPT演示: $PPT_COUNT 个"

test_result 0 "Office文件统计完成"

# 3. 测试Word文件
echo ""
echo -e "${BLUE}[3/6]${NC} 测试Word文件..."

if [ $WORD_COUNT -gt 0 ]; then
    # 获取最新的Word文件
    LATEST_WORD=$(find "$PROJECT_DIR" -name "*.docx" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | cut -d' ' -f2-)

    if [ -n "$LATEST_WORD" ]; then
        echo "  最新Word文件: $LATEST_WORD"

        # 检查文件大小
        FILE_SIZE=$(stat -c%s "$LATEST_WORD" 2>/dev/null)
        if [ $FILE_SIZE -gt 0 ]; then
            test_result 0 "Word文件大小: $FILE_SIZE 字节"
        else
            test_result 1 "Word文件为空"
        fi

        # 检查文件类型
        FILE_TYPE=$(file -b "$LATEST_WORD" 2>/dev/null)
        if [[ "$FILE_TYPE" == *"Microsoft Word"* ]] || [[ "$FILE_TYPE" == *"Zip archive"* ]]; then
            test_result 0 "Word文件格式正确: $FILE_TYPE"
        else
            test_result 1 "Word文件格式错误: $FILE_TYPE"
        fi

        # 尝试解压检查内容
        if command -v unzip &> /dev/null; then
            TMP_DIR="/tmp/docx_test_$$"
            mkdir -p "$TMP_DIR"
            unzip -q "$LATEST_WORD" -d "$TMP_DIR" 2>/dev/null
            if [ $? -eq 0 ]; then
                if [ -f "$TMP_DIR/word/document.xml" ]; then
                    test_result 0 "Word文件结构完整"

                    # 检查是否有内容
                    CONTENT_SIZE=$(stat -c%s "$TMP_DIR/word/document.xml" 2>/dev/null)
                    if [ $CONTENT_SIZE -gt 100 ]; then
                        test_result 0 "Word文件包含内容 ($CONTENT_SIZE 字节)"
                    else
                        test_result 1 "Word文件内容过少"
                    fi
                else
                    test_result 1 "Word文件结构不完整"
                fi
                rm -rf "$TMP_DIR"
            else
                test_result 1 "无法解压Word文件"
            fi
        else
            echo "  ${YELLOW}⚠${NC} 未安装unzip，跳过内部结构检查"
        fi
    else
        test_result 1 "未找到Word文件"
    fi
else
    test_result 1 "没有Word文件可测试"
fi

# 4. 测试Excel文件
echo ""
echo -e "${BLUE}[4/6]${NC} 测试Excel文件..."

if [ $EXCEL_COUNT -gt 0 ]; then
    LATEST_EXCEL=$(find "$PROJECT_DIR" -name "*.xlsx" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | cut -d' ' -f2-)

    if [ -n "$LATEST_EXCEL" ]; then
        echo "  最新Excel文件: $LATEST_EXCEL"

        FILE_SIZE=$(stat -c%s "$LATEST_EXCEL" 2>/dev/null)
        if [ $FILE_SIZE -gt 0 ]; then
            test_result 0 "Excel文件大小: $FILE_SIZE 字节"
        else
            test_result 1 "Excel文件为空"
        fi

        FILE_TYPE=$(file -b "$LATEST_EXCEL" 2>/dev/null)
        if [[ "$FILE_TYPE" == *"Microsoft Excel"* ]] || [[ "$FILE_TYPE" == *"Zip archive"* ]]; then
            test_result 0 "Excel文件格式正确"
        else
            test_result 1 "Excel文件格式错误"
        fi
    fi
else
    echo "  ${YELLOW}⚠${NC} 没有Excel文件可测试"
fi

# 5. 测试PPT文件
echo ""
echo -e "${BLUE}[5/6]${NC} 测试PPT文件..."

if [ $PPT_COUNT -gt 0 ]; then
    LATEST_PPT=$(find "$PROJECT_DIR" -name "*.pptx" -type f -printf '%T+ %p\n' 2>/dev/null | sort -r | head -1 | cut -d' ' -f2-)

    if [ -n "$LATEST_PPT" ]; then
        echo "  最新PPT文件: $LATEST_PPT"

        FILE_SIZE=$(stat -c%s "$LATEST_PPT" 2>/dev/null)
        if [ $FILE_SIZE -gt 0 ]; then
            test_result 0 "PPT文件大小: $FILE_SIZE 字节"
        else
            test_result 1 "PPT文件为空"
        fi

        FILE_TYPE=$(file -b "$LATEST_PPT" 2>/dev/null)
        if [[ "$FILE_TYPE" == *"Microsoft PowerPoint"* ]] || [[ "$FILE_TYPE" == *"Zip archive"* ]]; then
            test_result 0 "PPT文件格式正确"
        else
            test_result 1 "PPT文件格式错误"
        fi
    fi
else
    echo "  ${RED}✗${NC} 没有找到PPT文件"
    echo "  ${YELLOW}建议：在应用中输入 '做一个项目汇报PPT' 来测试PPT生成${NC}"
fi

# 6. 检查依赖
echo ""
echo -e "${BLUE}[6/6]${NC} 检查Node.js依赖..."

DESKTOP_DIR="C:/code/chainlesschain/desktop-app-vue"
if [ -f "$DESKTOP_DIR/package.json" ]; then
    cd "$DESKTOP_DIR"

    # 检查docx-preview
    if grep -q "docx-preview" package.json; then
        test_result 0 "docx-preview 已安装"
    else
        test_result 1 "docx-preview 未安装"
    fi

    # 检查xlsx
    if grep -q "xlsx" package.json; then
        test_result 0 "xlsx 已安装"
    else
        test_result 1 "xlsx 未安装"
    fi

    # 检查pptx2json
    if grep -q "pptx2json" package.json; then
        test_result 0 "pptx2json 已安装"
    else
        test_result 1 "pptx2json 未安装"
    fi
else
    test_result 1 "package.json 未找到"
fi

# 总结
echo ""
echo "================================"
echo "          测试总结"
echo "================================"
echo -e "总测试数: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "通过: ${GREEN}$PASSED_TESTS${NC}"
echo -e "失败: ${RED}$FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ 所有测试通过！${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}✗ 有 $FAILED_TESTS 个测试失败${NC}"
    exit 1
fi
