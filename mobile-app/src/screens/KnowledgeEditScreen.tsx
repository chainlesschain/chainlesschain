/**
 * Knowledge Edit Screen
 *
 * Editor for creating and editing knowledge items
 */

import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useAppStore} from '../stores/useAppStore';
import {storageService} from '../services/storage';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {KnowledgeStackParamList} from '../types';

type Props = NativeStackScreenProps<KnowledgeStackParamList, 'KnowledgeEdit'>;

export const KnowledgeEditScreen: React.FC<Props> = ({navigation, route}) => {
  const {id} = route.params;
  const {currentItem, addKnowledgeItem, updateKnowledgeItem, user} =
    useAppStore();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id && currentItem && currentItem.id === id) {
      setTitle(currentItem.title);
      setContent(currentItem.content);
      setTags(currentItem.tags.join(', '));
    }
  }, [id, currentItem]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('错误', '请输入标题');
      return;
    }

    if (!content.trim()) {
      Alert.alert('错误', '请输入内容');
      return;
    }

    setSaving(true);

    try {
      const tagArray = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      if (id && currentItem) {
        // Update existing item
        updateKnowledgeItem(id, {
          title: title.trim(),
          content: content.trim(),
          tags: tagArray,
          syncStatus: 'pending',
        });

        // Save to storage
        const allItems = useAppStore.getState().knowledgeItems;
        await storageService.saveKnowledgeItems(allItems);

        Alert.alert('成功', '笔记已更新', [
          {text: '确定', onPress: () => navigation.goBack()},
        ]);
      } else {
        // Create new item
        const newItem = {
          id: Date.now().toString(),
          title: title.trim(),
          content: content.trim(),
          type: 'note' as const,
          tags: tagArray,
          createdAt: new Date(),
          updatedAt: new Date(),
          deviceId: user?.deviceId || 'unknown',
          syncStatus: 'pending' as const,
        };

        addKnowledgeItem(newItem);

        // Save to storage
        const allItems = useAppStore.getState().knowledgeItems;
        await storageService.saveKnowledgeItems(allItems);

        Alert.alert('成功', '笔记已创建', [
          {text: '确定', onPress: () => navigation.goBack()},
        ]);
      }
    } catch (error) {
      console.error('Save failed:', error);
      Alert.alert('错误', '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (title || content || tags) {
      Alert.alert('确认', '放弃所有更改吗？', [
        {text: '取消', style: 'cancel'},
        {text: '确定', onPress: () => navigation.goBack()},
      ]);
    } else {
      navigation.goBack();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel}>
          <Text style={styles.cancelButton}>取消</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {id ? '编辑笔记' : '新建笔记'}
        </Text>
        <TouchableOpacity onPress={handleSave} disabled={saving}>
          <Text
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}>
            {saving ? '保存中...' : '保存'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Title Input */}
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          placeholder="标题"
          placeholderTextColor="#999"
          maxLength={100}
        />

        {/* Tags Input */}
        <TextInput
          style={styles.tagsInput}
          value={tags}
          onChangeText={setTags}
          placeholder="标签 (用逗号分隔)"
          placeholderTextColor="#999"
        />

        {/* Content Input */}
        <TextInput
          style={styles.contentInput}
          value={content}
          onChangeText={setContent}
          placeholder="内容 (支持 Markdown)"
          placeholderTextColor="#999"
          multiline
          textAlignVertical="top"
        />

        {/* Markdown Hint */}
        <View style={styles.hintContainer}>
          <Text style={styles.hintTitle}>Markdown 提示：</Text>
          <Text style={styles.hintText}>
            # 标题 | **粗体** | *斜体* | [链接](url) | - 列表
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  cancelButton: {
    fontSize: 16,
    color: '#666',
  },
  saveButton: {
    fontSize: 16,
    color: '#1890ff',
    fontWeight: '600',
  },
  saveButtonDisabled: {
    color: '#d9d9d9',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  titleInput: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    padding: 0,
  },
  tagsInput: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
  },
  contentInput: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    minHeight: 300,
    padding: 0,
  },
  hintContainer: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
  },
  hintTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  hintText: {
    fontSize: 12,
    color: '#999',
  },
});
