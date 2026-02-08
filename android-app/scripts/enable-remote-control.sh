#!/bin/bash
# 启用远程控制功能 - Linux/macOS 脚本
# 作用：将所有 .kt.disabled 文件重命名为 .kt

echo "========================================"
echo "启用远程控制功能"
echo "========================================"
echo ""

BASE_DIR="app/src/main/java/com/chainlesschain/android/remote"

echo "正在启用远程控制文件..."
echo ""

# 使用 find 命令找到所有 .disabled 文件并重命名
find "$BASE_DIR" -name "*.kt.disabled" | while read file; do
    new_file="${file%.disabled}"
    mv "$file" "$new_file"
    echo "[OK] $(basename $new_file)"
done

echo ""
echo "========================================"
echo "远程控制功能已启用！"
echo "========================================"
echo ""
echo "下一步："
echo "1. 运行 ./gradlew clean"
echo "2. 运行 ./gradlew assembleDebug"
echo ""
