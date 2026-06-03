/**
 * ChainlessChain 页面加载动画控制器
 */

(function() {
    'use strict';

    // 加载进度模拟
    let progress = 0;
    let progressInterval = null;

    /**
     * 初始化加载器
     */
    function initLoader() {
        const loader = document.getElementById('page-loader');
        const progressBar = document.querySelector('.loader-progress-bar');

        if (!loader || !progressBar) {
            console.warn('[Loader] 加载器元素未找到');
            return;
        }

        // 模拟加载进度
        progressInterval = setInterval(function() {
            if (progress < 90) {
                // 前90%快速增长
                progress += Math.random() * 15;
                if (progress > 90) progress = 90;
                updateProgress(progress);
            }
        }, 200);

        // 监听页面加载完成
        if (document.readyState === 'complete') {
            completeLoading();
        } else {
            window.addEventListener('load', completeLoading);
        }

        // 超时保护：最多显示5秒
        setTimeout(function() {
            if (progress < 100) {
                completeLoading();
            }
        }, 5000);
    }

    /**
     * 更新进度条
     */
    function updateProgress(value) {
        const progressBar = document.querySelector('.loader-progress-bar');
        if (progressBar) {
            progressBar.style.width = value + '%';
        }
    }

    /**
     * 完成加载
     */
    function completeLoading() {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }

        // 快速完成到100%
        progress = 100;
        updateProgress(100);

        // 延迟隐藏加载器
        setTimeout(function() {
            hideLoader();
        }, 300);
    }

    /**
     * 隐藏加载器
     */
    function hideLoader() {
        const loader = document.getElementById('page-loader');
        if (loader) {
            loader.classList.add('loaded');

            // 完全移除元素（节省内存）
            setTimeout(function() {
                if (loader.parentNode) {
                    loader.parentNode.removeChild(loader);
                }
            }, 500);
        }
    }

    /**
     * 显示加载器（用于SPA页面切换）
     */
    function showLoader() {
        const loader = document.getElementById('page-loader');
        if (loader) {
            loader.classList.remove('loaded');
            progress = 0;
            updateProgress(0);
        }
    }

    // 页面DOM加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLoader);
    } else {
        initLoader();
    }

    // 暴露全局方法（可选）
    window.ChainlessChainLoader = {
        show: showLoader,
        hide: hideLoader,
        updateProgress: updateProgress
    };

})();
