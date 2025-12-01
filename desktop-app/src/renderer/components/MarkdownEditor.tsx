import React, { useState, useEffect, useCallback } from 'react';
import { Input, Button, Space, message } from 'antd';
import { SaveOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import { useAppStore } from '../stores/useAppStore';
import { knowledgeAPI } from '../utils/ipc';
import debounce from 'lodash.debounce';

const { TextArea } = Input;

const MarkdownEditor: React.FC = () => {
  const { currentItem, updateKnowledgeItem } = useAppStore();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');

  // 同步当前项到本地状态
  useEffect(() => {
    if (currentItem) {
      setTitle(currentItem.title);
      setContent(currentItem.content || '');
    }
  }, [currentItem]);

  // 防抖保存
  const debouncedSave = useCallback(
    debounce(async (id: string, newTitle: string, newContent: string) => {
      setSaving(true);
      try {
        const success = await knowledgeAPI.updateItem(id, {
          title: newTitle,
          content: newContent,
        });

        if (success) {
          updateKnowledgeItem(id, {
            title: newTitle,
            content: newContent,
            updated_at: Date.now(),
          });
        }
      } catch (error) {
        console.error('保存失败:', error);
        message.error('保存失败');
      } finally {
        setSaving(false);
      }
    }, 1000),
    [updateKnowledgeItem]
  );

  // 标题变化
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);

    if (currentItem) {
      debouncedSave(currentItem.id, newTitle, content);
    }
  };

  // 内容变化
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);

    if (currentItem) {
      debouncedSave(currentItem.id, title, newContent);
    }
  };

  // 手动保存
  const handleManualSave = async () => {
    if (!currentItem) return;

    setSaving(true);
    try {
      const success = await knowledgeAPI.updateItem(currentItem.id, {
        title,
        content,
      });

      if (success) {
        updateKnowledgeItem(currentItem.id, {
          title,
          content,
          updated_at: Date.now(),
        });
        message.success('保存成功');
      } else {
        message.error('保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  // 快捷键保存 (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleManualSave();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentItem, title, content]);

  if (!currentItem) {
    return null;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 编辑器头部 */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fafafa',
        }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Input
            value={title}
            onChange={handleTitleChange}
            placeholder="输入标题..."
            bordered={false}
            style={{
              fontSize: 24,
              fontWeight: 600,
              padding: 0,
            }}
          />

          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              onClick={handleManualSave}
              loading={saving}
            >
              {saving ? '保存中...' : '保存 (Ctrl+S)'}
            </Button>

            <Button
              icon={activeTab === 'edit' ? <EyeOutlined /> : <EditOutlined />}
              onClick={() => setActiveTab(activeTab === 'edit' ? 'preview' : 'edit')}
            >
              {activeTab === 'edit' ? '预览' : '编辑'}
            </Button>
          </Space>
        </Space>
      </div>

      {/* 编辑器内容 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'edit' ? (
          <TextArea
            value={content}
            onChange={handleContentChange}
            placeholder="开始写作... 支持 Markdown 格式"
            bordered={false}
            style={{
              height: '100%',
              padding: '24px',
              fontSize: 16,
              lineHeight: 1.8,
              fontFamily: 'Consolas, Monaco, monospace',
              resize: 'none',
            }}
          />
        ) : (
          <div
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div
              style={{
                maxWidth: 800,
                margin: '0 auto',
                fontSize: 16,
                lineHeight: 1.8,
              }}
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkdownEditor;
