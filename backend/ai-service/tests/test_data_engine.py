"""
DataEngine 可视化测试。

重点：空 / 缺失 / 非 list 的 chart_types 不应让 _create_visualizations 崩溃
（此前显式 "chart_types": [] → num_charts=0 → plt.subplots(1, 0) 抛 ValueError）。

依赖 pandas/matplotlib/seaborn/openpyxl（requirements.txt 已声明，CI 安装）；
本地缺失这些重依赖时整体跳过，不影响轻量套件。
"""
import asyncio
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


def test_sample_data_string_row_count_does_not_crash(engine):
    # row_count 若被模型以 JSON 字符串返回，旧实现 min("100", 10) 抛 TypeError
    spec = {"columns": [{"name": "c", "type": "string"}], "row_count": "100"}
    df = asyncio.run(engine._generate_sample_data(spec))
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 10  # 安全强转后被夹到上限 10


def test_sample_data_negative_row_count_does_not_crash(engine):
    # 负数 row_count 旧实现会让 np.random.randint(size=-5) / date_range(periods=-5) 抛 ValueError
    spec = {"columns": [{"name": "n", "type": "number"}], "row_count": -5}
    df = asyncio.run(engine._generate_sample_data(spec))
    assert isinstance(df, pd.DataFrame)
    assert len(df) == 0  # 夹到 0 → 空表，不崩
