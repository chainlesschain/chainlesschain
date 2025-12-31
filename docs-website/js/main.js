/**
 * ChainlessChain 官网交互脚本
 *
 * 功能：
 * - 导航栏滚动效果
 * - 移动端菜单切换
 * - 平滑滚动
 * - FAQ 展开/收起
 * - 表单验证和提交
 * - 页面加载动画
 */

(function() {
    'use strict';

    // ========================================
    // 导航栏滚动效果
    // ========================================
    const navbar = document.getElementById('navbar');
    let lastScrollTop = 0;

    window.addEventListener('scroll', function() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // 添加滚动后的阴影效果
        if (scrollTop > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        // 向下滚动时隐藏导航栏，向上滚动时显示
        if (scrollTop > lastScrollTop && scrollTop > 100) {
            navbar.style.transform = 'translateY(-100%)';
        } else {
            navbar.style.transform = 'translateY(0)';
        }

        lastScrollTop = scrollTop;
    });

    // ========================================
    // 移动端菜单切换
    // ========================================
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navMenu = document.getElementById('navMenu');

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
        });
    }

    // 点击菜单项后关闭移动端菜单
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        });
    });

    // ========================================
    // 平滑滚动
    // ========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');

            // 忽略 href="#" 的链接
            if (href === '#') {
                return;
            }

            e.preventDefault();

            const target = document.querySelector(href);
            if (target) {
                const offsetTop = target.offsetTop - 80; // 考虑导航栏高度
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });

    // 导航栏高亮当前section
    const sections = document.querySelectorAll('section[id]');

    window.addEventListener('scroll', () => {
        const scrollY = window.pageYOffset;

        sections.forEach(section => {
            const sectionHeight = section.offsetHeight;
            const sectionTop = section.offsetTop - 100;
            const sectionId = section.getAttribute('id');
            const navLink = document.querySelector(`.nav-link[href="#${sectionId}"]`);

            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                navLinks.forEach(link => link.classList.remove('active'));
                if (navLink) {
                    navLink.classList.add('active');
                }
            }
        });
    });

    // ========================================
    // FAQ 展开/收起（可选）
    // ========================================
    const faqItems = document.querySelectorAll('.faq-item');

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');

        // 默认显示所有答案，如需折叠效果可以取消注释以下代码
        /*
        answer.style.maxHeight = '0';
        answer.style.overflow = 'hidden';
        answer.style.transition = 'max-height 0.3s ease';

        question.style.cursor = 'pointer';
        question.addEventListener('click', () => {
            const isOpen = answer.style.maxHeight !== '0px';

            if (isOpen) {
                answer.style.maxHeight = '0';
            } else {
                answer.style.maxHeight = answer.scrollHeight + 'px';
            }
        });
        */
    });

    // ========================================
    // 表单验证和提交
    // ========================================
    const contactForm = document.getElementById('contactForm');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            // 获取表单数据
            const formData = new FormData(contactForm);
            const data = {
                name: formData.get('name'),
                phone: formData.get('phone'),
                email: formData.get('email'),
                message: formData.get('message')
            };

            // 简单验证
            if (!data.name || !data.phone || !data.message) {
                alert('请填写必填项');
                return;
            }

            // 电话号码验证
            const phoneRegex = /^1[3-9]\d{9}$/;
            if (!phoneRegex.test(data.phone)) {
                alert('请输入有效的手机号码');
                return;
            }

            // 邮箱验证（如果填写了）
            if (data.email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(data.email)) {
                    alert('请输入有效的邮箱地址');
                    return;
                }
            }

            // 这里应该发送到后端API
            // 目前只是模拟提交
            console.log('表单数据：', data);

            // TODO: 替换为实际的API调用
            /*
            fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            })
            .then(response => response.json())
            .then(result => {
                alert('感谢您的咨询！我们将在1个工作日内与您联系。');
                contactForm.reset();
            })
            .catch(error => {
                console.error('提交失败：', error);
                alert('提交失败，请稍后重试或直接拨打 400-1068-687');
            });
            */

            // 临时模拟成功
            alert('感谢您的咨询！我们将在1个工作日内与您联系。');
            contactForm.reset();
        });
    }

    // ========================================
    // 页面加载动画
    // ========================================
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // 观察需要动画的元素
    document.querySelectorAll('.feature-item, .product-card, .scenario-card, .value-item').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // 为可见元素添加样式
    const style = document.createElement('style');
    style.textContent = `
        .visible {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);

    // ========================================
    // 操作系统检测（用于下载页面）
    // ========================================
    function detectOS() {
        const userAgent = navigator.userAgent.toLowerCase();
        let os = 'Unknown';

        if (userAgent.indexOf('win') > -1) {
            os = 'Windows';
        } else if (userAgent.indexOf('mac') > -1) {
            os = 'macOS';
        } else if (userAgent.indexOf('linux') > -1) {
            os = 'Linux';
        } else if (userAgent.indexOf('android') > -1) {
            os = 'Android';
        } else if (userAgent.indexOf('iphone') > -1 || userAgent.indexOf('ipad') > -1) {
            os = 'iOS';
        }

        const osElement = document.getElementById('detectedOS');
        if (osElement) {
            osElement.textContent = os;
        }

        return os;
    }

    // 页面加载时检测OS
    detectOS();

    // ========================================
    // 工具函数
    // ========================================

    // 滚动到下载区域
    window.scrollToDownload = function() {
        const downloadSection = document.getElementById('download');
        if (downloadSection) {
            const offsetTop = downloadSection.offsetTop - 80;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    };

    // 联系我们
    window.contact = function(product) {
        const contactSection = document.getElementById('contact');
        if (contactSection) {
            const offsetTop = contactSection.offsetTop - 80;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }

        // 可以根据产品类型预填充表单消息
        const messageField = document.getElementById('message');
        if (messageField && product) {
            const messages = {
                'knowledge-base': '我对个人AI知识库产品感兴趣，希望了解更多详情。',
                'social': '我对去中心化AI社交产品感兴趣，希望了解更多详情。',
                'trading': '我对AI辅助交易产品感兴趣，希望预约演示。'
            };
            messageField.value = messages[product] || '';
        }
    };

    // 了解更多
    window.learnMore = function(product) {
        // TODO: 跳转到产品详情页面
        console.log('了解更多：', product);
        alert('产品详情页面开发中，敬请期待！\n您可以先下载试用或联系我们了解详情。');
    };

    // 观看演示
    window.openDemo = function() {
        console.log('打开演示视频');
        window.location.href = 'demo.html';
    };

    // 通知我
    window.notifyMe = function(platform) {
        const email = prompt(`请输入您的邮箱，我们将在${platform}版本上线时通知您：`);
        if (email) {
            // 验证邮箱
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                alert('请输入有效的邮箱地址');
                return;
            }

            // TODO: 保存到后端数据库
            console.log('订阅通知：', { platform, email });

            // 临时模拟成功
            alert('谢谢！我们会在上线时第一时间通知您。');
        }
    };

    // 快速下载
    window.downloadForOS = function() {
        const os = detectOS();

        // 根据操作系统跳转到对应下载链接
        const downloadLinks = {
            'Windows': 'https://github.com/chainlesschain/chainlesschain/releases/latest',
            'macOS': 'https://github.com/chainlesschain/chainlesschain/releases/latest',
            'Linux': 'https://github.com/chainlesschain/chainlesschain/releases/latest',
            'Android': 'https://github.com/chainlesschain/chainlesschain/releases/latest'
        };

        const link = downloadLinks[os] || 'https://github.com/chainlesschain/chainlesschain/releases/latest';
        window.open(link, '_blank');
    };

    // 下载跟踪
    window.trackDownload = function(platform) {
        console.log('下载：', platform);
        // 这里可以集成Google Analytics或其他统计工具
    };

    // ========================================
    // 性能优化：懒加载图片
    // ========================================
    const lazyImages = document.querySelectorAll('img[loading="lazy"]');

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    img.src = img.dataset.src || img.src;
                    img.classList.add('loaded');
                    imageObserver.unobserve(img);
                }
            });
        });

        lazyImages.forEach(img => imageObserver.observe(img));
    } else {
        // Fallback for browsers that don't support IntersectionObserver
        lazyImages.forEach(img => {
            img.src = img.dataset.src || img.src;
        });
    }

    // ========================================
    // 返回顶部按钮（可选）
    // ========================================
    const backToTopButton = document.createElement('button');
    backToTopButton.innerHTML = '↑';
    backToTopButton.className = 'back-to-top';
    backToTopButton.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        border: none;
        font-size: 24px;
        cursor: pointer;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        z-index: 999;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    `;

    document.body.appendChild(backToTopButton);

    window.addEventListener('scroll', () => {
        if (window.pageYOffset > 300) {
            backToTopButton.style.opacity = '1';
            backToTopButton.style.visibility = 'visible';
        } else {
            backToTopButton.style.opacity = '0';
            backToTopButton.style.visibility = 'hidden';
        }
    });

    backToTopButton.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    backToTopButton.addEventListener('mouseenter', () => {
        backToTopButton.style.transform = 'scale(1.1)';
    });

    backToTopButton.addEventListener('mouseleave', () => {
        backToTopButton.style.transform = 'scale(1)';
    });

    // ========================================
    // ========================================
    // 导航下拉菜单交互（桌面端）
    // ========================================
    const navDropdowns = document.querySelectorAll('.nav-dropdown');

    // 桌面端：鼠标悬停显示下拉菜单
    if (window.innerWidth > 768) {
        navDropdowns.forEach(dropdown => {
            const dropdownMenu = dropdown.querySelector('.dropdown-menu');

            if (dropdownMenu) {
                // 鼠标进入下拉菜单区域时保持显示
                dropdown.addEventListener('mouseenter', function() {
                    dropdownMenu.style.opacity = '1';
                    dropdownMenu.style.visibility = 'visible';
                    dropdownMenu.style.transform = 'translateX(-50%) translateY(0)';
                });

                dropdown.addEventListener('mouseleave', function() {
                    dropdownMenu.style.opacity = '0';
                    dropdownMenu.style.visibility = 'hidden';
                    dropdownMenu.style.transform = 'translateX(-50%) translateY(10px)';
                });
            }
        });
    }

    // 移动端：点击切换下拉菜单
    if (window.innerWidth <= 768) {
        navDropdowns.forEach(dropdown => {
            const navLink = dropdown.querySelector('.nav-link');
            const dropdownMenu = dropdown.querySelector('.dropdown-menu');

            if (navLink && dropdownMenu) {
                // 默认隐藏下拉菜单
                dropdownMenu.style.display = 'none';

                navLink.addEventListener('click', function(e) {
                    e.preventDefault();

                    // 切换当前下拉菜单
                    const isVisible = dropdownMenu.style.display === 'block';

                    // 关闭所有其他下拉菜单
                    navDropdowns.forEach(otherDropdown => {
                        const otherMenu = otherDropdown.querySelector('.dropdown-menu');
                        if (otherMenu) {
                            otherMenu.style.display = 'none';
                        }
                    });

                    // 切换当前菜单
                    dropdownMenu.style.display = isVisible ? 'none' : 'block';
                });
            }
        });
    }

    // 窗口大小改变时重新初始化下拉菜单
    let resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            // 不重新加载页面,只重新调整菜单状态
            const dropdownMenus = document.querySelectorAll('.dropdown-menu');
            dropdownMenus.forEach(menu => {
                menu.style.display = '';
                menu.style.opacity = '';
                menu.style.visibility = '';
            });
        }, 250);
    });

    // ========================================
    // 版本对比卡片交互增强
    // ========================================
    const versionCards = document.querySelectorAll('.version-card');

    versionCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            // 可以添加额外的交互效果
            this.style.boxShadow = '0 16px 40px rgba(0, 0, 0, 0.2)';
        });

        card.addEventListener('mouseleave', function() {
            const isHighlight = this.classList.contains('highlight');
            if (isHighlight) {
                this.style.boxShadow = '0 12px 32px rgba(0, 0, 0, 0.15)';
            } else {
                this.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.12)';
            }
        });
    });

    // ========================================
    // 统计数字动画效果
    // ========================================
    const statNumbers = document.querySelectorAll('.stat-number');

    const animateNumber = (element) => {
        const target = element.textContent.trim();
        const hasPlus = target.includes('+');
        const numericValue = parseInt(target.replace(/[^0-9]/g, ''));

        if (isNaN(numericValue)) return;

        const duration = 2000; // 2秒动画
        const steps = 60;
        const increment = numericValue / steps;
        let current = 0;

        const timer = setInterval(() => {
            current += increment;
            if (current >= numericValue) {
                current = numericValue;
                clearInterval(timer);
            }

            let displayValue = Math.floor(current).toLocaleString();
            if (hasPlus) displayValue += '+';
            if (target.includes('%')) displayValue += '%';

            element.textContent = displayValue;
        }, duration / steps);
    };

    // 使用Intersection Observer在数字进入视口时触发动画
    const numberObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.dataset.animated) {
                entry.target.dataset.animated = 'true';
                setTimeout(() => animateNumber(entry.target), 200);
                numberObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.5
    });

    statNumbers.forEach(num => numberObserver.observe(num));

    // ========================================
    // AI引擎卡片悬停效果增强
    // ========================================
    const engineItems = document.querySelectorAll('.engine-item');

    engineItems.forEach(item => {
        item.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px) scale(1.05)';
        });

        item.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0) scale(1)';
        });
    });

    // ========================================
    // 技术文档卡片点击跟踪
    // ========================================
    const docLinks = document.querySelectorAll('.doc-link-card, .repo-link');

    docLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const title = this.querySelector('.doc-title')?.textContent ||
                         this.textContent.trim();
            console.log('文档链接点击:', title);
            // 这里可以集成Google Analytics或其他统计工具
            // gtag('event', 'doc_click', { 'doc_name': title });
        });
    });

    // ========================================
    // 平滑滚动到企业版板块
    // ========================================
    window.scrollToEnterprise = function() {
        const enterpriseSection = document.querySelector('.enterprise-spotlight');
        if (enterpriseSection) {
            const offsetTop = enterpriseSection.offsetTop - 80;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    };

    // ========================================
    // 平滑滚动到技术透明度板块
    // ========================================
    window.scrollToTechDocs = function() {
        const techSection = document.querySelector('.tech-transparency');
        if (techSection) {
            const offsetTop = techSection.offsetTop - 80;
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    };

    // ========================================
    // 控制台输出
    // ========================================
    console.log('%c ChainlessChain ', 'background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 8px 16px; border-radius: 4px; font-size: 16px; font-weight: bold;');
    console.log('%c 让数据主权回归个人，AI效率触手可及 ', 'color: #667eea; font-size: 14px;');
    console.log('%c GitHub: https://github.com/chainlesschain ', 'color: #666; font-size: 12px;');
    console.log('%c 官网改版第三阶段完成 - CSS样式和JavaScript交互已优化 ', 'color: #52c41a; font-size: 12px; font-weight: bold;');

})();
