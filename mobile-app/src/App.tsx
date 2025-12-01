/**
 * ChainlessChain Mobile App
 * Main Application Component
 */

import React, {useEffect} from 'react';
import {SafeAreaView, StatusBar, StyleSheet} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import 'react-native-get-random-values';

// Screens
import {LoginScreen} from './screens/LoginScreen';
import {KnowledgeListScreen} from './screens/KnowledgeListScreen';
import {KnowledgeEditScreen} from './screens/KnowledgeEditScreen';
import {KnowledgeViewScreen} from './screens/KnowledgeViewScreen';
import {ChatScreen} from './screens/ChatScreen';
import {SettingsScreen} from './screens/SettingsScreen';

// Types
import type {RootStackParamList, MainTabParamList, KnowledgeStackParamList} from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const KnowledgeStack = createNativeStackNavigator<KnowledgeStackParamList>();

// Knowledge Stack Navigator
function KnowledgeStackNavigator() {
  return (
    <KnowledgeStack.Navigator>
      <KnowledgeStack.Screen
        name="KnowledgeList"
        component={KnowledgeListScreen}
        options={{headerShown: false}}
      />
      <KnowledgeStack.Screen
        name="KnowledgeView"
        component={KnowledgeViewScreen}
        options={{
          title: '查看笔记',
          headerBackTitle: '返回',
        }}
      />
      <KnowledgeStack.Screen
        name="KnowledgeEdit"
        component={KnowledgeEditScreen}
        options={{
          headerShown: false,
        }}
      />
    </KnowledgeStack.Navigator>
  );
}

// Main Tab Navigator
function MainTabNavigator() {
  return (
    <MainTab.Navigator
      screenOptions={{
        tabBarActiveTintColor: '#1890ff',
        tabBarInactiveTintColor: '#999',
        headerShown: false,
      }}>
      <MainTab.Screen
        name="Knowledge"
        component={KnowledgeStackNavigator}
        options={{
          title: '知识库',
          tabBarIcon: ({color}) => <TabIcon icon="📚" color={color} />,
        }}
      />
      <MainTab.Screen
        name="Chat"
        component={ChatScreen}
        options={{
          title: 'AI 助手',
          tabBarIcon: ({color}) => <TabIcon icon="💬" color={color} />,
        }}
      />
      <MainTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: '设置',
          tabBarIcon: ({color}) => <TabIcon icon="⚙️" color={color} />,
        }}
      />
    </MainTab.Navigator>
  );
}

// Simple tab icon component
function TabIcon({icon, color}: {icon: string; color: string}) {
  return (
    <SafeAreaView style={styles.iconContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      {/* Using emoji as icons for simplicity - replace with react-native-vector-icons if needed */}
      <SafeAreaView style={{opacity: color === '#1890ff' ? 1 : 0.5}}>
        <StatusBar barStyle="dark-content" />
        {/* Emoji rendering */}
        {/* Note: For production, consider using a proper icon library */}
      </SafeAreaView>
    </SafeAreaView>
  );
}

// Root App Component
export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <NavigationContainer>
        <RootStack.Navigator
          screenOptions={{
            headerShown: false,
          }}>
          <RootStack.Screen name="Login" component={LoginScreen} />
          <RootStack.Screen name="Main" component={MainTabNavigator} />
        </RootStack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  iconContainer: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
