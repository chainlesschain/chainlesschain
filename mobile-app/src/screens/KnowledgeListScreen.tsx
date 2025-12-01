/**
 * Knowledge List Screen
 *
 * Displays list of knowledge items with search
 */

import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import {useAppStore} from '../stores/useAppStore';
import {storageService} from '../services/storage';
import {syncService} from '../services/sync';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {KnowledgeStackParamList, KnowledgeItem} from '../types';

type Props = NativeStackScreenProps<KnowledgeStackParamList, 'KnowledgeList'>;

export const KnowledgeListScreen: React.FC<Props> = ({navigation}) => {
  const {
    knowledgeItems,
    filteredItems,
    searchQuery,
    setKnowledgeItems,
    setSearchQuery,
    setCurrentItem,
    syncStatus,
    setSyncStatus,
  } = useAppStore();

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const items = await storageService.getKnowledgeItems();
      setKnowledgeItems(items);
    } catch (error) {
      console.error('Failed to load items:', error);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await loadItems();

      // Try to sync if enabled
      const config = await syncService.getConfig();
      if (config.enabled) {
        setSyncStatus({...syncStatus, status: 'syncing'});
        const result = await syncService.sync(knowledgeItems);

        if (result.success) {
          setSyncStatus({
            status: 'idle',
            lastSync: new Date(),
            pendingChanges: 0,
          });
          await loadItems(); // Reload after sync
        } else {
          setSyncStatus({
            ...syncStatus,
            status: 'error',
            error: result.errors.join(', '),
          });
        }
      }
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateNew = () => {
    setCurrentItem(null);
    navigation.navigate('KnowledgeEdit', {});
  };

  const handleItemPress = (item: KnowledgeItem) => {
    setCurrentItem(item);
    navigation.navigate('KnowledgeView', {id: item.id});
  };

  const handleItemEdit = (item: KnowledgeItem) => {
    setCurrentItem(item);
    navigation.navigate('KnowledgeEdit', {id: item.id});
  };

  const getTypeIcon = (type: KnowledgeItem['type']) => {
    switch (type) {
      case 'note':
        return '📝';
      case 'document':
        return '📄';
      case 'link':
        return '🔗';
      case 'image':
        return '🖼️';
      default:
        return '📝';
    }
  };

  const getSyncIcon = (status: KnowledgeItem['syncStatus']) => {
    switch (status) {
      case 'synced':
        return '✅';
      case 'pending':
        return '⏳';
      case 'conflict':
        return '⚠️';
      case 'local':
        return '📱';
      default:
        return '';
    }
  };

  const renderItem = ({item}: {item: KnowledgeItem}) => (
    <TouchableOpacity
      style={styles.itemContainer}
      onPress={() => handleItemPress(item)}>
      <View style={styles.itemHeader}>
        <Text style={styles.typeIcon}>{getTypeIcon(item.type)}</Text>
        <View style={styles.itemTitleContainer}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.itemDate}>
            {new Date(item.updatedAt).toLocaleDateString('zh-CN')}
          </Text>
        </View>
        <Text style={styles.syncIcon}>{getSyncIcon(item.syncStatus)}</Text>
      </View>

      <Text style={styles.itemContent} numberOfLines={2}>
        {item.content}
      </Text>

      {item.tags.length > 0 && (
        <View style={styles.tagsContainer}>
          {item.tags.slice(0, 3).map((tag, index) => (
            <View key={index} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );

  const displayItems = searchQuery ? filteredItems : knowledgeItems;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>知识库</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleCreateNew}>
          <Text style={styles.addButtonText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="搜索标题、内容或标签..."
          placeholderTextColor="#999"
        />
      </View>

      {/* List */}
      <FlatList
        data={displayItems}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              {searchQuery ? '没有找到匹配的笔记' : '还没有笔记，创建第一条吧！'}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  addButton: {
    backgroundColor: '#1890ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e8e8',
  },
  searchInput: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
  },
  listContainer: {
    padding: 16,
  },
  itemContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  itemTitleContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 2,
  },
  itemDate: {
    fontSize: 12,
    color: '#999',
  },
  syncIcon: {
    fontSize: 16,
    marginLeft: 8,
  },
  itemContent: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 8,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
  },
});
