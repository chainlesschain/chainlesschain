import React, { useState } from 'react';

const App: React.FC = () => {
  const [status, setStatus] = useState('检查中...');

  React.useEffect(() => {
    // 检查electronAPI是否存在
    if (typeof window !== 'undefined') {
      const api = (window as any).electronAPI;

      if (!api) {
        setStatus('错误: electronAPI未找到！Preload脚本可能未加载。');
        return;
      }

      setStatus('electronAPI已找到！');

      // 测试U盾检测
      api.ukey.detect()
        .then((result: any) => {
          setStatus(`U盾状态: ${JSON.stringify(result, null, 2)}`);
        })
        .catch((err: any) => {
          setStatus(`U盾检测错误: ${err.message}`);
        });
    }
  }, []);

  return (
    <div style={{
      padding: '40px',
      fontFamily: 'monospace',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      <h1>ChainlessChain - 调试模式</h1>
      <div style={{
        marginTop: '20px',
        padding: '20px',
        backgroundColor: 'white',
        borderRadius: '8px',
        whiteSpace: 'pre-wrap'
      }}>
        {status}
      </div>
    </div>
  );
};

export default App;
