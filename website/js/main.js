// ============================================
// ChainlessChain Website JavaScript
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // Initialize all features
    initNavigation();
    initScrollEffects();
    initMobileMenu();
    initFormHandling();
    initAnimations();
});

// ============================================
// Navigation
// ============================================
function initNavigation() {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelectorAll('.nav-link');

    // Navbar scroll effect
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Smooth scroll and active link
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');

            // Only handle hash links
            if (href.startsWith('#')) {
                e.preventDefault();
                const targetId = href.substring(1);
                const targetSection = document.getElementById(targetId);

                if (targetSection) {
                    // Remove active class from all links
                    navLinks.forEach(l => l.classList.remove('active'));

                    // Add active class to clicked link
                    this.classList.add('active');

                    // Smooth scroll to section
                    const navbarHeight = navbar.offsetHeight;
                    const targetPosition = targetSection.offsetTop - navbarHeight;

                    window.scrollTo({
                        top: targetPosition,
                        behavior: 'smooth'
                    });

                    // Close mobile menu if open
                    const navMenu = document.getElementById('navMenu');
                    navMenu.classList.remove('active');
                }
            }
        });
    });

    // Update active link on scroll
    window.addEventListener('scroll', () => {
        let current = '';
        const sections = document.querySelectorAll('section[id]');

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (pageYOffset >= sectionTop - navbar.offsetHeight - 100) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === `#${current}`) {
                link.classList.add('active');
            }
        });
    });
}

// ============================================
// Mobile Menu
// ============================================
function initMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const navMenu = document.getElementById('navMenu');

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            mobileMenuToggle.classList.toggle('active');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!navMenu.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            }
        });

        // Close menu when clicking on a link
        const navLinks = navMenu.querySelectorAll('.nav-link');
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navMenu.classList.remove('active');
                mobileMenuToggle.classList.remove('active');
            });
        });
    }
}

// ============================================
// Scroll Effects
// ============================================
function initScrollEffects() {
    // Intersection Observer for fade-in animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -100px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);

    // Observe all cards and sections
    const animateElements = document.querySelectorAll(
        '.product-card, .feature-item, .scenario-card, .tech-category'
    );

    animateElements.forEach(el => {
        observer.observe(el);
    });
}

// ============================================
// Animations
// ============================================
function initAnimations() {
    // Add scroll-triggered animations
    const style = document.createElement('style');
    style.textContent = `
        .product-card,
        .feature-item,
        .scenario-card,
        .tech-category {
            opacity: 0;
            transform: translateY(30px);
            transition: opacity 0.6s ease, transform 0.6s ease;
        }

        .product-card.visible,
        .feature-item.visible,
        .scenario-card.visible,
        .tech-category.visible {
            opacity: 1;
            transform: translateY(0);
        }

        /* Stagger animation delay */
        .product-card:nth-child(1) { transition-delay: 0.1s; }
        .product-card:nth-child(2) { transition-delay: 0.2s; }
        .product-card:nth-child(3) { transition-delay: 0.3s; }

        .feature-item:nth-child(1) { transition-delay: 0.1s; }
        .feature-item:nth-child(2) { transition-delay: 0.2s; }
        .feature-item:nth-child(3) { transition-delay: 0.3s; }
        .feature-item:nth-child(4) { transition-delay: 0.4s; }
        .feature-item:nth-child(5) { transition-delay: 0.5s; }
        .feature-item:nth-child(6) { transition-delay: 0.6s; }
    `;
    document.head.appendChild(style);
}

// ============================================
// Form Handling
// ============================================
function initFormHandling() {
    const contactForm = document.getElementById('contactForm');

    if (contactForm) {
        contactForm.addEventListener('submit', function(e) {
            e.preventDefault();

            // Get form data
            const formData = new FormData(contactForm);
            const data = Object.fromEntries(formData);

            // Show loading state
            const submitButton = contactForm.querySelector('.btn-submit');
            const originalText = submitButton.textContent;
            submitButton.textContent = '发送中...';
            submitButton.disabled = true;

            // Simulate form submission (replace with actual API call)
            setTimeout(() => {
                // Success
                showNotification('消息已发送！我们会尽快回复您。', 'success');
                contactForm.reset();

                // Reset button
                submitButton.textContent = originalText;
                submitButton.disabled = false;
            }, 1500);
        });
    }
}

// ============================================
// Notification System
// ============================================
function showNotification(message, type = 'success') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // Add styles
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '15px 25px',
        background: type === 'success' ? '#52c41a' : '#ff4d4f',
        color: 'white',
        borderRadius: '10px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        zIndex: '9999',
        animation: 'slideInRight 0.3s ease',
        fontWeight: '500'
    });

    // Add animation keyframes
    if (!document.getElementById('notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Add to body
    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// ============================================
// CTA Button Handlers
// ============================================
document.querySelectorAll('.btn-hero, .btn-product, .btn-primary').forEach(button => {
    button.addEventListener('click', function() {
        if (this.classList.contains('btn-hero') ||
            this.classList.contains('btn-primary')) {
            showNotification('功能即将上线，敬请期待！', 'success');
        }
    });
});

// ============================================
// Statistics Counter Animation
// ============================================
function animateCounter(element, target, duration = 2000) {
    const start = 0;
    const increment = target / (duration / 16); // 60 FPS
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
            current = target;
            clearInterval(timer);
        }
        element.textContent = Math.floor(current);
    }, 16);
}

// Trigger counter animation when stats are visible
const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const statNumbers = entry.target.querySelectorAll('.stat-number');
            statNumbers.forEach(stat => {
                const text = stat.textContent;
                const match = text.match(/\d+/);
                if (match) {
                    const number = parseInt(match[0]);
                    if (!isNaN(number)) {
                        // Store original text
                        const suffix = text.replace(match[0], '');
                        stat.dataset.suffix = suffix;

                        // Animate
                        animateCounter(stat, number);

                        // Add suffix back
                        setTimeout(() => {
                            stat.textContent = number + suffix;
                        }, 2000);
                    }
                }
            });
            statObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

document.querySelectorAll('.hero-stats, .about-stats-card').forEach(el => {
    statObserver.observe(el);
});

// ============================================
// Parallax Effect
// ============================================
window.addEventListener('scroll', () => {
    const scrolled = window.pageYOffset;
    const heroGradient = document.querySelector('.hero-gradient');

    if (heroGradient) {
        heroGradient.style.transform = `translateY(${scrolled * 0.5}px)`;
    }
});

// ============================================
// Tech Tags Hover Effect
// ============================================
document.querySelectorAll('.tech-tag').forEach(tag => {
    tag.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-5px) scale(1.05)';
    });

    tag.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0) scale(1)';
    });
});

// ============================================
// Console Message
// ============================================
console.log(`
%c ChainlessChain
%c 让数据主权回归个人，AI效率触手可及
%c GitHub: https://github.com/chainlesschain
`,
'color: #667eea; font-size: 24px; font-weight: bold;',
'color: #666; font-size: 14px;',
'color: #1890ff; font-size: 12px;'
);
