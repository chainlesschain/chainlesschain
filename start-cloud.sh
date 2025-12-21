#!/bin/bash

# ChainlessChain 云端模式快速启动脚本
# 适用于无GPU或GPU算力不足的用户

set -e

echo "========================================="
echo "  ChainlessChain 云端算力模式启动"
echo "========================================="
echo ""

# 检查.env文件是否存在
if [ ! -f .env ]; then
    echo "⚠️  未找到.env配置文件"
    echo ""
    read -p "是否创建云端配置文件? (y/n): " create_env

    if [ "$create_env" = "y" ] || [ "$create_env" = "Y" ]; then
        echo ""
        echo "========================================="
        echo "请选择云LLM服务商 (共14个选项):"
        echo "========================================="
        echo ""
        echo "💰 完全免费方案 (推荐新手):"
        echo "1. 火山引擎 豆包-lite (字节跳动，完全免费) ⭐⭐⭐⭐⭐"
        echo "2. 腾讯混元-lite (腾讯出品，完全免费) ⭐⭐⭐⭐⭐"
        echo ""
        echo "🔥 超高性价比方案:"
        echo "3. 硅基流动 (￥0.0007/1K，最便宜) ⭐⭐⭐⭐⭐"
        echo "4. DeepSeek (￥0.001/1K，代码能力强) ⭐⭐⭐⭐⭐"
        echo "5. 阿里云通义千问 (￥0.008/1K，100万/月免费) ⭐⭐⭐⭐⭐"
        echo ""
        echo "📱 国产大厂方案:"
        echo "6. 百度千帆-文心 (￥0.012/1K，有免费额度) ⭐⭐⭐⭐"
        echo "7. 讯飞星火 (￥0.018/1K，语音能力强) ⭐⭐⭐"
        echo "8. 智谱AI-ChatGLM (￥0.05/1K，有免费额度) ⭐⭐⭐"
        echo ""
        echo "🚀 其他优质方案:"
        echo "9. Moonshot AI-Kimi (￥0.012/1K，长文本) ⭐⭐⭐⭐"
        echo "10. 零一万物 (￥0.02/1K，速度快) ⭐⭐⭐⭐"
        echo "11. MiniMax (￥0.015/1K) ⭐⭐⭐"
        echo ""
        echo "🌍 国际方案:"
        echo "12. OpenAI GPT-3.5 (￥0.014/1K) ⭐⭐⭐"
        echo ""
        read -p "请选择 (1-12): " provider_choice

        cp .env.cloud.example .env

        case $provider_choice in
            1)
                echo ""
                echo "✅ 已选择: 火山引擎（豆包大模型-lite）"
                echo ""
                echo "官网: https://console.volcengine.com/ark"
                echo "特点: 字节跳动出品，完全免费，无限制，中文能力强"
                echo ""
                read -p "请输入您的API Key (格式: AK:SK): " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=volcengine/" .env
                sed -i "s/your_ak:your_sk/$api_key/" .env
                sed -i "s/VOLCENGINE_MODEL=doubao-pro-4k/VOLCENGINE_MODEL=doubao-lite/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥0 (完全免费)"
                ;;
            2)
                echo ""
                echo "✅ 已选择: 腾讯混元-lite"
                echo ""
                echo "官网: https://cloud.tencent.com/product/hunyuan"
                echo "特点: 腾讯出品，完全免费，支持长文本"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=hunyuan/" .env
                sed -i "s/your_hunyuan_api_key_here/$api_key/" .env
                sed -i "s/HUNYUAN_MODEL=hunyuan-lite/HUNYUAN_MODEL=hunyuan-lite/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥0 (完全免费)"
                ;;
            3)
                echo ""
                echo "✅ 已选择: 硅基流动"
                echo ""
                echo "官网: https://siliconflow.cn/"
                echo "特点: 价格最便宜，支持多种开源模型"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=openai/" .env
                sed -i "s/your_openai_api_key_here/$api_key/" .env
                sed -i "s|OPENAI_BASE_URL=https://api.openai.com/v1|OPENAI_BASE_URL=https://api.siliconflow.cn/v1|" .env
                sed -i "s/LLM_MODEL=gpt-3.5-turbo/LLM_MODEL=Qwen\/Qwen2-7B-Instruct/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥2-20"
                ;;
            4)
                echo ""
                echo "✅ 已选择: DeepSeek"
                echo ""
                echo "官网: https://platform.deepseek.com/"
                echo "特点: 代码能力顶尖，价格超便宜"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=deepseek/" .env
                sed -i "s/your_deepseek_api_key_here/$api_key/" .env
                sed -i "s/DEEPSEEK_MODEL=deepseek-chat/DEEPSEEK_MODEL=deepseek-chat/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥3-15"
                ;;
            5)
                echo ""
                echo "✅ 已选择: 阿里云通义千问"
                echo ""
                echo "官网: https://dashscope.aliyun.com/"
                echo "特点: 100万tokens/月免费额度，阿里巴巴出品"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=dashscope/" .env
                sed -i "s/your_dashscope_api_key_here/$api_key/" .env
                sed -i "s/DASHSCOPE_MODEL=qwen-turbo/DASHSCOPE_MODEL=qwen-turbo/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥0 (免费额度内)"
                ;;
            6)
                echo ""
                echo "✅ 已选择: 百度千帆（文心一言）"
                echo ""
                echo "官网: https://cloud.baidu.com/product/wenxinworkshop"
                echo "特点: 百度出品，国内稳定"
                echo ""
                read -p "请输入您的API Key (格式: AK:SK): " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=qianfan/" .env
                sed -i "s/your_access_key:your_secret_key/$api_key/" .env
                sed -i "s/QIANFAN_MODEL=ERNIE-Bot-turbo/QIANFAN_MODEL=ERNIE-Bot-turbo/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥10-50"
                ;;
            7)
                echo ""
                echo "✅ 已选择: 讯飞星火"
                echo ""
                echo "官网: https://xinghuo.xfyun.cn/"
                echo "特点: 科大讯飞出品，语音能力强"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=spark/" .env
                sed -i "s/your_spark_api_key_here/$api_key/" .env
                sed -i "s/SPARK_MODEL=spark-lite/SPARK_MODEL=spark-lite/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥15-40"
                ;;
            8)
                echo ""
                echo "✅ 已选择: 智谱AI（ChatGLM）"
                echo ""
                echo "官网: https://open.bigmodel.cn/"
                echo "特点: 新用户有免费额度"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=zhipu/" .env
                sed -i "s/your_zhipu_api_key_here/$api_key/" .env
                sed -i "s/ZHIPU_MODEL=glm-4/ZHIPU_MODEL=glm-4/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥20-60"
                ;;
            9)
                echo ""
                echo "✅ 已选择: Moonshot AI（Kimi）"
                echo ""
                echo "官网: https://platform.moonshot.cn/"
                echo "特点: 长文本支持好，有免费额度"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=openai/" .env
                sed -i "s/your_openai_api_key_here/$api_key/" .env
                sed -i "s|OPENAI_BASE_URL=https://api.openai.com/v1|OPENAI_BASE_URL=https://api.moonshot.cn/v1|" .env
                sed -i "s/LLM_MODEL=gpt-3.5-turbo/LLM_MODEL=moonshot-v1-8k/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥10-30"
                ;;
            10)
                echo ""
                echo "✅ 已选择: 零一万物"
                echo ""
                echo "官网: https://platform.lingyiwanwu.com/"
                echo "特点: 李开复创办，速度快"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=openai/" .env
                sed -i "s/your_openai_api_key_here/$api_key/" .env
                sed -i "s|OPENAI_BASE_URL=https://api.openai.com/v1|OPENAI_BASE_URL=https://api.lingyiwanwu.com/v1|" .env
                sed -i "s/LLM_MODEL=gpt-3.5-turbo/LLM_MODEL=yi-large/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥15-40"
                ;;
            11)
                echo ""
                echo "✅ 已选择: MiniMax"
                echo ""
                echo "官网: https://platform.minimaxi.com/"
                echo "特点: 性能不错的创业公司"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=minimax/" .env
                sed -i "s/your_minimax_api_key_here/$api_key/" .env
                sed -i "s/MINIMAX_MODEL=abab5.5-chat/MINIMAX_MODEL=abab5.5-chat/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥12-35"
                ;;
            12)
                echo ""
                echo "✅ 已选择: OpenAI"
                echo ""
                echo "官网: https://platform.openai.com/"
                echo "特点: ChatGPT官方API"
                echo ""
                read -p "请输入您的API Key: " api_key

                sed -i "s/your_openai_api_key_here/$api_key/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 $6-20 (约￥42-140)"
                ;;
            *)
                echo "❌ 无效选择，已取消"
                rm .env 2>/dev/null || true
                exit 1
                ;;
        esac

        echo ""
        echo "💡 温馨提示:"
        echo "   - 您可以随时修改 .env 文件切换服务商"
        echo "   - 查看所有服务商对比: docs/云LLM服务商对比.md"
        echo "   - 计算使用成本: python tools/cost-calculator.py"
        echo ""
    else
        echo "❌ 配置已取消"
        exit 1
    fi
fi

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装Docker，请先安装Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ 未安装Docker Compose，请先安装"
    exit 1
fi

echo ""
echo "🚀 启动云端模式..."
echo ""

# 创建数据目录
mkdir -p data/postgres data/redis data/qdrant data/projects

# Build latest ai-service image
docker-compose -f docker-compose.cloud.yml build ai-service

# Build latest project-service image
docker-compose -f docker-compose.cloud.yml build project-service

# 启动服务
docker-compose -f docker-compose.cloud.yml up -d

# Ensure ai-service is running the freshly built image
docker-compose -f docker-compose.cloud.yml up -d --no-deps --force-recreate ai-service

# Ensure project-service is running the freshly built image
docker-compose -f docker-compose.cloud.yml up -d --no-deps --force-recreate project-service

echo ""
echo "⏳ 等待服务启动..."
sleep 5

# 检查服务状态
echo ""
echo "📊 服务状态:"
docker-compose -f docker-compose.cloud.yml ps

echo ""
echo "✅ 启动完成!"
echo ""
echo "📌 服务地址:"
echo "   - AI Service: http://localhost:8001"
echo "   - Project Service: http://localhost:9090"
echo "   - Qdrant: http://localhost:6333"
echo "   - PostgreSQL: localhost:5432"
echo ""
echo "📖 查看日志:"
echo "   docker-compose -f docker-compose.cloud.yml logs -f"
echo ""
echo "🛑 停止服务:"
echo "   docker-compose -f docker-compose.cloud.yml down"
echo ""
echo "💡 详细文档: README-云端部署指南.md"
echo ""
