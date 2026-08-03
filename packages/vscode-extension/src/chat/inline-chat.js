'use strict';
const vscode = require('vscode');

/**
 * ChainlessChain Inline Chat Decorator (MVP Stable)
 *
 * 选中代码后显示浮动工具栏 → 点击快速动作/输入prompt → 自动打开Chat面板并带上选中代码上下文
 * 实现CodeBuddy/Cursor风格的代码选中即操作体验。
 *
 * MVP版本：优先稳定可用，直接复用现有ChatViewProvider处理对话，后续迭代inline diff编辑。
 */

const QUICK_ACTIONS = [
  { id: 'explain', label: '解释', icon: '$(book)', prompt: '请解释这段代码的作用和实现逻辑：\n\n' },
  { id: 'refactor', label: '重构', icon: '$(refresh)', prompt: '请重构这段代码，提升可读性和性能，保持功能不变：\n\n' },
  { id: 'fix', label: '修复问题', icon: '$(bug)', prompt: '请分析并修复这段代码可能存在的问题：\n\n' },
  { id: 'document', label: '生成文档', icon: '$(note)', prompt: '请为这段代码生成详细的JSDoc注释和说明：\n\n' },
  { id: 'test', label: '生成测试', icon: '$(beaker)', prompt: '请为这段代码编写完整的单元测试：\n\n' },
];

class InlineChatDecorator {
  constructor(vscode, opts = {}) {
    this.vscode = vscode;
    this.log = opts.log || console.log;
    this.chatViewProvider = opts.chatViewProvider;

    this._disposables = [];
    this._toolbar = null;
    this._inputPanel = null;
    this._currentEditor = null;
    this._currentSelection = null;
    this._currentCode = '';
    this._decorationType = null;

    this._registerEventListeners();
    this.log('[InlineChat] initialized (MVP stable)');
  }

  _registerEventListeners() {
    // 选区变化时显示/隐藏工具栏
    this._disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor !== vscode.window.activeTextEditor) return;
        this._onSelectionChanged(e.textEditor, e.selections[0]);
      })
    );

    // 编辑器切换时隐藏
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this._hideAll();
      })
    );

    // 滚动时更新位置
    this._disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor === this._currentEditor && this._toolbar) {
          this._updateToolbarPosition();
        }
      })
    );

    // 创建选区高亮装饰
    this._decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
      border: '1px solid',
      borderColor: new vscode.ThemeColor('editor.selectionHighlightBorder'),
      borderRadius: '2px',
    });
    this._disposables.push(this._decorationType);
  }

  _onSelectionChanged(editor, selection) {
    // 忽略空选区或光标点击
    if (!selection || selection.isEmpty) {
      this._hideAll();
      return;
    }

    // 选区太小（小于3个字符）不显示
    const text = editor.document.getText(selection);
    if (text.trim().length < 3) {
      this._hideAll();
      return;
    }

    this._currentEditor = editor;
    this._currentSelection = selection;
    this._currentCode = text;

    // 高亮选中区域
    editor.setDecorations(this._decorationType, [selection]);

    // 显示浮动工具栏
    this._showToolbar(editor, selection);
  }

  _showToolbar(editor, selection) {
    // 销毁旧的
    this._disposeToolbar();

    // 创建Webview面板作为浮动工具栏（使用Overlay方案）
    // MVP: 为了兼容性，使用代码透镜风格的装饰 + 自动命令触发
    // 这里我们用一个更简单可靠的方案：直接在右上角显示快速操作的CodeLens式装饰
    // 创建after内容装饰（行尾显示按钮）
    if (!this._hoverDecorationType) {
      this._hoverDecorationType = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: '',
          color: new vscode.ThemeColor('editorCodeLens.foreground'),
          backgroundColor: new vscode.ThemeColor('editorCodeLens.background'),
          margin: '0 0 0 20px',
          textDecoration: 'none; font-size: 12px; cursor: pointer',
        },
        isWholeLine: true,
      });
      this._disposables.push(this._hoverDecorationType);
    }

    const endLine = selection.end.line;
    const decoration = {
      range: new vscode.Range(endLine, 0, endLine, 0),
      hoverMessage: 'ChainlessChain 内联操作',
      renderOptions: {
        after: {
          contentText: '  ✨ ChainlessChain: ' + QUICK_ACTIONS.map(a => a.label).join(' · ') + ' · 聊天  ',
        }
      }
    };
    editor.setDecorations(this._hoverDecorationType, [decoration]);
  }

  _updateToolbarPosition() {
    // Webview位置更新在MVP中暂不需要
  }

  _hideAll() {
    this._disposeToolbar();
    if (this._decorationType && this._currentEditor) {
      this._currentEditor.setDecorations(this._decorationType, []);
    }
    if (this._hoverDecorationType && this._currentEditor) {
      this._currentEditor.setDecorations(this._hoverDecorationType, []);
    }
    this._currentEditor = null;
    this._currentSelection = null;
    this._currentCode = '';
  }

  _disposeToolbar() {
    if (this._toolbar) {
      this._toolbar.dispose();
      this._toolbar = null;
    }
  }

  /** 显示内联输入框（打开Chat面板并自动填入） */
  async show() {
    await this._submitWithContext('');
  }

  /** 执行预设快速动作 */
  async prompt(actionId) {
    const action = QUICK_ACTIONS.find(a => a.id === actionId);
    if (!action) return;

    let codeBlock = '';
    if (this._currentCode && this._currentEditor) {
      const lang = this._currentEditor.document.languageId || 'code';
      const relPath = vscode.workspace.asRelativePath(this._currentEditor.document.uri);
      codeBlock = `\`\`\`${lang}\n// ${relPath} (lines ${this._currentSelection.start.line + 1}-${this._currentSelection.end.line + 1})\n${this._currentCode}\n\`\`\`\n\n`;
    }

    const fullPrompt = action.prompt + codeBlock;
    await this._submitWithContext(fullPrompt, action.label);
  }

  /** 外部调用快速动作（从右键菜单/命令面板） */
  async executeAction(actionId) {
    // 先获取当前选区
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      this._currentEditor = editor;
      this._currentSelection = editor.selections[0];
      this._currentCode = editor.document.getText(this._currentSelection);
    }
    await this.prompt(actionId);
  }

  async _submitWithContext(promptText, actionLabel) {
    // 先打开Chat面板
    await vscode.commands.executeCommand('chainlesschainIdeChat.focus');

    // 等面板打开后输入内容并发送
    setTimeout(() => {
      try {
        if (this.chatViewProvider && this.chatViewProvider.setInputValue) {
          this.chatViewProvider.setInputValue(promptText, true);
        } else {
          // fallback: 通过命令发送
          vscode.commands.executeCommand('chainlesschain.chat.sendInput', promptText);
        }
        this.log(`[InlineChat] submitted ${actionLabel || 'chat'} request`);
      } catch (e) {
        this.log('[InlineChat] failed to set input:', e);
      }
      this._hideAll();
    }, 300);
  }

  /** 以下方法为接口兼容（MVP暂不实现inline diff） */
  async acceptEdit() { vscode.window.showInformationMessage('Inline diff 功能将在下版本实现'); }
  async rejectEdit() { vscode.window.showInformationMessage('Inline diff 功能将在下版本实现'); }

  /** 设置ChatViewProvider引用 */
  setChatViewProvider(provider) {
    this.chatViewProvider = provider;
  }

  dispose() {
    this._hideAll();
    this._disposables.forEach(d => d.dispose());
    this._disposables = [];
  }
}

module.exports = { InlineChatDecorator, QUICK_ACTIONS };
