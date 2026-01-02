"""
WebSocket信令服务器 (Signaling Server)

功能：
- 处理WebRTC信令交换（SDP Offer/Answer, ICE Candidate）
- P2P节点注册和发现
- 消息路由和转发
- 在线状态管理
"""

import asyncio
import json
import logging
from typing import Dict, Set
from datetime import datetime
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class SignalingServer:
    """WebSocket信令服务器"""

    def __init__(self):
        # 存储所有在线节点: peer_id -> WebSocket
        self.peers: Dict[str, WebSocket] = {}

        # 存储节点元数据: peer_id -> metadata
        self.peer_metadata: Dict[str, dict] = {}

        # 订阅关系（用于消息广播）: peer_id -> Set[peer_id]
        self.subscriptions: Dict[str, Set[str]] = {}

        logger.info("[SignalingServer] 信令服务器已初始化")

    async def register_peer(self, peer_id: str, websocket: WebSocket, metadata: dict = None):
        """
        注册新节点

        Args:
            peer_id: 节点ID（通常是DID）
            websocket: WebSocket连接
            metadata: 节点元数据（昵称、设备类型等）
        """
        if peer_id in self.peers:
            logger.warning(f"[SignalingServer] 节点已存在，替换旧连接: {peer_id}")
            # 关闭旧连接
            old_ws = self.peers[peer_id]
            try:
                await old_ws.close()
            except:
                pass

        self.peers[peer_id] = websocket
        self.peer_metadata[peer_id] = metadata or {}
        self.subscriptions[peer_id] = set()

        logger.info(f"[SignalingServer] 节点已注册: {peer_id}, 在线节点: {len(self.peers)}")

        # 发送注册成功消息
        await self.send_to_peer(peer_id, {
            'type': 'register:success',
            'peerId': peer_id,
            'timestamp': datetime.now().isoformat()
        })

        # 通知其他节点有新节点上线
        await self.broadcast_except(peer_id, {
            'type': 'peer:online',
            'peerId': peer_id,
            'metadata': self.peer_metadata[peer_id]
        })

        # 发送在线节点列表
        await self.send_peer_list(peer_id)

    async def unregister_peer(self, peer_id: str):
        """
        注销节点

        Args:
            peer_id: 节点ID
        """
        if peer_id not in self.peers:
            return

        # 移除节点
        del self.peers[peer_id]
        if peer_id in self.peer_metadata:
            del self.peer_metadata[peer_id]
        if peer_id in self.subscriptions:
            del self.subscriptions[peer_id]

        logger.info(f"[SignalingServer] 节点已注销: {peer_id}, 剩余节点: {len(self.peers)}")

        # 通知其他节点该节点离线
        await self.broadcast({
            'type': 'peer:offline',
            'peerId': peer_id
        })

    async def send_to_peer(self, peer_id: str, message: dict):
        """
        发送消息给指定节点

        Args:
            peer_id: 目标节点ID
            message: 消息内容
        """
        if peer_id not in self.peers:
            logger.warning(f"[SignalingServer] 节点不在线: {peer_id}")
            return False

        try:
            await self.peers[peer_id].send_json(message)
            return True
        except Exception as e:
            logger.error(f"[SignalingServer] 发送消息失败: {peer_id}, {e}")
            # 连接可能已断开，移除该节点
            await self.unregister_peer(peer_id)
            return False

    async def broadcast(self, message: dict):
        """
        广播消息给所有在线节点

        Args:
            message: 消息内容
        """
        for peer_id in list(self.peers.keys()):
            await self.send_to_peer(peer_id, message)

    async def broadcast_except(self, except_peer_id: str, message: dict):
        """
        广播消息给除指定节点外的所有节点

        Args:
            except_peer_id: 排除的节点ID
            message: 消息内容
        """
        for peer_id in list(self.peers.keys()):
            if peer_id != except_peer_id:
                await self.send_to_peer(peer_id, message)

    async def send_peer_list(self, peer_id: str):
        """
        发送在线节点列表

        Args:
            peer_id: 目标节点ID
        """
        peers = []
        for pid, metadata in self.peer_metadata.items():
            if pid != peer_id:  # 不包括自己
                peers.append({
                    'peerId': pid,
                    'metadata': metadata
                })

        await self.send_to_peer(peer_id, {
            'type': 'peer:list',
            'peers': peers
        })

    async def forward_message(self, from_peer_id: str, to_peer_id: str, message: dict):
        """
        转发消息（用于信令交换）

        Args:
            from_peer_id: 发送方节点ID
            to_peer_id: 接收方节点ID
            message: 消息内容
        """
        if to_peer_id not in self.peers:
            logger.warning(f"[SignalingServer] 目标节点不在线: {to_peer_id}")
            # 发送错误消息给发送方
            await self.send_to_peer(from_peer_id, {
                'type': 'error',
                'code': 'PEER_OFFLINE',
                'message': f'目标节点 {to_peer_id} 不在线',
                'targetPeerId': to_peer_id
            })
            return False

        # 添加发送方信息
        message['from'] = from_peer_id

        # 转发消息
        success = await self.send_to_peer(to_peer_id, message)

        if not success:
            # 发送失败通知
            await self.send_to_peer(from_peer_id, {
                'type': 'error',
                'code': 'FORWARD_FAILED',
                'message': f'无法转发消息到 {to_peer_id}',
                'targetPeerId': to_peer_id
            })

        return success

    async def handle_message(self, peer_id: str, raw_message: str):
        """
        处理收到的消息

        Args:
            peer_id: 发送方节点ID
            raw_message: 原始消息（JSON字符串）
        """
        try:
            message = json.loads(raw_message)
            message_type = message.get('type')

            logger.debug(f"[SignalingServer] 收到消息: {peer_id} -> {message_type}")

            # 注册消息（已在连接建立时处理，这里忽略）
            if message_type == 'register':
                pass

            # 心跳消息
            elif message_type == 'heartbeat':
                await self.send_to_peer(peer_id, {
                    'type': 'heartbeat:ack',
                    'timestamp': datetime.now().isoformat()
                })

            # Offer消息（WebRTC SDP Offer）
            elif message_type == 'offer':
                to_peer_id = message.get('to')
                if to_peer_id:
                    await self.forward_message(peer_id, to_peer_id, message)
                else:
                    logger.warning(f"[SignalingServer] Offer缺少目标节点: {message}")

            # Answer消息（WebRTC SDP Answer）
            elif message_type == 'answer':
                to_peer_id = message.get('to')
                if to_peer_id:
                    await self.forward_message(peer_id, to_peer_id, message)
                else:
                    logger.warning(f"[SignalingServer] Answer缺少目标节点: {message}")

            # ICE候选消息
            elif message_type == 'ice-candidate':
                to_peer_id = message.get('to')
                if to_peer_id:
                    await self.forward_message(peer_id, to_peer_id, message)
                else:
                    logger.warning(f"[SignalingServer] ICE候选缺少目标节点: {message}")

            # 请求节点列表
            elif message_type == 'get-peers':
                await self.send_peer_list(peer_id)

            # 其他自定义消息（直接转发）
            else:
                to_peer_id = message.get('to')
                if to_peer_id:
                    await self.forward_message(peer_id, to_peer_id, message)
                else:
                    logger.warning(f"[SignalingServer] 未知消息类型: {message_type}")

        except json.JSONDecodeError as e:
            logger.error(f"[SignalingServer] JSON解析失败: {e}")
            await self.send_to_peer(peer_id, {
                'type': 'error',
                'code': 'INVALID_JSON',
                'message': '无效的JSON格式'
            })
        except Exception as e:
            logger.error(f"[SignalingServer] 处理消息失败: {e}", exc_info=True)
            await self.send_to_peer(peer_id, {
                'type': 'error',
                'code': 'INTERNAL_ERROR',
                'message': str(e)
            })

    async def handle_websocket(self, websocket: WebSocket, peer_id: str):
        """
        处理WebSocket连接

        Args:
            websocket: WebSocket连接
            peer_id: 节点ID
        """
        await websocket.accept()
        logger.info(f"[SignalingServer] WebSocket连接已建立: {peer_id}")

        try:
            # 注册节点
            await self.register_peer(peer_id, websocket)

            # 接收消息循环
            while True:
                data = await websocket.receive_text()
                await self.handle_message(peer_id, data)

        except WebSocketDisconnect:
            logger.info(f"[SignalingServer] WebSocket连接已断开: {peer_id}")
        except Exception as e:
            logger.error(f"[SignalingServer] WebSocket错误: {peer_id}, {e}", exc_info=True)
        finally:
            # 注销节点
            await self.unregister_peer(peer_id)

    def get_stats(self) -> dict:
        """
        获取服务器统计信息

        Returns:
            统计信息字典
        """
        return {
            'online_peers': len(self.peers),
            'total_subscriptions': sum(len(subs) for subs in self.subscriptions.values()),
            'peers': [
                {
                    'peer_id': peer_id,
                    'metadata': self.peer_metadata.get(peer_id, {}),
                    'subscriptions': len(self.subscriptions.get(peer_id, set()))
                }
                for peer_id in self.peers.keys()
            ]
        }


# 全局信令服务器实例
signaling_server = SignalingServer()


def get_signaling_server() -> SignalingServer:
    """
    获取信令服务器实例

    Returns:
        SignalingServer实例
    """
    return signaling_server
