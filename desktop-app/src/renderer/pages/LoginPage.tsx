import React, { useState, useEffect } from 'react';
import { Card, Input, Button, message, Space, Typography, Alert } from 'antd';
import { LockOutlined, UsbOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { useAppStore } from '../stores/useAppStore';
import { ukeyAPI } from '../utils/ipc';

const { Title, Text } = Typography;

const LoginPage: React.FC = () => {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const { ukeyStatus, setUKeyStatus, setAuthenticated, setDeviceId } = useAppStore();

  // 定期检测U盾状态
  useEffect(() => {
    const checkUKey = async () => {
      const status = await ukeyAPI.detect();
      setUKeyStatus(status);
    };

    checkUKey();
    const interval = setInterval(checkUKey, 3000); // 每3秒检查一次

    return () => clearInterval(interval);
  }, [setUKeyStatus]);

  // 处理登录
  const handleLogin = async () => {
    if (!pin) {
      message.warning('请输入PIN码');
      return;
    }

    if (!ukeyStatus.detected) {
      message.error('未检测到U盾,请插入U盾后重试');
      return;
    }

    setLoading(true);

    try {
      const success = await ukeyAPI.verifyPIN(pin);

      if (success) {
        message.success('登录成功!');

        // 更新U盾状态
        const newStatus = await ukeyAPI.detect();
        setUKeyStatus(newStatus);
        setDeviceId(newStatus.deviceId || null);

        // 设置为已认证
        setAuthenticated(true);
      } else {
        message.error('PIN码错误,请重试');
        setPin('');
      }
    } catch (error) {
      console.error('登录失败:', error);
      message.error('登录失败,请重试');
    } finally {
      setLoading(false);
    }
  };

  // 按Enter键登录
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}
        className="fade-in"
      >
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Logo和标题 */}
          <div style={{ textAlign: 'center' }}>
            <LockOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            <Title level={3} style={{ marginTop: 16, marginBottom: 8 }}>
              ChainlessChain
            </Title>
            <Text type="secondary">个人AI知识库</Text>
          </div>

          {/* U盾状态 */}
          <Alert
            type={ukeyStatus.detected ? 'success' : 'warning'}
            message={
              <Space>
                <UsbOutlined />
                <span>
                  {ukeyStatus.detected ? 'U盾已连接' : '未检测到U盾'}
                </span>
                {ukeyStatus.detected ? (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                ) : (
                  <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                )}
              </Space>
            }
            showIcon={false}
          />

          {/* PIN输入 */}
          <div>
            <Text strong>请输入PIN码:</Text>
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              placeholder="输入6位PIN码"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={!ukeyStatus.detected || loading}
              maxLength={6}
              style={{ marginTop: 8 }}
            />
          </div>

          {/* 登录按钮 */}
          <Button
            type="primary"
            size="large"
            block
            loading={loading}
            disabled={!ukeyStatus.detected}
            onClick={handleLogin}
          >
            {loading ? '验证中...' : '登录'}
          </Button>

          {/* 提示信息 */}
          <div style={{ textAlign: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              开发模式: 默认PIN为 <Text code>123456</Text>
            </Text>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default LoginPage;
