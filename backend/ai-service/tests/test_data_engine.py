"""
DataEngine 可视化测试。

重点：空 / 缺失 / 非 list 的 chart_types 不应让 _create_visualizations 崩溃
（此前显式 "chart_types": [] → num_charts=0 → plt.subplots(1, 0) 抛 ValueError）。

依赖 pandas/matplotlib/seaborn/openpyxl（requirements.txt 已声明，CI 安装）；
本地缺失这些重依赖时整体跳过，不影响轻量套件。
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# data_engine 的硬依赖；任一缺失则跳过本模块（保持本地轻量可跑）。
pytest.importorskip("pandas")
pytest.importorskip("matplotlib")
pytest.importorskip("seaborn")
pytest.importorskip("openpyxl")

import pandas as pd  # noqa: E402
from src.engines.data_engine import DataEngine  # noqa: E402


@pytest.fixture
def engine():
    return DataEngine()


@pytest.fixture
def sample_df():
    return pd.DataFrame({"name": ["a", "b", "c"], "value": [1, 2, 3]})


def test_visualizations_empty_chart_types_does_not_crash(engine, sample_df):
    # 显式空列表此前触发 plt.subplots(1, 0) → ValueError
    out = engine._create_visualizations(sample_df, {"chart_types": []})
    assert isinstance(out, (bytes, bytearray))
    assert len(out) > 0


def test_visualizations_missing_chart_types_defaults_to_bar(engine, sample_df):
    out = engine._create_visualizations(sample_df, {})
    assert isinstance(out, (bytes, bytearray))
    assert len(out) > 0


def test_visualizations_non_list_chart_types_coerced(engine, sample_df):
    # 模型若误返字符串而非列表，也不应崩
    out = engine._create_visualizations(sample_df, {"chart_types": "bar"})
    assert isinstance(out, (bytes, bytearray))
    assert len(out) > 0
