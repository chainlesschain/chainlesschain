"""
Git冲突解决器 - AI辅助
使用LLM分析冲突并提供智能解决方案
"""
import os
import re
from typing import Dict, List, Any, Optional
from pathlib import Path


class ConflictResolver:
    """AI驱动的Git冲突解决器"""

    def __init__(self):
        self.llm_client = None
        self._init_llm()

    def _init_llm(self):
        """初始化LLM客户端"""
        try:
            from src.llm.llm_client import get_llm_client
            self.llm_client = get_llm_client()
        except Exception as e:
            print(f"警告: LLM客户端初始化失败: {e}")

    def parse_conflict_markers(self, content: str) -> List[Dict[str, Any]]:
        """
        解析Git冲突标记

        Args:
            content: 包含冲突标记的文件内容

        Returns:
            冲突块列表
        """
        conflicts = []
        lines = content.split('\n')
        i = 0

        while i < len(lines):
            line = lines[i]

            # 检测冲突开始标记
            if line.startswith('<<<<<<<'):
                conflict = {
                    'start_line': i,
                    'current_branch': line.replace('<<<<<<<', '').strip(),
                    'current_content': [],
                    'incoming_content': [],
                    'base_content': []
                }

                i += 1
                # 读取当前分支内容
                while i < len(lines) and not lines[i].startswith('|||||||') and not lines[i].startswith('======='):
                    conflict['current_content'].append(lines[i])
                    i += 1

                # 检查是否有base版本（diff3格式）
                if i < len(lines) and lines[i].startswith('|||||||'):
                    i += 1
                    while i < len(lines) and not lines[i].startswith('======='):
                        conflict['base_content'].append(lines[i])
                        i += 1

                # 跳过分隔符
                if i < len(lines) and lines[i].startswith('======='):
                    i += 1

                # 读取incoming分支内容
                while i < len(lines) and not lines[i].startswith('>>>>>>>'):
                    conflict['incoming_content'].append(lines[i])
                    i += 1

                # 获取incoming分支名
                if i < len(lines) and lines[i].startswith('>>>>>>>'):
                    conflict['incoming_branch'] = lines[i].replace('>>>>>>>', '').strip()
                    conflict['end_line'] = i

                conflicts.append(conflict)

            i += 1

        return conflicts

    async def analyze_conflict(self, conflict: Dict[str, Any], file_path: str, context: str = "") -> Dict[str, Any]:
        """
        使用AI分析单个冲突

        Args:
            conflict: 冲突块信息
            file_path: 文件路径
            context: 额外上下文信息

        Returns:
            分析结果和建议
        """
        current_content = '\n'.join(conflict['current_content'])
        incoming_content = '\n'.join(conflict['incoming_content'])
        base_content = '\n'.join(conflict.get('base_content', []))

        # 构建基础版本部分
        base_section = ''
        if base_content:
            base_section = f"""共同祖先版本:
```
{base_content}
```
"""

        # 构建上下文部分
        context_section = ''
        if context:
            context_section = f"额外上下文:{chr(10)}{context}{chr(10)}"

        prompt = f"""你是一个Git冲突解决专家。请分析以下代码冲突并提供最佳解决方案。

文件路径: {file_path}

当前分支 ({conflict.get('current_branch', 'HEAD')}):
```
{current_content}
```

合并分支 ({conflict.get('incoming_branch', 'MERGE_HEAD')}):
```
{incoming_content}
```

{base_section}
{context_section}
请提供:
1. 冲突原因分析
2. 推荐的解决方案（合并后的完整代码）
3. 解决策略说明（accept_current/accept_incoming/merge_both/custom）
4. 风险提示（如果有）

请以JSON格式返回结果:
{{
    "analysis": "冲突原因分析",
    "strategy": "解决策略",
    "resolved_content": "合并后的代码",
    "risks": ["风险1", "风险2"],
    "confidence": 0.9
}}
"""

        try:
            if self.llm_client:
                response = await self.llm_client.chat_completion(
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.3  # 降低温度以获得更稳定的结果
                )

                # 解析JSON响应
                import json
                result_text = response.get('content', '{}')

                # 提取JSON部分（如果被markdown包裹）
                json_match = re.search(r'```json\s*(.*?)\s*```', result_text, re.DOTALL)
                if json_match:
                    result_text = json_match.group(1)

                result = json.loads(result_text)
                return result
            else:
                # 降级方案：简单的启发式规则
                return self._heuristic_resolve(conflict, file_path)

        except Exception as e:
            print(f"AI分析失败，使用启发式规则: {e}")
            return self._heuristic_resolve(conflict, file_path)

    def _heuristic_resolve(self, conflict: Dict[str, Any], file_path: str) -> Dict[str, Any]:
        """
        启发式冲突解决（当AI不可用时）

        基于简单规则:
        - 如果一方为空，使用另一方
        - 如果两方相似度高，合并
        - 否则保留both
        """
        current = '\n'.join(conflict['current_content'])
        incoming = '\n'.join(conflict['incoming_content'])

        # 规则1: 一方为空
        if not current.strip():
            return {
                'analysis': '当前分支为空，使用incoming分支内容',
                'strategy': 'accept_incoming',
                'resolved_content': incoming,
                'risks': [],
                'confidence': 0.95
            }

        if not incoming.strip():
            return {
                'analysis': 'Incoming分支为空，保留当前分支内容',
                'strategy': 'accept_current',
                'resolved_content': current,
                'risks': [],
                'confidence': 0.95
            }

        # 规则2: 内容完全相同
        if current.strip() == incoming.strip():
            return {
                'analysis': '两个分支内容相同，无需合并',
                'strategy': 'accept_current',
                'resolved_content': current,
                'risks': [],
                'confidence': 1.0
            }

        # 规则3: 默认保留both
        merged = f"{current}\n{incoming}"
        return {
            'analysis': '无法自动判断，建议手动审查',
            'strategy': 'merge_both',
            'resolved_content': merged,
            'risks': ['需要手动审查合并结果', '可能存在重复或冲突逻辑'],
            'confidence': 0.3
        }

    async def resolve_file_conflicts(
        self,
        file_path: str,
        auto_resolve: bool = False,
        strategy: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        解决单个文件的所有冲突

        Args:
            file_path: 文件路径
            auto_resolve: 是否自动应用解决方案
            strategy: 强制使用的策略（accept_current/accept_incoming/merge_both）

        Returns:
            解决结果
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"文件不存在: {file_path}")

        # 读取文件内容
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # 检测是否有冲突
        if '<<<<<<<' not in content:
            return {
                'success': True,
                'message': '文件无冲突',
                'conflicts_count': 0
            }

        # 解析冲突
        conflicts = self.parse_conflict_markers(content)

        # 分析每个冲突
        resolutions = []
        for conflict in conflicts:
            if strategy:
                # 使用指定策略
                resolution = self._apply_strategy(conflict, strategy)
            else:
                # AI分析
                resolution = await self.analyze_conflict(conflict, file_path)

            resolutions.append(resolution)

        # 构建解决后的内容
        resolved_content = content
        lines = content.split('\n')

        # 从后往前替换（避免行号变化）
        for i in range(len(conflicts) - 1, -1, -1):
            conflict = conflicts[i]
            resolution = resolutions[i]

            start = conflict['start_line']
            end = conflict['end_line']

            # 替换冲突块
            new_lines = lines[:start] + resolution['resolved_content'].split('\n') + lines[end+1:]
            lines = new_lines

        resolved_content = '\n'.join(lines)

        # 如果auto_resolve，写回文件
        if auto_resolve:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(resolved_content)

        return {
            'success': True,
            'file_path': file_path,
            'conflicts_count': len(conflicts),
            'resolutions': resolutions,
            'resolved_content': resolved_content,
            'auto_applied': auto_resolve,
            'average_confidence': sum(r['confidence'] for r in resolutions) / len(resolutions) if resolutions else 0
        }

    def _apply_strategy(self, conflict: Dict[str, Any], strategy: str) -> Dict[str, Any]:
        """应用指定的解决策略"""
        if strategy == 'accept_current':
            content = '\n'.join(conflict['current_content'])
        elif strategy == 'accept_incoming':
            content = '\n'.join(conflict['incoming_content'])
        elif strategy == 'merge_both':
            current = '\n'.join(conflict['current_content'])
            incoming = '\n'.join(conflict['incoming_content'])
            content = f"{current}\n{incoming}"
        else:
            raise ValueError(f"未知策略: {strategy}")

        return {
            'analysis': f'使用策略: {strategy}',
            'strategy': strategy,
            'resolved_content': content,
            'risks': [] if strategy != 'merge_both' else ['未经AI分析，可能需要手动审查'],
            'confidence': 0.8
        }

    async def resolve_repository_conflicts(
        self,
        repo_path: str,
        auto_resolve: bool = False,
        strategy: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        解决整个仓库的冲突

        Args:
            repo_path: 仓库路径
            auto_resolve: 是否自动应用
            strategy: 强制策略

        Returns:
            解决结果汇总
        """
        try:
            from git import Repo
            repo = Repo(repo_path)
        except Exception as e:
            raise RuntimeError(f"无法打开仓库: {e}")

        # 获取冲突文件列表
        conflicted_files = []
        try:
            # 获取未合并的路径
            unmerged = repo.index.unmerged_blobs()
            conflicted_files = list(unmerged.keys())
        except:
            # 备选方案：检查status
            import subprocess
            result = subprocess.run(
                ['git', 'diff', '--name-only', '--diff-filter=U'],
                cwd=repo_path,
                capture_output=True,
                text=True
            )
            conflicted_files = result.stdout.strip().split('\n') if result.stdout.strip() else []

        if not conflicted_files:
            return {
                'success': True,
                'message': '没有冲突文件',
                'files_processed': 0
            }

        # 解决每个文件
        results = []
        total_conflicts = 0

        for rel_path in conflicted_files:
            file_path = os.path.join(repo_path, rel_path)
            try:
                result = await self.resolve_file_conflicts(file_path, auto_resolve, strategy)
                results.append(result)
                total_conflicts += result['conflicts_count']
            except Exception as e:
                results.append({
                    'success': False,
                    'file_path': rel_path,
                    'error': str(e)
                })

        successful = sum(1 for r in results if r.get('success'))

        return {
            'success': successful == len(conflicted_files),
            'repo_path': repo_path,
            'files_processed': len(conflicted_files),
            'files_resolved': successful,
            'total_conflicts': total_conflicts,
            'results': results,
            'auto_applied': auto_resolve
        }
