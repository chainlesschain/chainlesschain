import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, Space, Typography, Avatar, Card, Empty, Spin } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  UserOutlined,
  ClearOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { useAppStore } from '../stores/useAppStore';
import { llmAPI } from '../utils/ipc';
import type { Message } from '@shared/types';

const { TextArea } = Input;
const { Text } = Typography;

const ChatPanel: React.FC = () => {
  const {
    messages,
    currentItem,
    isAITyping,
    llmStatus,
    addMessage,
    clearMessages,
    setIsAITyping,
  } = useAppStore();

  const [inputValue, setInputValue] = useState('');
  const [useContext, setUseContext] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputValue,
      timestamp: Date.now(),
    };

    addMessage(userMessage);
    setInputValue('');
    setIsAITyping(true);

    try {
      // 准备上下文
      let context: string[] | undefined;
      if (useContext && currentItem?.content) {
        context = [currentItem.content];
      }

      // 调用LLM
      const response = await llmAPI.query(inputValue, context);

      if (response) {
        const assistantMessage: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: response.text,
          timestamp: Date.now(),
          tokens: response.tokens,
        };

        addMessage(assistantMessage);
      }
    } catch (error) {
      console.error('AI回复失败:', error);

      const errorMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: '抱歉,我现在无法回答。请检查LLM服务是否正常运行。',
        timestamp: Date.now(),
      };

      addMessage(errorMessage);
    } finally {
      setIsAITyping(false);
    }
  };

  // 快捷键发送 (Ctrl+Enter)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === 'Enter') {
      handleSendMessage();
    }
  };

  // 清空对话
  const handleClearMessages = () => {
    clearMessages();
  };

  // 渲染消息
  const renderMessage = (message: Message) => {
    const isUser = message.role === 'user';

    return (
      <div
        key={message.id}
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}
        className="fade-in"
      >
        <Avatar
          icon={isUser ? <UserOutlined /> : <RobotOutlined />}
          style={{
            background: isUser ? '#1890ff' : '#52c41a',
            flexShrink: 0,
          }}
        />

        <div
          style={{
            flex: 1,
            maxWidth: '80%',
          }}
        >
          <Card
            size="small"
            style={{
              background: isUser ? '#e6f7ff' : '#f6ffed',
              border: 'none',
            }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>

            {message.tokens && (
              <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
                {message.tokens} tokens
              </Text>
            )}
          </Card>

          <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </Text>
        </div>
      </div>
    );
  };

  return (
    <div className="chat-container" style={{ height: 'calc(100vh - 64px)' }}>
      {/* 头部 */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafafa',
        }}
      >
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <RobotOutlined style={{ fontSize: 20, color: '#52c41a' }} />
            <Text strong>AI助手</Text>
          </Space>

          <Button
            type="text"
            size="small"
            icon={<ClearOutlined />}
            onClick={handleClearMessages}
            disabled={messages.length === 0}
          >
            清空
          </Button>
        </Space>

        {/* LLM状态 */}
        {!llmStatus.available && (
          <div style={{ marginTop: 8 }}>
            <Text type="danger" style={{ fontSize: 12 }}>
              LLM服务未连接
            </Text>
          </div>
        )}

        {/* 上下文开关 */}
        {currentItem && (
          <div style={{ marginTop: 8 }}>
            <Button
              type={useContext ? 'primary' : 'default'}
              size="small"
              icon={<ThunderboltOutlined />}
              onClick={() => setUseContext(!useContext)}
            >
              {useContext ? '使用当前笔记上下文' : '不使用上下文'}
            </Button>
          </div>
        )}
      </div>

      {/* 消息列表 */}
      <div className="chat-messages" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.length === 0 ? (
          <Empty
            description="开始与AI对话"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            style={{ marginTop: 48 }}
          />
        ) : (
          <>
            {messages.map(renderMessage)}

            {/* AI正在输入 */}
            {isAITyping && (
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <Avatar icon={<RobotOutlined />} style={{ background: '#52c41a' }} />
                <Card
                  size="small"
                  style={{ background: '#f6ffed', border: 'none' }}
                >
                  <Spin size="small" />
                  <Text style={{ marginLeft: 12 }}>AI正在思考...</Text>
                </Card>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入框 */}
      <div className="chat-input" style={{ padding: 16, borderTop: '1px solid #f0f0f0' }}>
        <Space.Compact style={{ width: '100%' }}>
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题... (Ctrl+Enter发送)"
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={!llmStatus.available || isAITyping}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendMessage}
            loading={isAITyping}
            disabled={!llmStatus.available || !inputValue.trim()}
          >
            发送
          </Button>
        </Space.Compact>
      </div>
    </div>
  );
};

export default ChatPanel;
