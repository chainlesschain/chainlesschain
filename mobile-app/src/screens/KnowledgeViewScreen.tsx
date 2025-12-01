/**
 * Knowledge View Screen
 *
 * Displays knowledge item with Markdown rendering
 */

import React, {useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import {useAppStore} from '../stores/useAppStore';
import {storageService} from '../services/storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {KnowledgeStackParamList} from '../types';

type Props = NativeStackScreenProps<KnowledgeStackParamList, 'KnowledgeView'>;

export const KnowledgeViewScreen: React.FC<Props> = ({navigation, route}) => {
  const {id} = route.params;
  const {currentItem, deleteKnowledgeItem} = useAppStore();

  useEffect(() => {
    // Set navigation options
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={handleEdit} style={styles.headerButton}>
            <Text style={styles.headerButtonText}>编辑</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} style={styles.headerButton}>
            <Text style={[styles.headerButtonText, styles.deleteText]}>
              删除
            </Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [currentItem]);

  const handleEdit = () => {
    if (currentItem) {
      navigation.navigate('KnowledgeEdit', {id: currentItem.id});
    }
  };

  const handleDelete = () => {
    if (!currentItem) return;

    Alert.alert('确认删除', '确定要删除这条笔记吗？', [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            deleteKnowledgeItem(currentItem.id);

            // Save to storage
            const allItems = useAppStore.getState().knowledgeItems;
            await storageService.saveKnowledgeItems(allItems);

            navigation.goBack();
          } catch (error) {
            console.error('Delete failed:', error);
            Alert.alert('错误', '删除失败，请重试');
          }
        },
      },
    ]);
  };

  if (!currentItem) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>未找到笔记</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header Info */}
      <View style={styles.header}>
        <Text style={styles.title}>{currentItem.title}</Text>

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            创建: {new Date(currentItem.createdAt).toLocaleDateString('zh-CN')}
          </Text>
          <Text style={styles.metaText}>
            更新: {new Date(currentItem.updatedAt).toLocaleDateString('zh-CN')}
          </Text>
        </View>

        {currentItem.tags.length > 0 && (
          <View style={styles.tagsContainer}>
            {currentItem.tags.map((tag, index) => (
              <View key={index} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Markdown style={markdownStyles}>{currentItem.content}</Markdown>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  meta: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#999',
    marginRight: 16,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tag: {
    backgroundColor: '#e6f7ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
    marginTop: 4,
  },
  tagText: {
    fontSize: 12,
    color: '#1890ff',
  },
  content: {
    padding: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    marginTop: 48,
  },
  headerButtons: {
    flexDirection: 'row',
  },
  headerButton: {
    marginLeft: 16,
  },
  headerButtonText: {
    fontSize: 16,
    color: '#1890ff',
  },
  deleteText: {
    color: '#ff4d4f',
  },
});

const markdownStyles = StyleSheet.create({
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: '#333',
  },
  heading1: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    color: '#333',
  },
  heading2: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 14,
    marginBottom: 6,
    color: '#333',
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
    color: '#333',
  },
  paragraph: {
    marginBottom: 8,
  },
  strong: {
    fontWeight: 'bold',
  },
  em: {
    fontStyle: 'italic',
  },
  code_inline: {
    backgroundColor: '#f5f5f5',
    borderRadius: 3,
    paddingHorizontal: 4,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  code_block: {
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  bullet_list: {
    marginBottom: 8,
  },
  ordered_list: {
    marginBottom: 8,
  },
  list_item: {
    marginBottom: 4,
  },
  link: {
    color: '#1890ff',
    textDecorationLine: 'underline',
  },
  blockquote: {
    backgroundColor: '#f5f5f5',
    borderLeftWidth: 4,
    borderLeftColor: '#1890ff',
    paddingLeft: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
});
