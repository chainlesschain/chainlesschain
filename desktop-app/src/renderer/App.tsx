import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAppStore } from './stores/useAppStore';
import { ukeyAPI, llmAPI } from './utils/ipc';
import LoginPage from './pages/LoginPage';
import MainLayout from './components/MainLayout';

const App: React.FC = () => {
  const { isAuthenticated, setUKeyStatus, setLLMStatus, loading, setLoading } = useAppStore();

  // 初始化应用
  useEffect(() => {
    const initialize = async () => {
      setLoading(true);

      try {
        // 检测U盾状态
        const ukeyStatus = await ukeyAPI.detect();
        setUKeyStatus(ukeyStatus);

        // 检查LLM服务状态
        const llmStatus = await llmAPI.checkStatus();
        setLLMStatus(llmStatus);
      } catch (error) {
        console.error('初始化失败:', error);
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [setUKeyStatus, setLLMStatus, setLoading]);

  // 加载状态
  if (loading) {
    return (
      <div className="loading-overlay">
        <Spin size="large" tip="正在初始化..." />
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route
          path="/login"
          element={
            isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />
          }
        />
        <Route
          path="/*"
          element={
            isAuthenticated ? <MainLayout /> : <Navigate to="/login" replace />
          }
        />
      </Routes>
    </Router>
  );
};

export default App;
