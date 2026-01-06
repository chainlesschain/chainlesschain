<template>
  <div class="progressive-file-tree">
    <a-input-search
      v-model:value="searchQuery"
      placeholder="Search files..."
      @search="handleSearch"
      class="search-input"
    />

    <a-spin :spinning="loading" tip="Loading files...">
      <div class="tree-container" ref="treeContainer" @scroll="handleScroll">
        <a-tree
          v-if="visibleNodes.length > 0"
          :tree-data="visibleNodes"
          :expanded-keys="expandedKeys"
          :selected-keys="selectedKeys"
          :load-data="onLoadData"
          @expand="onExpand"
          @select="onSelect"
          :virtual="true"
          :height="treeHeight"
          :item-height="28"
        >
          <template #title="{ title, key, isLeaf, loaded, loading: nodeLoading }">
            <div class="tree-node-title">
              <span class="node-icon">
                <FileOutlined v-if="isLeaf" />
                <FolderOutlined v-else-if="!expandedKeys.includes(key)" />
                <FolderOpenOutlined v-else />
              </span>
              <span class="node-text" :title="title">{{ title }}</span>
              <a-spin
                v-if="nodeLoading"
                size="small"
                class="node-loading"
              />
              <a-badge
                v-if="!isLeaf && !loaded"
                :count="getChildCount(key)"
                :number-style="{ backgroundColor: '#52c41a' }"
                class="child-count"
              />
            </div>
          </template>
        </a-tree>

        <!-- Virtual scroll placeholder -->
        <div
          v-if="hasMore"
          class="load-more-trigger"
          ref="loadMoreTrigger"
        >
          <a-spin size="small" />
          <span>Loading more...</span>
        </div>

        <!-- Empty state -->
        <a-empty
          v-if="!loading && visibleNodes.length === 0"
          description="No files found"
        />
      </div>
    </a-spin>

    <!-- Stats -->
    <div class="tree-stats">
      <a-space size="small">
        <span>Loaded: {{ loadedCount }} / {{ totalCount }}</span>
        <a-divider type="vertical" />
        <span>Visible: {{ visibleNodes.length }}</span>
        <a-divider type="vertical" />
        <span>Expanded: {{ expandedKeys.length }}</span>
      </a-space>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  FileOutlined,
  FolderOutlined,
  FolderOpenOutlined
} from '@ant-design/icons-vue'
import performanceTracker from '@/utils/performance-tracker'

const props = defineProps({
  projectPath: {
    type: String,
    required: true
  },
  batchSize: {
    type: Number,
    default: 50
  },
  expandDepth: {
    type: Number,
    default: 1
  }
})

const emit = defineEmits(['select', 'load', 'error'])

// State
const loading = ref(false)
const searchQuery = ref('')
const treeContainer = ref(null)
const loadMoreTrigger = ref(null)
const treeHeight = ref(600)

// Tree data
const allNodes = ref([])
const visibleNodes = ref([])
const expandedKeys = ref([])
const selectedKeys = ref([])
const loadedNodes = new Map()
const nodeChildrenMap = new Map()

// Pagination
const currentBatch = ref(0)
const batchSize = computed(() => props.batchSize)
const hasMore = computed(() => {
  return visibleNodes.value.length < allNodes.value.length
})

// Stats
const loadedCount = computed(() => loadedNodes.size)
const totalCount = ref(0)

// Intersection Observer for infinite scroll
let intersectionObserver = null

/**
 * Initialize tree
 */
const initTree = async () => {
  loading.value = true
  const startTime = performance.now()

  try {
    // Load root level files
    const files = await window.electron.invoke('get-project-files', {
      projectPath: props.projectPath,
      depth: 0
    })

    // Build tree structure
    const tree = buildTreeStructure(files)
    allNodes.value = tree
    totalCount.value = countTotalNodes(tree)

    // Load first batch
    loadNextBatch()

    // Auto-expand to specified depth
    if (props.expandDepth > 0) {
      await autoExpandToDepth(props.expandDepth)
    }

    performanceTracker.trackFileOperation(
      'load-file-tree',
      props.projectPath,
      startTime
    )

    emit('load', { total: totalCount.value })
  } catch (error) {
    console.error('Failed to load file tree:', error)
    emit('error', error)
  } finally {
    loading.value = false
  }
}

/**
 * Build tree structure from flat file list
 */
const buildTreeStructure = (files) => {
  const tree = []
  const map = new Map()

  // Sort files by path depth and name
  files.sort((a, b) => {
    const depthA = a.path.split('/').length
    const depthB = b.path.split('/').length
    if (depthA !== depthB) return depthA - depthB
    return a.path.localeCompare(b.path)
  })

  files.forEach(file => {
    const parts = file.path.split('/')
    const name = parts[parts.length - 1]
    const parentPath = parts.slice(0, -1).join('/')

    const node = {
      key: file.path,
      title: name,
      isLeaf: file.type === 'file',
      children: [],
      loaded: false,
      loading: false,
      path: file.path,
      type: file.type,
      size: file.size,
      modified: file.modified
    }

    map.set(file.path, node)

    if (parentPath === '') {
      tree.push(node)
    } else {
      const parent = map.get(parentPath)
      if (parent) {
        parent.children.push(node)
        nodeChildrenMap.set(parentPath, parent.children.length)
      }
    }
  })

  return tree
}

/**
 * Count total nodes in tree
 */
const countTotalNodes = (nodes) => {
  let count = 0
  const traverse = (items) => {
    items.forEach(item => {
      count++
      if (item.children && item.children.length > 0) {
        traverse(item.children)
      }
    })
  }
  traverse(nodes)
  return count
}

/**
 * Load next batch of nodes
 */
const loadNextBatch = () => {
  const start = currentBatch.value * batchSize.value
  const end = start + batchSize.value

  const flatNodes = flattenTree(allNodes.value)
  const batch = flatNodes.slice(start, end)

  visibleNodes.value = [...visibleNodes.value, ...batch]
  currentBatch.value++
}

/**
 * Flatten tree to array
 */
const flattenTree = (nodes, depth = 0) => {
  const result = []

  const traverse = (items, currentDepth) => {
    items.forEach(item => {
      result.push({ ...item, depth: currentDepth })

      if (expandedKeys.value.includes(item.key) && item.children) {
        traverse(item.children, currentDepth + 1)
      }
    })
  }

  traverse(nodes, depth)
  return result
}

/**
 * Load data for a node (lazy loading)
 */
const onLoadData = async (treeNode) => {
  const { key, dataRef } = treeNode

  if (dataRef.loaded || dataRef.isLeaf) {
    return
  }

  dataRef.loading = true
  const startTime = performance.now()

  try {
    const children = await window.electron.invoke('get-directory-contents', {
      path: dataRef.path
    })

    const childNodes = children.map(child => ({
      key: child.path,
      title: child.name,
      isLeaf: child.type === 'file',
      children: [],
      loaded: false,
      loading: false,
      path: child.path,
      type: child.type,
      size: child.size,
      modified: child.modified
    }))

    dataRef.children = childNodes
    dataRef.loaded = true
    loadedNodes.set(key, dataRef)

    performanceTracker.trackFileOperation(
      'load-directory',
      dataRef.path,
      startTime
    )
  } catch (error) {
    console.error('Failed to load directory:', error)
    emit('error', error)
  } finally {
    dataRef.loading = false
  }
}

/**
 * Handle node expand
 */
const onExpand = (keys, { expanded, node }) => {
  expandedKeys.value = keys

  if (expanded) {
    // Refresh visible nodes when expanding
    nextTick(() => {
      refreshVisibleNodes()
    })
  }
}

/**
 * Handle node select
 */
const onSelect = (keys, { selected, node }) => {
  selectedKeys.value = keys

  if (selected && node.dataRef.isLeaf) {
    emit('select', {
      path: node.dataRef.path,
      type: node.dataRef.type,
      size: node.dataRef.size
    })
  }
}

/**
 * Refresh visible nodes
 */
const refreshVisibleNodes = () => {
  const flatNodes = flattenTree(allNodes.value)
  const end = currentBatch.value * batchSize.value
  visibleNodes.value = flatNodes.slice(0, end)
}

/**
 * Auto-expand to specified depth
 */
const autoExpandToDepth = async (depth) => {
  const keysToExpand = []

  const traverse = async (nodes, currentDepth) => {
    if (currentDepth >= depth) return

    for (const node of nodes) {
      if (!node.isLeaf) {
        keysToExpand.push(node.key)

        if (!node.loaded) {
          await onLoadData({ key: node.key, dataRef: node })
        }

        if (node.children && node.children.length > 0) {
          await traverse(node.children, currentDepth + 1)
        }
      }
    }
  }

  await traverse(allNodes.value, 0)
  expandedKeys.value = keysToExpand
  refreshVisibleNodes()
}

/**
 * Handle scroll for infinite loading
 */
const handleScroll = () => {
  if (!treeContainer.value || !hasMore.value) return

  const { scrollTop, scrollHeight, clientHeight } = treeContainer.value
  const scrollPercentage = (scrollTop + clientHeight) / scrollHeight

  // Load more when scrolled 80%
  if (scrollPercentage > 0.8) {
    loadNextBatch()
  }
}

/**
 * Handle search
 */
const handleSearch = async (value) => {
  if (!value.trim()) {
    refreshVisibleNodes()
    return
  }

  const startTime = performance.now()

  try {
    const results = await window.electron.invoke('search-files', {
      projectPath: props.projectPath,
      query: value
    })

    // Build tree from search results
    const tree = buildTreeStructure(results)
    visibleNodes.value = flattenTree(tree)

    performanceTracker.trackFileOperation(
      'search-files',
      props.projectPath,
      startTime
    )
  } catch (error) {
    console.error('Search failed:', error)
    emit('error', error)
  }
}

/**
 * Get child count for a node
 */
const getChildCount = (key) => {
  return nodeChildrenMap.get(key) || 0
}

/**
 * Setup intersection observer for infinite scroll
 */
const setupIntersectionObserver = () => {
  if (!loadMoreTrigger.value) return

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && hasMore.value) {
          loadNextBatch()
        }
      })
    },
    {
      root: treeContainer.value,
      threshold: 0.1
    }
  )

  intersectionObserver.observe(loadMoreTrigger.value)
}

/**
 * Expand node by path
 */
const expandNode = async (path) => {
  const parts = path.split('/')
  const keysToExpand = []

  for (let i = 0; i < parts.length; i++) {
    const currentPath = parts.slice(0, i + 1).join('/')
    keysToExpand.push(currentPath)

    const node = findNodeByKey(currentPath)
    if (node && !node.loaded && !node.isLeaf) {
      await onLoadData({ key: currentPath, dataRef: node })
    }
  }

  expandedKeys.value = [...new Set([...expandedKeys.value, ...keysToExpand])]
  refreshVisibleNodes()
}

/**
 * Find node by key
 */
const findNodeByKey = (key) => {
  const traverse = (nodes) => {
    for (const node of nodes) {
      if (node.key === key) return node
      if (node.children) {
        const found = traverse(node.children)
        if (found) return found
      }
    }
    return null
  }

  return traverse(allNodes.value)
}

/**
 * Refresh tree
 */
const refresh = async () => {
  allNodes.value = []
  visibleNodes.value = []
  expandedKeys.value = []
  selectedKeys.value = []
  loadedNodes.clear()
  nodeChildrenMap.clear()
  currentBatch.value = 0

  await initTree()
}

// Expose methods
defineExpose({
  refresh,
  expandNode
})

// Watch for project path changes
watch(() => props.projectPath, () => {
  refresh()
})

onMounted(() => {
  initTree()

  // Calculate tree height
  if (treeContainer.value) {
    treeHeight.value = treeContainer.value.clientHeight
  }

  // Setup intersection observer
  nextTick(() => {
    setupIntersectionObserver()
  })
})

onUnmounted(() => {
  if (intersectionObserver) {
    intersectionObserver.disconnect()
  }
})
</script>

<style scoped>
.progressive-file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.search-input {
  margin-bottom: 12px;
}

.tree-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}

.tree-node-title {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

.node-icon {
  flex-shrink: 0;
  color: #8c8c8c;
}

.node-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-loading {
  flex-shrink: 0;
  margin-left: auto;
}

.child-count {
  flex-shrink: 0;
  margin-left: auto;
}

.load-more-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: #8c8c8c;
}

.tree-stats {
  padding: 8px 12px;
  border-top: 1px solid #f0f0f0;
  font-size: 12px;
  color: #8c8c8c;
}
</style>
