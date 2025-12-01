import React, { useEffect } from 'react';
import { Layout, Menu, Input, Button, Space, Tooltip, Badge, Spin } from 'antd';
import {
  BookOutlined,
  MessageOutlined,
  SettingOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined,
  LogoutOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/useAppStore';
import { knowledgeAPI, gitAPI } from '../utils/ipc';
import KnowledgeList from './KnowledgeList';
import MarkdownEditor from './MarkdownEditor';
import ChatPanel from './ChatPanel';

const { Header, Sider, Content } = Layout;

const MainLayout: React.FC = () => {
  const {
    knowledgeItems,
    currentItem,
    searchQuery,
    chatPanelVisible,
    gitStatus,
    setKnowledgeItems,
    setCurrentItem,
    setSearchQuery,
    setChatPanelVisible,
    setGitStatus,
    logout,
  } = useAppStore();

  const [syncing, setSyncing] = React.useState(false);
  const [loadingItems, setLoadingItems] = React.useState(false);

  // 加载知识库列表
  useEffect(() => {
    const loadItems = async () => {
      setLoadingItems(true);
      try {
        const items = await knowledgeAPI.getItems();
        setKnowledgeItems(items);

        // 如果没有当前项且有数据,选择第一个
        if (!currentItem && items.length > 0) {
          const firstItem = items[0];
          const fullItem = await knowledgeAPI.getItemById(firstItem.id);
          if (fullItem) {
            setCurrentItem(fullItem);
          }
        }
      } catch (error) {
        console.error('加载知识库失败:', error);
      } finally {
        setLoadingItems(false);
      }
    };

    loadItems();

    // 定期刷新Git状态
    const updateGitStatus = async () => {
      const status = await gitAPI.getStatus();
      setGitStatus(status);
    };

    updateGitStatus();
    const interval = setInterval(updateGitStatus, 30000); // 每30秒更新一次

    return () => clearInterval(interval);
  }, [setKnowledgeItems, setCurrentItem, setGitStatus, currentItem]);

  // 创建新笔记
  const handleCreateNote = async () => {
    const newItem = await knowledgeAPI.addItem({
      title: '新笔记',
      type: 'note',
      content: '# 新笔记\n\n开始写作...',
    });

    if (newItem) {
      setKnowledgeItems([newItem, ...knowledgeItems]);
      setCurrentItem(newItem);
    }
  };

  // 同步
  const handleSync = async () => {
    setSyncing(true);
    try {
      const success = await gitAPI.sync();
      if (success) {
        const status = await gitAPI.getStatus();
        setGitStatus(status);
      }
    } finally {
      setSyncing(false);
    }
  };

  // 切换AI聊天面板
  const toggleChatPanel = () => {
    setChatPanelVisible(!chatPanelVisible);
  };

  // 处理登出
  const handleLogout = () => {
    logout();
  };

  return (
    <Layout style={{ height: '100vh' }}>
      {/* 侧边栏 */}
      <Sider width={60} theme="dark">
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 24,
          }}
        >
          <BookOutlined />
        </div>

        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={['knowledge']}
          items={[
            {
              key: 'knowledge',
              icon: <BookOutlined />,
              label: '知识库',
            },
            {
              key: 'chat',
              icon: (
                <Badge dot={chatPanelVisible}>
                  <MessageOutlined />
                </Badge>
              ),
              label: 'AI对话',
              onClick: toggleChatPanel,
            },
            {
              key: 'settings',
              icon: <SettingOutlined />,
              label: '设置',
            },
          ]}
        />

        <div
          style={{
            position: 'absolute',
            bottom: 0,
            width: '100%',
            padding: '16px 0',
            textAlign: 'center',
          }}
        >
          <Tooltip title="退出登录" placement="right">
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={handleLogout}
              style={{ color: '#fff' }}
            />
          </Tooltip>
        </div>
      </Sider>

      {/* 主内容区 */}
      <Layout>
        {/* 顶部栏 */}
        <Header
          style={{
            background: '#fff',
            padding: '0 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreateNote}
            >
              新建笔记
            </Button>

            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索笔记..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 300 }}
              allowClear
            />
          </Space>

          <Space>
            <Tooltip title="同步">
              <Button
                icon={<SyncOutlined spin={syncing} />}
                onClick={handleSync}
                loading={syncing}
              >
                {gitStatus?.modified?.length || 0} 个变更
              </Button>
            </Tooltip>

            <Tooltip title={chatPanelVisible ? '关闭AI助手' : '打开AI助手'}>
              <Button
                type={chatPanelVisible ? 'primary' : 'default'}
                icon={<RobotOutlined />}
                onClick={toggleChatPanel}
              >
                AI助手
              </Button>
            </Tooltip>
          </Space>
        </Header>

        {/* 内容区 */}
        <Layout style={{ background: '#fff' }}>
          {/* 笔记列表 */}
          <Sider width={300} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
            {loadingItems ? (
              <div style={{ textAlign: 'center', paddingTop: 48 }}>
                <Spin />
              </div>
            ) : (
              <KnowledgeList />
            )}
          </Sider>

          {/* 编辑器 */}
          <Content style={{ background: '#fff', position: 'relative' }}>
            {currentItem ? (
              <MarkdownEditor />
            ) : (
              <div className="empty-state">
                <BookOutlined className="empty-state-icon" />
                <div className="empty-state-text">选择或创建一个笔记开始</div>
                <div className="empty-state-description">
                  点击左上角的"新建笔记"按钮创建第一个笔记
                </div>
              </div>
            )}
          </Content>

          {/* AI聊天面板 */}
          {chatPanelVisible && (
            <Sider
              width={400}
              theme="light"
              style={{ borderLeft: '1px solid #f0f0f0' }}
              className="slide-in"
            >
              <ChatPanel />
            </Sider>
          )}
        </Layout>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
