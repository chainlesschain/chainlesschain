/**
 * Login Screen
 *
 * Handles user authentication with SIMKey
 */

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useAppStore} from '../stores/useAppStore';
import {simKeyService} from '../services/simkey';
import {storageService} from '../services/storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<Props> = ({navigation}) => {
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [simKeyConnected, setSimKeyConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const {setUser, setAuthenticated, setSIMKeyStatus} = useAppStore();

  useEffect(() => {
    checkSIMKey();
  }, []);

  const checkSIMKey = async () => {
    try {
      const status = await simKeyService.detectSIMKey();
      setSimKeyConnected(status.connected);
      setSIMKeyStatus(status);
    } catch (error) {
      console.error('Failed to detect SIMKey:', error);
    } finally {
      setChecking(false);
    }
  };

  const handleLogin = async () => {
    if (!simKeyConnected) {
      Alert.alert('错误', '未检测到 SIMKey，请插入 SIM 卡后重试');
      return;
    }

    if (pin.length < 4) {
      Alert.alert('错误', '请输入至少 4 位 PIN 码');
      return;
    }

    setLoading(true);

    try {
      // Verify PIN with SIMKey
      const verified = await simKeyService.verifyPIN({pin});

      if (!verified) {
        Alert.alert('错误', 'PIN 码错误，请重试');
        setLoading(false);
        return;
      }

      // Get device ID
      const deviceId = await storageService.getDeviceId();

      // Get public key from SIMKey
      const publicKey = await simKeyService.getPublicKey();

      // Create or load user
      let user = await storageService.getUser();

      if (!user) {
        user = {
          id: deviceId,
          deviceId,
          publicKey,
          simKeyConnected: true,
          lastLoginAt: new Date(),
        };

        await storageService.saveUser(user);
      } else {
        user.lastLoginAt = new Date();
        await storageService.saveUser(user);
      }

      // Load knowledge items
      let items = await storageService.getKnowledgeItems();

      if (items.length === 0) {
        // Initialize sample data for first-time users
        items = await storageService.initializeSampleData(deviceId);
      }

      // Update app state
      setUser(user);
      setAuthenticated(true);

      // Navigate to main app
      navigation.replace('Main');
    } catch (error) {
      console.error('Login failed:', error);
      Alert.alert('登录失败', '请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Text style={styles.logo}>🔗</Text>
          <Text style={styles.title}>ChainlessChain</Text>
          <Text style={styles.subtitle}>个人 AI 知识库</Text>
        </View>

        {/* SIMKey Status */}
        <View style={styles.statusContainer}>
          {checking ? (
            <ActivityIndicator size="small" color="#1890ff" />
          ) : (
            <View style={styles.statusRow}>
              <Text style={styles.statusIcon}>
                {simKeyConnected ? '✅' : '⚠️'}
              </Text>
              <Text style={styles.statusText}>
                {simKeyConnected ? 'SIMKey 已连接' : 'SIMKey 未连接'}
              </Text>
            </View>
          )}

          {!checking && !simKeyConnected && (
            <TouchableOpacity
              style={styles.retryButton}
              onPress={checkSIMKey}>
              <Text style={styles.retryText}>重新检测</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* PIN Input */}
        <View style={styles.inputContainer}>
          <Text style={styles.label}>请输入 PIN 码</Text>
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="输入 4-6 位数字"
            placeholderTextColor="#999"
            keyboardType="numeric"
            secureTextEntry
            maxLength={6}
            editable={!loading && simKeyConnected}
          />
        </View>

        {/* Login Button */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            (!simKeyConnected || loading) && styles.loginButtonDisabled,
          ]}
          onPress={handleLogin}
          disabled={!simKeyConnected || loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginButtonText}>登录</Text>
          )}
        </TouchableOpacity>

        {/* Dev Hint */}
        {__DEV__ && (
          <Text style={styles.devHint}>
            开发模式：任意 4-6 位数字即可登录
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logo: {
    fontSize: 72,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1890ff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  statusContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  statusText: {
    fontSize: 16,
    color: '#333',
  },
  retryButton: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: '#1890ff',
    fontSize: 14,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#333',
    borderWidth: 1,
    borderColor: '#d9d9d9',
  },
  loginButton: {
    backgroundColor: '#1890ff',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loginButtonDisabled: {
    backgroundColor: '#d9d9d9',
  },
  loginButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  devHint: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 12,
    color: '#999',
  },
});
