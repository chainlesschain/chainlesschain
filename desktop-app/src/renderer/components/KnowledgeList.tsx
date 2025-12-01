import React from 'react';
import { List, Typography, Tag, Space, Popconfirm, Button, Empty } from 'antd';
import {
  FileTextOutlined,
  FileOutlined,
  MessageOutlined,
  GlobalOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/useAppStore';
import { knowledgeAPI } from '../utils/ipc';
import type { KnowledgeItem } from '@shared/types';

const { Text } = Typography;

// 获取类型图标
const getTypeIcon = (type: KnowledgeItem['type']) => {
  switch (type) {
    case 'note':
      return <FileTextOutlined />;
    case 'document':
      return <FileOutlined />;
    case 'conversation':
      return <MessageOutlined />;
    case 'web_clip':
      return <GlobalOutlined />;
    default:
      return <FileTextOutlined />;
  }
};

// 获取类型颜色
const getTypeColor = (type: KnowledgeItem['type']) => {
  switch (type) {
    case 'note':
      return 'blue';
    case 'document':
      return 'green';
    case 'conversation':
      return 'purple';
    case 'web_clip':
      return 'orange';
    default:
      return 'default';
  }
};

// 格式化时间
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
};

const KnowledgeList: React.FC = () => {
  const {
    filteredItems,
    currentItem,
    searchQuery,
    setCurrentItem,
    deleteKnowledgeItem,
  } = useAppStore();

  // 选择笔记
  const handleSelectItem = async (item: KnowledgeItem) => {
    // 加载完整内容
    const fullItem = await knowledgeAPI.getItemById(item.id);
    if (fullItem) {
      setCurrentItem(fullItem);
    }
  };

  // 删除笔记
  const handleDeleteItem = async (item: KnowledgeItem, e: React.MouseEvent) => {
    e.stopPropagation();

    const success = await knowledgeAPI.deleteItem(item.id);
    if (success) {
      deleteKnowledgeItem(item.id);

      // 如果删除的是当前项,清空
      if (currentItem?.id === item.id) {
        setCurrentItem(null);
      }
    }
  };

  // 空状态
  if (filteredItems.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Empty
          description={
            searchQuery
              ? `未找到包含 "${searchQuery}" 的笔记`
              : '还没有笔记,点击上方"新建笔记"开始'
          }
        />
      </div>
    );
  }

  return (
    <List
      dataSource={filteredItems}
      style={{ height: 'calc(100vh - 64px)', overflowY: 'auto' }}
      renderItem={(item) => (
        <List.Item
          key={item.id}
          onClick={() => handleSelectItem(item)}
          style={{
            cursor: 'pointer',
            background: currentItem?.id === item.id ? '#e6f7ff' : 'transparent',
            borderLeft: currentItem?.id === item.id ? '3px solid #1890ff' : 'none',
            padding: '12px 16px',
          }}
          className="fade-in"
        >
          <List.Item.Meta
            avatar={
              <div style={{ fontSize: 24, color: '#1890ff' }}>
                {getTypeIcon(item.type)}
              </div>
            }
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text
                  strong
                  ellipsis
                  style={{ flex: 1, marginRight: 8 }}
                >
                  {item.title}
                </Text>
                <Popconfirm
                  title="确定删除这个笔记吗?"
                  onConfirm={(e) => handleDeleteItem(item, e as any)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>
              </div>
            }
            description={
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Space size={8}>
                  <Tag color={getTypeColor(item.type)} style={{ margin: 0 }}>
                    {item.type}
                  </Tag>
                  {item.sync_status !== 'synced' && (
                    <Tag color="orange" style={{ margin: 0 }}>
                      未同步
                    </Tag>
                  )}
                </Space>

                <Text type="secondary" style={{ fontSize: 12 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  {formatTime(item.updated_at)}
                </Text>

                {item.content && (
                  <Text
                    type="secondary"
                    ellipsis
                    style={{ fontSize: 12, display: 'block', marginTop: 4 }}
                  >
                    {item.content.substring(0, 60)}...
                  </Text>
                )}
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
};

export default KnowledgeList;
