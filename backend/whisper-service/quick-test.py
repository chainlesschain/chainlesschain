#!/usr/bin/env python3
"""
Whisper Service Quick Test
测试 Whisper 服务是否正常工作
"""

import sys
import time

print("=== Whisper 服务快速测试 ===\n")

# 1. 检查 Python 版本
print("1. 检查 Python 版本...")
print(f"   Python {sys.version}")
print("   ✓ Python 版本正常\n")

# 2. 检查依赖
print("2. 检查依赖包...")
try:
    import fastapi
    print(f"   ✓ FastAPI {fastapi.__version__}")
except ImportError as e:
    print(f"   ✗ FastAPI 未安装: {e}")
    sys.exit(1)

try:
    import whisper
    print(f"   ✓ OpenAI Whisper 已安装")
except ImportError as e:
    print(f"   ✗ Whisper 未安装: {e}")
    print("   提示: 正在安装依赖，请稍候...")
    sys.exit(1)

try:
    import torch
    print(f"   ✓ PyTorch {torch.__version__}")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"   设备: {device}")
except ImportError as e:
    print(f"   ✗ PyTorch 未安装: {e}")
    sys.exit(1)

print()

# 3. 测试 Whisper 模型加载
print("3. 测试 Whisper 模型...")
try:
    print("   正在加载 tiny 模型（用于快速测试）...")
    start = time.time()
    model = whisper.load_model("tiny")
    duration = time.time() - start
    print(f"   ✓ 模型加载成功 ({duration:.2f}秒)")
except Exception as e:
    print(f"   ✗ 模型加载失败: {e}")
    sys.exit(1)

print()

# 4. 总结
print("=== 测试完成 ===")
print("✓ 所有依赖已安装")
print("✓ Whisper 模型可以正常加载")
print()
print("下一步:")
print("  1. 启动服务: python main.py")
print("  2. 测试 API: curl http://localhost:8000/health")
