#!/bin/bash

# WebP图片转换脚本 - Phase 7.4
# 将PNG和JPG图片批量转换为WebP格式以减小APK体积
#
# 使用方法:
#   chmod +x convert_to_webp.sh
#   ./convert_to_webp.sh
#
# 要求:
#   安装 cwebp 工具 (brew install webp 或 apt-get install webp)

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
PROJECT_ROOT="../"
RES_DIRS=(
    "app/src/main/res"
    "core-ui/src/main/res"
    "feature-p2p/src/main/res"
    "feature-knowledge/src/main/res"
    "feature-ai/src/main/res"
)

# 统计变量
TOTAL_PNG=0
TOTAL_JPG=0
CONVERTED_PNG=0
CONVERTED_JPG=0
SKIPPED_PNG=0
SKIPPED_JPG=0
SPACE_SAVED=0

# 检查cwebp是否安装
if ! command -v cwebp &> /dev/null; then
    echo -e "${RED}错误: cwebp未安装${NC}"
    echo "请安装WebP工具:"
    echo "  macOS: brew install webp"
    echo "  Ubuntu: sudo apt-get install webp"
    echo "  Windows: 下载自 https://developers.google.com/speed/webp/download"
    exit 1
fi

echo "========================================="
echo "  WebP图片转换工具 - Phase 7.4"
echo "========================================="
echo ""

# 转换PNG图片
convert_png_to_webp() {
    local file="$1"
    local output="${file%.png}.webp"

    # 跳过launcher图标
    if [[ "$file" =~ ic_launcher ]]; then
        echo -e "${YELLOW}跳过: $file (launcher图标)${NC}"
        ((SKIPPED_PNG++))
        return
    fi

    # 无损压缩PNG
    cwebp -lossless -q 100 "$file" -o "$output" &> /dev/null

    if [ -f "$output" ]; then
        local original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
        local webp_size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output" 2>/dev/null)

        # 如果WebP更小，删除原PNG
        if [ "$webp_size" -lt "$original_size" ]; then
            local saved=$((original_size - webp_size))
            SPACE_SAVED=$((SPACE_SAVED + saved))
            rm "$file"
            echo -e "${GREEN}✓ 转换成功: $file${NC}"
            echo "  原始: $(numfmt --to=iec-i --suffix=B $original_size)"
            echo "  WebP: $(numfmt --to=iec-i --suffix=B $webp_size)"
            echo "  节省: $(numfmt --to=iec-i --suffix=B $saved) ($(( saved * 100 / original_size ))%)"
            ((CONVERTED_PNG++))
        else
            # WebP未减小体积，删除WebP保留PNG
            rm "$output"
            echo -e "${YELLOW}跳过: $file (WebP未减小体积)${NC}"
            ((SKIPPED_PNG++))
        fi
    else
        echo -e "${RED}✗ 转换失败: $file${NC}"
        ((SKIPPED_PNG++))
    fi
}

# 转换JPG图片
convert_jpg_to_webp() {
    local file="$1"
    local output="${file%.jpg}.webp"

    # 有损压缩JPG，质量90%
    cwebp -q 90 "$file" -o "$output" &> /dev/null

    if [ -f "$output" ]; then
        local original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)
        local webp_size=$(stat -f%z "$output" 2>/dev/null || stat -c%s "$output" 2>/dev/null)

        # 如果WebP更小，删除原JPG
        if [ "$webp_size" -lt "$original_size" ]; then
            local saved=$((original_size - webp_size))
            SPACE_SAVED=$((SPACE_SAVED + saved))
            rm "$file"
            echo -e "${GREEN}✓ 转换成功: $file${NC}"
            echo "  原始: $(numfmt --to=iec-i --suffix=B $original_size)"
            echo "  WebP: $(numfmt --to=iec-i --suffix=B $webp_size)"
            echo "  节省: $(numfmt --to=iec-i --suffix=B $saved) ($(( saved * 100 / original_size ))%)"
            ((CONVERTED_JPG++))
        else
            # WebP未减小体积，删除WebP保留JPG
            rm "$output"
            echo -e "${YELLOW}跳过: $file (WebP未减小体积)${NC}"
            ((SKIPPED_JPG++))
        fi
    else
        echo -e "${RED}✗ 转换失败: $file${NC}"
        ((SKIPPED_JPG++))
    fi
}

# 遍历资源目录
cd "$PROJECT_ROOT"

for res_dir in "${RES_DIRS[@]}"; do
    if [ ! -d "$res_dir" ]; then
        continue
    fi

    echo "处理目录: $res_dir"
    echo "-----------------------------------------"

    # 查找PNG文件
    while IFS= read -r -d '' file; do
        ((TOTAL_PNG++))
        convert_png_to_webp "$file"
    done < <(find "$res_dir" -type f -name "*.png" -print0)

    # 查找JPG文件
    while IFS= read -r -d '' file; do
        ((TOTAL_JPG++))
        convert_jpg_to_webp "$file"
    done < <(find "$res_dir" -type f -name "*.jpg" -print0)

    echo ""
done

# 打印汇总统计
echo "========================================="
echo "  转换完成 - 统计报告"
echo "========================================="
echo ""
echo "PNG图片:"
echo "  总数: $TOTAL_PNG"
echo "  已转换: $CONVERTED_PNG"
echo "  跳过: $SKIPPED_PNG"
echo ""
echo "JPG图片:"
echo "  总数: $TOTAL_JPG"
echo "  已转换: $CONVERTED_JPG"
echo "  跳过: $SKIPPED_JPG"
echo ""
echo "总节省空间: $(numfmt --to=iec-i --suffix=B $SPACE_SAVED)"
echo ""

if [ $((CONVERTED_PNG + CONVERTED_JPG)) -gt 0 ]; then
    echo -e "${GREEN}✅ 转换成功！${NC}"
    echo "建议: 构建APK前运行 'git status' 检查变更"
else
    echo -e "${YELLOW}⚠️  没有图片需要转换${NC}"
fi

echo "========================================="
