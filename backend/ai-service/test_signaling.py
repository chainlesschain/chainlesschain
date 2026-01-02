"""
信令服务器测试脚本

测试WebSocket信令服务器的基本功能：
- 节点注册
- 消息转发
- 在线节点列表
"""

import asyncio
import websockets
import json
from datetime import datetime


async def test_peer(peer_id: str, server_url: str = "ws://localhost:8000/ws/signaling"):
    """
    模拟一个P2P节点

    Args:
        peer_id: 节点ID
        server_url: 信令服务器URL
    """
    uri = f"{server_url}/{peer_id}"

    print(f"[{peer_id}] 连接到信令服务器: {uri}")

    try:
        async with websockets.connect(uri) as websocket:
            print(f"[{peer_id}] ✅ 已连接")

            # 接收注册成功消息
            response = await websocket.recv()
            data = json.loads(response)
            print(f"[{peer_id}] 收到消息: {data.get('type')}")

            # 接收在线节点列表
            response = await websocket.recv()
            data = json.loads(response)
            print(f"[{peer_id}] 在线节点: {len(data.get('peers', []))}")

            # 发送心跳
            await websocket.send(json.dumps({
                'type': 'heartbeat'
            }))
            print(f"[{peer_id}] 发送心跳")

            # 接收心跳响应
            response = await websocket.recv()
            data = json.loads(response)
            print(f"[{peer_id}] 收到心跳响应: {data.get('type')}")

            # 保持连接
            await asyncio.sleep(30)

    except Exception as e:
        print(f"[{peer_id}] ❌ 错误: {e}")


async def test_message_forward():
    """
    测试消息转发功能
    """
    server_url = "ws://localhost:8000/ws/signaling"

    print("\n========== 测试消息转发 ==========\n")

    async def peer_alice():
        uri = f"{server_url}/alice"
        async with websockets.connect(uri) as ws:
            print("[Alice] 已连接")

            # 接收注册消息
            await ws.recv()
            await ws.recv()

            # 等待Bob连接
            await asyncio.sleep(2)

            # 发送Offer给Bob
            await ws.send(json.dumps({
                'type': 'offer',
                'to': 'bob',
                'offer': {
                    'type': 'offer',
                    'sdp': 'mock_sdp_offer_from_alice'
                }
            }))
            print("[Alice] 已发送Offer给Bob")

            # 接收Bob的Answer
            response = await ws.recv()
            data = json.loads(response)
            print(f"[Alice] 收到来自Bob的消息: {data.get('type')}")

            await asyncio.sleep(5)

    async def peer_bob():
        uri = f"{server_url}/bob"
        async with websockets.connect(uri) as ws:
            print("[Bob] 已连接")

            # 接收注册消息
            await ws.recv()
            await ws.recv()

            # 接收Alice的Offer
            response = await ws.recv()
            data = json.loads(response)
            print(f"[Bob] 收到来自Alice的消息: {data.get('type')}")

            # 发送Answer给Alice
            await ws.send(json.dumps({
                'type': 'answer',
                'to': 'alice',
                'answer': {
                    'type': 'answer',
                    'sdp': 'mock_sdp_answer_from_bob'
                }
            }))
            print("[Bob] 已发送Answer给Alice")

            await asyncio.sleep(5)

    # 并发运行两个节点
    await asyncio.gather(
        peer_alice(),
        peer_bob()
    )


async def test_stats():
    """
    测试统计接口
    """
    import aiohttp

    print("\n========== 测试统计接口 ==========\n")

    async with aiohttp.ClientSession() as session:
        async with session.get('http://localhost:8000/api/signaling/stats') as resp:
            stats = await resp.json()
            print(f"在线节点数: {stats.get('online_peers')}")
            print(f"节点列表:")
            for peer in stats.get('peers', []):
                print(f"  - {peer.get('peer_id')}")


async def main():
    """
    主测试函数
    """
    print("=" * 60)
    print("ChainlessChain P2P信令服务器测试")
    print("=" * 60)
    print()

    # 测试1: 单节点连接
    print("测试1: 单节点连接\n")
    try:
        await asyncio.wait_for(test_peer("test-peer-1"), timeout=35)
    except asyncio.TimeoutError:
        print("[测试1] 完成")
    except Exception as e:
        print(f"[测试1] 错误: {e}")

    print("\n" + "-" * 60 + "\n")

    # 测试2: 消息转发
    print("测试2: 消息转发\n")
    try:
        await test_message_forward()
    except Exception as e:
        print(f"[测试2] 错误: {e}")

    print("\n" + "-" * 60 + "\n")

    # 测试3: 统计接口
    print("测试3: 统计接口\n")
    try:
        await test_stats()
    except Exception as e:
        print(f"[测试3] 错误: {e}")

    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
