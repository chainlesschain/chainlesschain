#!/usr/bin/env python3
"""
ChainlessChain 成本计算器
帮助用户估算不同云LLM服务商的使用成本
"""

import sys


# 各服务商价格表 (每1K tokens的价格，单位：人民币)
PRICING = {
    "硅基流动 Qwen2-7B": 0.0007,
    "硅基流动 DeepSeek-V2.5": 0.0014,
    "阿里云 qwen-turbo": 0.008,
    "阿里云 qwen-plus": 0.02,
    "阿里云 qwen-max": 0.12,
    "零一万物 yi-large": 0.02,
    "智谱AI glm-4": 0.05,
    "Moonshot moonshot-v1-8k": 0.012,
    "OpenAI GPT-3.5-Turbo": 0.014,  # $0.002 * 7汇率
    "OpenAI GPT-4-Turbo": 0.07,     # $0.01 * 7汇率
}

# GPU租用价格 (每小时，单位：人民币)
GPU_PRICING = {
    "AutoDL RTX 3090": 1.5,
    "矩池云 RTX 3090": 1.2,
    "恒源云 RTX 3090": 1.8,
    "趋动云 A100": 3.5,
}


def calculate_api_cost(daily_calls, avg_tokens_per_call, provider):
    """计算API调用成本"""
    if provider not in PRICING:
        print(f"❌ 不支持的服务商: {provider}")
        return None

    price_per_1k = PRICING[provider]

    # 每日成本
    daily_tokens = daily_calls * avg_tokens_per_call
    daily_cost = (daily_tokens / 1000) * price_per_1k

    # 每月成本
    monthly_cost = daily_cost * 30

    # 每年成本
    yearly_cost = monthly_cost * 12

    return {
        "daily_tokens": daily_tokens,
        "daily_cost": daily_cost,
        "monthly_cost": monthly_cost,
        "yearly_cost": yearly_cost
    }


def calculate_gpu_cost(hours_per_day, provider):
    """计算GPU租用成本"""
    if provider not in GPU_PRICING:
        print(f"❌ 不支持的GPU提供商: {provider}")
        return None

    price_per_hour = GPU_PRICING[provider]

    # 每日成本
    daily_cost = hours_per_day * price_per_hour

    # 每月成本 (按22个工作日计算)
    monthly_cost_workday = daily_cost * 22
    monthly_cost_fulltime = daily_cost * 30

    # 每年成本
    yearly_cost = monthly_cost_fulltime * 12

    return {
        "daily_cost": daily_cost,
        "monthly_cost_workday": monthly_cost_workday,
        "monthly_cost_fulltime": monthly_cost_fulltime,
        "yearly_cost": yearly_cost
    }


def print_comparison(daily_calls, avg_tokens):
    """打印成本对比表"""
    print(f"\n{'='*80}")
    print(f"使用场景: 每天{daily_calls}次对话，平均每次{avg_tokens} tokens")
    print(f"{'='*80}\n")

    print(f"{'服务商':<30} {'每日成本':<12} {'每月成本':<12} {'每年成本':<12}")
    print("-" * 80)

    results = []
    for provider in PRICING:
        cost = calculate_api_cost(daily_calls, avg_tokens, provider)
        if cost:
            results.append((provider, cost))
            print(f"{provider:<30} ￥{cost['daily_cost']:>10.2f}  ￥{cost['monthly_cost']:>10.2f}  ￥{cost['yearly_cost']:>10.2f}")

    # 排序并推荐
    results.sort(key=lambda x: x[1]['monthly_cost'])
    print("\n" + "=" * 80)
    print(f"💡 最佳推荐: {results[0][0]}")
    print(f"   每月成本: ￥{results[0][1]['monthly_cost']:.2f}")
    print("=" * 80)


def interactive_mode():
    """交互式模式"""
    print("\n" + "="*80)
    print(" " * 20 + "ChainlessChain 成本计算器")
    print("="*80 + "\n")

    # 选择计算类型
    print("请选择计算类型:")
    print("1. 云LLM API成本计算")
    print("2. 云GPU租用成本计算")
    print("3. 两者对比")
    print()

    choice = input("请选择 (1-3): ").strip()

    if choice == "1":
        # API成本计算
        print("\n请输入您的使用情况:")
        daily_calls = int(input("每天对话次数: "))
        avg_tokens = int(input("平均每次对话tokens数 (默认800): ") or "800")

        print_comparison(daily_calls, avg_tokens)

    elif choice == "2":
        # GPU成本计算
        print("\n请输入您的使用情况:")
        hours_per_day = float(input("每天使用小时数: "))

        print(f"\n{'='*80}")
        print(f"使用场景: 每天使用{hours_per_day}小时")
        print(f"{'='*80}\n")

        print(f"{'GPU提供商':<30} {'每日成本':<12} {'月成本(工作日)':<15} {'月成本(全天)':<15}")
        print("-" * 80)

        for provider in GPU_PRICING:
            cost = calculate_gpu_cost(hours_per_day, provider)
            if cost:
                print(f"{provider:<30} ￥{cost['daily_cost']:>10.2f}  ￥{cost['monthly_cost_workday']:>12.2f}  ￥{cost['monthly_cost_fulltime']:>12.2f}")

    elif choice == "3":
        # 对比分析
        print("\n请输入您的使用情况:")
        daily_calls = int(input("每天对话次数: "))
        avg_tokens = int(input("平均每次对话tokens数 (默认800): ") or "800")
        hours_per_day = float(input("如果租用GPU，每天使用几小时: "))

        # API成本
        print_comparison(daily_calls, avg_tokens)

        # GPU成本
        print(f"\n{'='*80}")
        print("云GPU租用成本对比:")
        print(f"{'='*80}\n")

        gpu_results = []
        for provider in GPU_PRICING:
            cost = calculate_gpu_cost(hours_per_day, provider)
            if cost:
                gpu_results.append((provider, cost))
                print(f"{provider}: 每月￥{cost['monthly_cost_workday']:.2f} (工作日) / ￥{cost['monthly_cost_fulltime']:.2f} (全天)")

        # 推荐方案
        best_api = min(
            [(p, calculate_api_cost(daily_calls, avg_tokens, p)) for p in PRICING],
            key=lambda x: x[1]['monthly_cost']
        )
        best_gpu = min(gpu_results, key=lambda x: x[1]['monthly_cost_workday'])

        print("\n" + "="*80)
        print("📊 综合推荐:")
        print(f"\n  最便宜的云API方案: {best_api[0]}")
        print(f"    每月成本: ￥{best_api[1]['monthly_cost']:.2f}")
        print(f"\n  最便宜的云GPU方案: {best_gpu[0]}")
        print(f"    每月成本: ￥{best_gpu[1]['monthly_cost_workday']:.2f} (工作日) / ￥{best_gpu[1]['monthly_cost_fulltime']:.2f} (全天)")

        if best_api[1]['monthly_cost'] < best_gpu[1]['monthly_cost_workday']:
            print(f"\n  🎯 推荐使用云API ({best_api[0]})，成本更低")
        else:
            print(f"\n  🎯 推荐租用云GPU ({best_gpu[0]})，无调用限制且成本更低")

        print("="*80)

    else:
        print("❌ 无效选择")
        sys.exit(1)


def preset_scenarios():
    """预设场景计算"""
    scenarios = [
        ("个人学习/测试", 50, 500),
        ("轻度使用", 100, 600),
        ("中度使用", 300, 800),
        ("重度使用", 1000, 1000),
        ("超高频使用", 3000, 1200),
    ]

    print("\n" + "="*80)
    print(" " * 20 + "常见使用场景成本对比")
    print("="*80 + "\n")

    for scenario_name, daily_calls, avg_tokens in scenarios:
        print(f"\n【{scenario_name}】")
        print(f"  使用量: 每天{daily_calls}次对话，平均{avg_tokens} tokens/次")
        print("-" * 80)

        # 计算几个代表性服务商
        providers = [
            "硅基流动 Qwen2-7B",
            "阿里云 qwen-turbo",
            "零一万物 yi-large"
        ]

        for provider in providers:
            cost = calculate_api_cost(daily_calls, avg_tokens, provider)
            if cost:
                print(f"  {provider:<25} 每月: ￥{cost['monthly_cost']:>6.2f}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "presets":
        preset_scenarios()
    else:
        interactive_mode()
