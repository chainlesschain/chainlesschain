/**
 * 拖拽上传管理器
 * 提供全局拖拽上传功能
 */

import { logger } from "@/utils/logger";
import { ref, type Ref } from "vue";

// ==================== 类型定义 ====================

/**
 * 上传处理器类型
 */
export type UploadHandler = (files: File[]) => void | Promise<void>;

/**
 * useDragUpload 返回类型
 */
export interface UseDragUploadReturn {
  isDragging: Ref<boolean>;
  onUpload: (handler: UploadHandler) => () => void;
  setAllowedTypes: (types: string[]) => void;
  setMaxFileSize: (size: number) => void;
}

// ==================== 类实现 ====================

/**
 * 拖拽上传管理器
 */
class DragUploadManager {
  isDragging: Ref<boolean>;
  private dragCounter: number;
  private uploadHandlers: UploadHandler[];
  private allowedTypes: string[];
  private maxFileSize: number;
  private _boundHandleDragEnter: (e: DragEvent) => void;
  private _boundHandleDragLeave: (e: DragEvent) => void;
  private _boundHandleDragOver: (e: DragEvent) => void;
  private _boundHandleDrop: (e: DragEvent) => Promise<void>;

  constructor() {
    this.isDragging = ref(false);
    this.dragCounter = 0;
    this.uploadHandlers = [];
    this.allowedTypes = [];
    this.maxFileSize = 100 * 1024 * 1024; // 100MB

    this._boundHandleDragEnter = this.handleDragEnter.bind(this);
    this._boundHandleDragLeave = this.handleDragLeave.bind(this);
    this._boundHandleDragOver = this.handleDragOver.bind(this);
    this._boundHandleDrop = this.handleDrop.bind(this);

    this.init();
  }

  /**
   * 初始化
   */
  private init(): void {
    if (typeof window === "undefined") {
      return;
    }

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.addEventListener(eventName, this.preventDefaults as EventListener, false);
    });

    document.addEventListener("dragenter", this._boundHandleDragEnter as EventListener, false);
    document.addEventListener("dragleave", this._boundHandleDragLeave as EventListener, false);
    document.addEventListener("dragover", this._boundHandleDragOver as EventListener, false);
    document.addEventListener("drop", this._boundHandleDrop as EventListener, false);
  }

  /**
   * 阻止默认行为
   */
  private preventDefaults(e: Event): void {
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * 处理拖拽进入
   */
  private handleDragEnter(e: DragEvent): void {
    this.dragCounter++;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      this.isDragging.value = true;
    }
  }

  /**
   * 处理拖拽离开
   */
  private handleDragLeave(_e: DragEvent): void {
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragging.value = false;
    }
  }

  /**
   * 处理拖拽悬停
   */
  private handleDragOver(e: DragEvent): void {
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  }

  /**
   * 处理文件放下
   */
  private async handleDrop(e: DragEvent): Promise<void> {
    this.isDragging.value = false;
    this.dragCounter = 0;

    const dt = e.dataTransfer;
    const files = dt?.files;

    if (files && files.length > 0) {
      await this.handleFiles(Array.from(files));
    }
  }

  /**
   * 处理文件
   */
  private async handleFiles(files: File[]): Promise<void> {
    const validFiles = files.filter((file) => this.validateFile(file));

    if (validFiles.length === 0) {
      logger.warn("[DragUpload] No valid files");
      return;
    }

    for (const handler of this.uploadHandlers) {
      try {
        await handler(validFiles);
      } catch (error) {
        logger.error("[DragUpload] Handler error:", error);
      }
    }
  }

  /**
   * 验证文件
   */
  private validateFile(file: File): boolean {
    if (file.size > this.maxFileSize) {
      logger.warn(`[DragUpload] File too large: ${file.name}`);
      return false;
    }

    if (this.allowedTypes.length > 0) {
      const fileType = file.type || "";
      const fileExt = file.name.split(".").pop()?.toLowerCase() || "";

      const isAllowed = this.allowedTypes.some((type) => {
        if (type.startsWith(".")) {
          return fileExt === type.substring(1);
        }
        return fileType.match(type);
      });

      if (!isAllowed) {
        logger.warn(`[DragUpload] File type not allowed: ${file.name}`);
        return false;
      }
    }

    return true;
  }

  /**
   * 注册上传处理器
   */
  onUpload(handler: UploadHandler): () => void {
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
  setAllowedTypes(types: string[]): void {
    this.allowedTypes = types;
  }

  /**
   * 设置最大文件大小
   */
  setMaxFileSize(size: number): void {
    this.maxFileSize = size;
  }

  /**
   * 销毁
   */
  destroy(): void {
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      document.removeEventListener(eventName, this.preventDefaults as EventListener, false);
    });

    document.removeEventListener("dragenter", this._boundHandleDragEnter as EventListener, false);
    document.removeEventListener("dragleave", this._boundHandleDragLeave as EventListener, false);
    document.removeEventListener("dragover", this._boundHandleDragOver as EventListener, false);
    document.removeEventListener("drop", this._boundHandleDrop as EventListener, false);
  }
}

// 创建全局实例
const dragUploadManager = new DragUploadManager();

/**
 * 组合式函数：使用拖拽上传
 */
export function useDragUpload(): UseDragUploadReturn {
  return {
    isDragging: dragUploadManager.isDragging,
    onUpload: (handler: UploadHandler) => dragUploadManager.onUpload(handler),
    setAllowedTypes: (types: string[]) => dragUploadManager.setAllowedTypes(types),
    setMaxFileSize: (size: number) => dragUploadManager.setMaxFileSize(size),
  };
}

export default dragUploadManager;
