/**
 * Settings Screen
 *
 * App settings and preferences
 */

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Switch,
  Alert,
} from 'react-native';
import {useAppStore} from '../stores/useAppStore';
import {syncService} from '../services/sync';
import {simKeyService} from '../services/simkey';
import {storageService} from '../services/storage';
import type {SyncConfig} from '../types';

export const SettingsScreen: React.FC = () => {
  const {user, logout, simKeyStatus, syncStatus} = useAppStore();

  const [syncConfig, setSyncConfig] = useState<SyncConfig>({
    enabled: false,
    autoSync: false,
  });

  const [serverUrl, setServerUrl] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);

  useEffect(() => {
    loadSyncConfig();
  }, []);

  const loadSyncConfig = async () => {
    const config = await syncService.getConfig();
    setSyncConfig(config);
    setServerUrl(config.serverUrl || '');
  };

  const handleToggleSync = (enabled: boolean) => {
    setSyncConfig({...syncConfig, enabled});
    syncService.setConfig({...syncConfig, enabled});
  };

  const handleToggleAutoSync = (autoSync: boolean) => {
    setSyncConfig({...syncConfig, autoSync});
    syncService.setConfig({...syncConfig, autoSync});

    if (autoSync) {
      syncService.enableAutoSync();
    } else {
      syncService.disableAutoSync();
    }
  };

  const handleTestConnection = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('错误', '请输入服务器地址');
      return;
    }

    setTestingConnection(true);

    try {
      const success = await syncService.testConnection(serverUrl);

      if (success) {
        Alert.alert('成功', '服务器连接正常');
        const newConfig = {...syncConfig, serverUrl};
        setSyncConfig(newConfig);
        syncService.setConfig(newConfig);
      } else {
        Alert.alert('失败', '无法连接到服务器');
      }
    } catch (error) {
      Alert.alert('错误', '连接测试失败');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('确认退出', '确定要退出登录吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await storageService.clearAll();
            simKeyService.disconnect();
            logout();
          } catch (error) {
            console.error('Logout failed:', error);
          }
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.container}>
      {/* User Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>账户信息</Text>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>设备 ID</Text>
            <Text style={styles.value}>{user?.deviceId || 'N/A'}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>SIMKey 状态</Text>
            <Text
              style={[
                styles.value,
                simKeyStatus.connected ? styles.connected : styles.disconnected,
              ]}>
              {simKeyStatus.connected ? '✅ 已连接' : '❌ 未连接'}
            </Text>
          </View>

          {simKeyStatus.serialNumber && (
            <>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Text style={styles.label}>序列号</Text>
                <Text style={styles.value}>{simKeyStatus.serialNumber}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Sync Settings Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>同步设置</Text>

        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>启用同步</Text>
              <Text style={styles.settingDesc}>与服务器同步数据</Text>
            </View>
            <Switch
              value={syncConfig.enabled}
              onValueChange={handleToggleSync}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>自动同步</Text>
              <Text style={styles.settingDesc}>定期自动同步数据</Text>
            </View>
            <Switch
              value={syncConfig.autoSync}
              onValueChange={handleToggleAutoSync}
              disabled={!syncConfig.enabled}
            />
          </View>

          {syncConfig.enabled && (
            <>
              <View style={styles.divider} />

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>服务器地址</Text>
                <TextInput
                  style={styles.input}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  placeholder="http://example.com:8080"
                  placeholderTextColor="#999"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <TouchableOpacity
                  style={[
                    styles.testButton,
                    testingConnection && styles.testButtonDisabled,
                  ]}
                  onPress={handleTestConnection}
                  disabled={testingConnection}>
                  <Text style={styles.testButtonText}>
                    {testingConnection ? '测试中...' : '测试连接'}
                  </Text>
                </TouchableOpacity>
              </View>

              {syncStatus.lastSync && (
                <>
                  <View style={styles.divider} />
                  <View style={styles.infoRow}>
                    <Text style={styles.label}>最后同步</Text>
                    <Text style={styles.value}>
                      {new Date(syncStatus.lastSync).toLocaleString('zh-CN')}
                    </Text>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>

        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.label}>版本</Text>
            <Text style={styles.value}>0.1.0 (Mobile MVP)</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <Text style={styles.label}>开发模式</Text>
            <Text style={styles.value}>{__DEV__ ? '是' : '否'}</Text>
          </View>
        </View>
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>退出登录</Text>
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>ChainlessChain Mobile</Text>
        <Text style={styles.footerSubtext}>个人 AI 知识库系统</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  connected: {
    color: '#52c41a',
  },
  disconnected: {
    color: '#ff4d4f',
  },
  divider: {
    height: 1,
    backgroundColor: '#e8e8e8',
    marginVertical: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: '#333',
    marginBottom: 4,
  },
  settingDesc: {
    fontSize: 12,
    color: '#999',
  },
  inputGroup: {
    paddingTop: 8,
  },
  inputLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    marginBottom: 12,
  },
  testButton: {
    backgroundColor: '#1890ff',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  testButtonDisabled: {
    backgroundColor: '#d9d9d9',
  },
  testButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: '#ff4d4f',
    borderRadius: 8,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  logoutButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
});
