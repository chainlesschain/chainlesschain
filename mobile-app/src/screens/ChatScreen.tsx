/**
 * Chat Screen
 *
 * AI assistant chat interface
 */

import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useAppStore} from '../stores/useAppStore';
import {llmService} from '../services/llm';
import type {ChatMessage} from '../types';

export const ChatScreen: React.FC = () => {
  const {messages, isAITyping, addMessage, clearMessages, setAITyping} =
    useAppStore();

  const [inputText, setInputText] = useState('');
  const [llmConnected, setLlmConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    checkLLMConnection();
  }, []);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    if (messages.length > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({animated: true});
      }, 100);
    }
  }, [messages]);

  const checkLLMConnection = async () => {
    try {
      const connected = await llmService.checkConnection();
      setLlmConnected(connected);

      if (!connected) {
        addMessage({
          id: Date.now().toString(),
          role: 'system',
          content: '⚠️ AI 服务未连接。请确保 AI 服务器正在运行。',
          timestamp: new Date(),
        });
      }
    } catch (error) {
      console.error('Failed to check LLM connection:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleSend = async () => {
    if (!inputText.trim()) return;

    if (!llmConnected) {
      Alert.alert('错误', 'AI 服务未连接，请检查服务器状态');
      return;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    };

    addMessage(userMessage);
    setInputText('');
    setAITyping(true);

    try {
      // Get AI response
      const response = await llmService.query(
        inputText.trim(),
        undefined,
        messages.filter(m => m.role !== 'system')
      );

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };

      addMessage(aiMessage);
    } catch (error) {
      console.error('AI query failed:', error);

      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: `❌ ${error instanceof Error ? error.message : 'AI 查询失败'}`,
        timestamp: new Date(),
      };

      addMessage(errorMessage);
    } finally {
      setAITyping(false);
    }
  };

  const handleClear = () => {
    Alert.alert('确认', '清空所有对话记录吗？', [
      {text: '取消', style: 'cancel'},
      {text: '确定', onPress: () => clearMessages()},
    ]);
  };

  const renderMessage = ({item}: {item: ChatMessage}) => {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';

    return (
      <View
        style={[
          styles.messageContainer,
          isUser && styles.userMessageContainer,
          isSystem && styles.systemMessageContainer,
        ]}>
        <View
          style={[
            styles.messageBubble,
            isUser && styles.userBubble,
            isSystem && styles.systemBubble,
          ]}>
          <Text
            style={[
              styles.messageText,
              isUser && styles.userMessageText,
              isSystem && styles.systemMessageText,
            ]}>
            {item.content}
          </Text>
          <Text
            style={[
              styles.timestamp,
              isUser && styles.userTimestamp,
              isSystem && styles.systemTimestamp,
            ]}>
            {new Date(item.timestamp).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>AI 助手</Text>
          {checking ? (
            <ActivityIndicator size="small" color="#1890ff" />
          ) : (
            <View style={styles.statusDot}>
              <View
                style={[
                  styles.dot,
                  llmConnected ? styles.connectedDot : styles.disconnectedDot,
                ]}
              />
              <Text style={styles.statusText}>
                {llmConnected ? '在线' : '离线'}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={handleClear}>
          <Text style={styles.clearButton}>清空</Text>
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.messagesList}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>🤖</Text>
            <Text style={styles.emptySubtext}>
              向 AI 助手提问，开始对话吧！
            </Text>
          </View>
        }
      />

      {/* AI Typing Indicator */}
      {isAITyping && (
        <View style={styles.typingContainer}>
          <View style={styles.typingBubble}>
            <Text style={styles.typingText}>AI 正在思考</Text>
            <ActivityIndicator size="small" color="#1890ff" />
          </View>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="输入消息..."
          placeholderTextColor="#999"
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!inputText.trim() || isAITyping) && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={!inputText.trim() || isAITyping}>
          <Text style={styles.sendButtonText}>发送</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 12,
  },
  statusDot: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  connectedDot: {
    backgroundColor: '#52c41a',
  },
  disconnectedDot: {
    backgroundColor: '#ff4d4f',
  },
  statusText: {
    fontSize: 12,
    color: '#666',
  },
  clearButton: {
    fontSize: 14,
    color: '#1890ff',
  },
  messagesList: {
    padding: 16,
  },
  messageContainer: {
    marginBottom: 12,
    flexDirection: 'row',
  },
  userMessageContainer: {
    justifyContent: 'flex-end',
  },
  systemMessageContainer: {
    justifyContent: 'center',
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  userBubble: {
    backgroundColor: '#1890ff',
  },
  systemBubble: {
    backgroundColor: '#fff3cd',
    maxWidth: '90%',
  },
  messageText: {
    fontSize: 16,
    color: '#333',
    lineHeight: 22,
  },
  userMessageText: {
    color: '#fff',
  },
  systemMessageText: {
    color: '#856404',
    fontSize: 14,
  },
  timestamp: {
    fontSize: 10,
    color: '#999',
    marginTop: 4,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'right',
  },
  systemTimestamp: {
    color: '#856404',
    opacity: 0.7,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 12,
    maxWidth: '60%',
  },
  typingText: {
    fontSize: 14,
    color: '#666',
    marginRight: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e8e8e8',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: '#333',
    maxHeight: 100,
    marginRight: 8,
  },
  sendButton: {
    backgroundColor: '#1890ff',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#d9d9d9',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
