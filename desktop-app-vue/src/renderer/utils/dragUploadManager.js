/**
 * 拖拽上传管理器
 * 提供全局拖拽上传功能
 */

import { ref } from 'vue';

/**
 * 拖拽上传管理器
 */
class DragUploadManager {
  constructor() {
    this.isDragging = ref(false);
    this.dragCounter = 0;
    this.uploadHandlers = [];
    this.allowedTypes = [];
    this.maxFileSize = 100 * 1024 * 1024; // 100MB

    this.init();
  }

  /**
   * 初始化
   */
  init() {
    if (typeof window === 'undefined') {return;}

    // 阻止默认拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.addEventListener(eventName, this.preventDefaults, false);
    });

    // 拖拽进入
    document.addEventListener('dragenter', this.handleDragEnter.bind(this), false);

    // 拖拽离开
    document.addEventListener('dragleave', this.handleDragLeave.bind(this), false);

    // 拖拽悬停
    document.addEventListener('dragover', this.handleDragOver.bind(this), false);

    // 放下文件
    document.addEventListener('drop', this.handleDrop.bind(this), false);
  }

  /**
   * 阻止默认行为
   */
  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * 处理拖拽进入
   */
  handleDragEnter(e) {
    this.dragCounter++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      this.isDragging.value = true;
    }
  }

  /**
   * 处理拖拽离开
   */
  handleDragLeave(e) {
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragging.value = false;
    }
  }

  /**
   * 处理拖拽悬停
   */
  handleDragOver(e) {
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  /**
   * 处理文件放下
   */
  async handleDrop(e) {
    this.isDragging.value = false;
    this.dragCounter = 0;

    const dt = e.dataTransfer;
    const files = dt.files;

    if (files && files.length > 0) {
      await this.handleFiles(Array.from(files));
    }
  }

  /**
   * 处理文件
   */
  async handleFiles(files) {
    // 过滤文件
    const validFiles = files.filter(file => this.validateFile(file));

    if (validFiles.length === 0) {
      console.warn('[DragUpload] No valid files');
      return;
    }

    // 调用上传处理器
    for (const handler of this.uploadHandlers) {
      try {
        await handler(validFiles);
      } catch (error) {
        console.error('[DragUpload] Handler error:', error);
      }
    }
  }

  /**
   * 验证文件
   */
  validateFile(file) {
    // 检查文件大小
    if (file.size > this.maxFileSize) {
      console.warn(`[DragUpload] File too large: ${file.name}`);
      return false;
    }

    // 检查文件类型
    if (this.allowedTypes.length > 0) {
      const fileType = file.type || '';
      const fileExt = file.name.split('.').pop()?.toLowerCase() || '';

      const isAllowed = this.allowedTypes.some(type => {
        if (type.startsWith('.')) {
          return fileExt === type.substring(1);
        }
        return fileType.match(type);
      });

      if (!isAllowed) {
        console.warn(`[DragUpload] File type not allowed: ${file.name}`);
        return false;
      }
    }

    return true;
  }

  /**
   * 注册上传处理器
   */
  onUpload(handler) {
    this.uploadHandlers.push(handler);
    return () => {
      const index = this.uploadHandlers.indexOf(handler);
      if (index > -1) {
        this.uploadHandlers.splice(index, 1);
      }
    };
  }

  /**
   * 设置允许的文件类型
   */
  setAllowedTypes(types) {
    this.allowedTypes = types;
  }

  /**
   * 设置最大文件大小
   */
  setMaxFileSize(size) {
    this.maxFileSize = size;
  }

  /**
   * 销毁
   */
  destroy() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      document.removeEventListener(eventName, this.preventDefaults, false);
    });

    document.removeEventListener('dragenter', this.handleDragEnter, false);
    document.removeEventListener('dragleave', this.handleDragLeave, false);
    document.removeEventListener('dragover', this.handleDragOver, false);
    document.removeEventListener('drop', this.handleDrop, false);
  }
}

// 创建全局实例
const dragUploadManager = new DragUploadManager();

/**
 * 组合式函数：使用拖拽上传
 */
export function useDragUpload() {
  return {
    isDragging: dragUploadManager.isDragging,
    onUpload: (handler) => dragUploadManager.onUpload(handler),
    setAllowedTypes: (types) => dragUploadManager.setAllowedTypes(types),
    setMaxFileSize: (size) => dragUploadManager.setMaxFileSize(size),
  };
}

export default dragUploadManager;
