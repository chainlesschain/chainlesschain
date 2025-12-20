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
        echo "请选择云LLM服务商:"
        echo "1. 硅基流动 (推荐，性价比最高 ￥0.0007/1K tokens)"
        echo "2. 阿里云通义千问 (国内稳定，有免费额度)"
        echo "3. 零一万物 (速度快 ￥0.02/1K tokens)"
        echo "4. OpenAI (国际用户)"
        echo ""
        read -p "请选择 (1-4): " provider_choice

        cp .env.cloud.example .env

        case $provider_choice in
            1)
                echo ""
                echo "✅ 已选择: 硅基流动"
                echo ""
                echo "请访问 https://siliconflow.cn/ 注册并获取API Key"
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=openai/" .env
                sed -i "s/your_siliconflow_api_key_here/$api_key/" .env
                sed -i "s|OPENAI_BASE_URL=https://api.openai.com/v1|OPENAI_BASE_URL=https://api.siliconflow.cn/v1|" .env
                sed -i "s/LLM_MODEL=gpt-3.5-turbo/LLM_MODEL=Qwen\/Qwen2-7B-Instruct/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥2-20 (取决于使用量)"
                ;;
            2)
                echo ""
                echo "✅ 已选择: 阿里云通义千问"
                echo ""
                echo "请访问 https://dashscope.aliyun.com/ 注册并获取API Key"
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=dashscope/" .env
                sed -i "s/your_dashscope_api_key_here/$api_key/" .env
                sed -i "s/DASHSCOPE_MODEL=qwen-turbo/DASHSCOPE_MODEL=qwen-turbo/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥0 (免费额度充足)"
                ;;
            3)
                echo ""
                echo "✅ 已选择: 零一万物"
                echo ""
                echo "请访问 https://platform.lingyiwanwu.com/ 注册并获取API Key"
                read -p "请输入您的API Key: " api_key

                sed -i "s/LLM_PROVIDER=openai/LLM_PROVIDER=openai/" .env
                sed -i "s/your_lingyi_api_key_here/$api_key/" .env
                sed -i "s|OPENAI_BASE_URL=https://api.openai.com/v1|OPENAI_BASE_URL=https://api.lingyiwanwu.com/v1|" .env
                sed -i "s/LLM_MODEL=gpt-3.5-turbo/LLM_MODEL=yi-large/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 ￥10-50"
                ;;
            4)
                echo ""
                echo "✅ 已选择: OpenAI"
                echo ""
                echo "请访问 https://platform.openai.com/ 注册并获取API Key"
                read -p "请输入您的API Key: " api_key

                sed -i "s/your_openai_api_key_here/$api_key/" .env

                echo "✅ 配置完成!"
                echo "预计成本: 每月 $6-20 (约￥42-140)"
                ;;
        esac

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

# 启动服务
docker-compose -f docker-compose.cloud.yml up -d

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
echo "   - Project Service: http://localhost:8080"
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
