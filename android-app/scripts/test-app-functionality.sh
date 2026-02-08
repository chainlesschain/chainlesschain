#!/bin/bash
# Android应用功能测试脚本

ADB="C:/Android/sdk/platform-tools/adb.exe"
PACKAGE="com.chainlesschain.android.debug"

echo "========== Android应用功能测试 =========="
echo ""

# 1. 检查应用是否运行
echo "[1/5] 检查应用进程..."
PID=$($ADB shell ps | grep $PACKAGE | awk '{print $2}')
if [ -z "$PID" ]; then
    echo "❌ 应用未运行，正在启动..."
    $ADB shell am start -n $PACKAGE/com.chainlesschain.android.MainActivity
    sleep 3
else
    echo "✅ 应用正在运行 (PID: $PID)"
fi

# 2. 检查数据库
echo ""
echo "[2/5] 检查数据库..."
$ADB shell run-as $PACKAGE ls databases/ 2>&1 | while read file; do
    echo "   - $file"
done

# 3. 检查应用日志中的错误
echo ""
echo "[3/5] 检查应用错误日志（最近50条）..."
$ADB logcat -d --pid=$PID *:E | tail -50 | grep -i "exception\|error\|fatal\|crash" || echo "   ✅ 未发现严重错误"

# 4. 检查Hilt依赖注入
echo ""
echo "[4/5] 检查Hilt初始化..."
$ADB logcat -d | grep -i "hilt\|dagger" | tail -10 || echo "   ⚠️  未找到Hilt日志"

# 5. 获取当前屏幕截图
echo ""
echo "[5/5] 捕获当前屏幕..."
$ADB shell screencap -p > /tmp/android_screen.png
file /tmp/android_screen.png

echo ""
echo "========== 测试完成 =========="
echo ""
echo "建议操作："
echo "1. 手动点击应用中的'创建项目'按钮"
echo "2. 观察日志输出："
echo "   $ADB logcat --pid=$PID -v time"
echo "3. 检查数据库内容："
echo "   $ADB shell run-as $PACKAGE sqlite3 databases/chainlesschain.db 'SELECT * FROM projects LIMIT 5;'"
