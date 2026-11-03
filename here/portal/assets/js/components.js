/**
 * Hormuud Salaam Foundation - UI Components
 * Shared sidebar and navbar components.
 */

const PORTAL_THEME_KEY = 'portal-theme';

(function applySavedPortalTheme() {
    try {
        const saved = localStorage.getItem(PORTAL_THEME_KEY);
        if (saved === 'dark' || saved === 'light') {
            document.documentElement.setAttribute('data-theme', saved);
        }
    } catch (e) { /* ignore */ }
})();

function setPortalTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem(PORTAL_THEME_KEY, next);
    } catch (e) { /* ignore */ }
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.innerHTML = next === 'dark'
            ? '<i class="fa-solid fa-sun"></i>'
            : '<i class="fa-solid fa-moon"></i>';
    }
}

const Components = {
    init: function(config) {
        // SECURITY GUARD: Ensure only authorized members can initialize portal components
        let cu = {};
        try {
            cu = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
        } catch(e) {}
        
        if (!cu.id || cu.role === 'Public User') {
            console.warn('Unauthorized access attempt blocked.');
            localStorage.removeItem('hsf_current_user');
            // Determine path to login (usually ../../login.html or ../login.html)
            const depth = window.location.pathname.split('/').length - 1;
            const prefix = depth >= 4 ? "../../../" : depth >= 3 ? "../../" : depth >= 2 ? "../" : "";
            window.location.href = prefix + "login.html";
            return;
        }

        this.config = config;
        this.renderSidebar();
        this.renderNavbar();
        this.renderFooter();
        this.setupMobileToggle();
    },

    renderSidebar: function() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        const role = this.config.role || 'student';
        const activePage = this.config.activePage || 'dashboard';

        let menuItems = [];
        const findPhotosItem = { id: 'find-photos', label: 'Find My Photos', icon: 'fa-camera', path: '../student/find-my-photos.html' };
        const myPhotosItem = { id: 'my-photos', label: 'My Photos', icon: 'fa-images', path: '../student/my-photos.html' };

        // 1. Main Member Leader (Gadoomiye)
        if (role === 'main-leader' || role === 'Main Leader') {
            menuItems = [
                { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie', path: '../main-leader/dashboard.html' },
                { id: 'students', label: 'Members', icon: 'fa-users', path: '../main-leader/students.html' },
                { id: 'quran-contest', label: 'Quran Contest', icon: 'fa-book-quran', path: '../main-leader/quran-contest.html' },
                { id: 'summer-courses', label: 'Summer Courses', icon: 'fa-sun', path: '../main-leader/summer-courses.html' },
                { id: 'member-help', label: 'Messages', icon: 'fa-envelope', path: '../main-leader/member-help.html' },
                { id: 'meetings', label: 'Meetings', icon: 'fa-calendar-check', path: '../main-leader/meetings.html' },
                { id: 'payments', label: 'Payments', icon: 'fa-money-check-dollar', path: '../main-leader/payments.html' },
                { id: 'media', label: 'Media', icon: 'fa-images', path: '../media-admin/dashboard.html' },
                findPhotosItem,
                myPhotosItem,
                { id: 'reports', label: 'Reports', icon: 'fa-file-invoice', path: '../main-leader/reports.html' },
                { id: 'broadcast', label: 'Broadcasting', icon: 'fa-paper-plane', path: '../main-leader/broadcast.html' },
                { id: 'profile', label: 'Profile', icon: 'fa-user', path: '../main-leader/profile.html' },
                { id: 'settings', label: 'Settings', icon: 'fa-gear', path: '../main-leader/settings.html' }
            ];
        // 1b. Media Admin (event photos)
        } else if (role === 'Media Admin') {
            menuItems = [
                { id: 'dashboard', label: 'Media Gallery', icon: 'fa-images', path: '../media-admin/dashboard.html' },
                findPhotosItem,
                myPhotosItem,
                { id: 'profile', label: 'Profile', icon: 'fa-user', path: '../media-admin/profile.html' },
                { id: 'settings', label: 'Settings', icon: 'fa-gear', path: '../media-admin/settings.html' }
            ];
        // 2. Main Payments Admin (Saamiyo)
        } else if (role === 'Payment Admin' || role === 'payment-admin' || role === 'payment-leader') {
            menuItems = [
                { id: 'dashboard', label: 'Payment Admin Home', icon: 'fa-money-check-dollar', path: '../payment-leader/dashboard.html' },
                findPhotosItem,
                myPhotosItem,
                { id: 'reports', label: 'Reports', icon: 'fa-file-invoice', path: '../payment-leader/reports.html' },
                { id: 'broadcast', label: 'Broadcasting', icon: 'fa-paper-plane', path: '../payment-leader/broadcast.html' },
                { id: 'profile', label: 'Profile', icon: 'fa-user', path: '../payment-leader/profile.html' },
                { id: 'settings', label: 'Settings', icon: 'fa-gear', path: '../payment-leader/settings.html' }
            ];
        // 3. Convocation Leader / Collector (Now combined)
        } else if (role === 'Payment Sub Admin' || role === 'Leader' || role === 'convocation-leader') {
            menuItems = [
                { id: 'dashboard', label: 'Collector Home', icon: 'fa-house-chimney', path: '../convocation-leader/dashboard.html' },
                { id: 'members', label: 'My Convocation', icon: 'fa-users', path: '../convocation-leader/members.html' },
                findPhotosItem,
                myPhotosItem,
                { id: 'reports', label: 'Reports', icon: 'fa-file-invoice', path: '../payment-leader/reports.html' },
                { id: 'broadcast', label: 'Payment Reminders', icon: 'fa-paper-plane', path: '../convocation-leader/broadcast.html' },
                { id: 'profile', label: 'Profile', icon: 'fa-user', path: '../convocation-leader/profile.html' },
                { id: 'settings', label: 'Settings', icon: 'fa-gear', path: '../convocation-leader/settings.html' }
            ];
        // 4. Member
        } else {
            menuItems = [
                { id: 'dashboard', label: 'Dashboard', icon: 'fa-house-user', path: '../student/dashboard.html' },
                findPhotosItem,
                myPhotosItem,
                { id: 'settings', label: 'Settings', icon: 'fa-gear', path: '../student/settings.html' }
            ];
        }

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <img src="../../img/logo.svg" alt="Logo" style="width: 50px; height: 50px; object-fit: cover; border-radius: 50%; background-color: white; padding: 2px;">
                <span>HSF SYSTEM</span>
            </div>
            <ul class="sidebar-menu">
                ${menuItems.map(item => `
                    <li class="menu-item">
                        <a href="${item.path}" class="menu-link ${activePage === item.id ? 'active' : ''}">
                            <i class="fa-solid ${item.icon}"></i>
                            <span>${item.label}</span>
                        </a>
                    </li>
                `).join('')}
                <li class="menu-item logout">
                    <a href="../../login.html" class="menu-link" onclick="localStorage.removeItem('hsf_current_user')">
                        <i class="fa-solid fa-right-from-bracket"></i>
                        <span>Logout</span>
                    </a>
                </li>
                ${(role === 'main-leader' || role === 'Main Leader') ? `
                <li class="menu-item" style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 10px; padding-top: 10px;">
                    <a href="../../../admin.html" class="menu-link portal-public-admin-link" style="color: #34d399;">
                        <i class="fa-solid fa-shield-halved"></i>
                        <span>Public Admin Panel</span>
                    </a>
                </li>` : ''}
                <li class="menu-item">
                    <a href="../../../index.html" class="menu-link" style="color: #60a5fa;">
                        <i class="fa-solid fa-globe"></i>
                        <span>Visit Public Site</span>
                    </a>
                </li>
            </ul>
        `;
    },
    renderNavbar: function() {
        const navbar = document.getElementById('top-navbar');
        if (!navbar) return;

        let cu = {};
        try {
            cu = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
        } catch(e) {}

        const title = this.config.title || this.config.pageTitle || 'Dashboard';
        const userName = this.config.userName || cu.name || 'User';
        const roleSource = this.config.userRoleLabel || cu.role || 'Member';
        const userRoleLabel = typeof displayRole === 'function'
            ? displayRole(roleSource)
            : roleSource;

        const avatarUrl = getProfilePicUrl(cu);

        navbar.innerHTML = `
            <div class="d-flex align-center">
                <button class="mobile-toggle" id="mobile-toggle"><i class="fa-solid fa-bars"></i></button>
                <h2 class="page-title">${title}</h2>
            </div>
            <div class="nav-right d-flex align-center">
                <div class="notifications-wrap" id="notifications-wrap">
                    <button type="button" class="notifications-btn" id="notifications-btn" title="Notifications" aria-label="Notifications">
                        <i class="fa-solid fa-bell"></i>
                        <span class="notifications-badge" id="notifications-badge" style="display:none;">0</span>
                    </button>
                    <div class="notifications-panel" id="notifications-panel" aria-hidden="true">
                        <div class="notifications-panel-head">
                            <strong>Notifications</strong>
                            <button type="button" class="notifications-mark-all" id="notifications-mark-all">Mark all read</button>
                        </div>
                        <div class="notifications-list" id="notifications-list">
                            <p class="notifications-empty">No notifications yet.</p>
                        </div>
                    </div>
                </div>
                <div class="theme-toggle" id="theme-toggle" title="Toggle Dark/Light Mode">
                    <i class="fa-solid fa-moon"></i>
                </div>
                <div class="nav-user">
                    <div class="user-info text-right" style="margin-right: 12px; text-align: right;">
                        <h5 style="margin: 0;">${userName}</h5>
                        <p style="margin: 0; font-size: 0.75rem; color: var(--text-muted);">${userRoleLabel}</p>
                    </div>
                    <img src="${avatarUrl}" class="user-avatar" alt="User" style="object-fit: cover;">
                </div>
            </div>
        `;

        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            themeToggle.innerHTML = currentTheme === 'dark'
                ? '<i class="fa-solid fa-sun"></i>'
                : '<i class="fa-solid fa-moon"></i>';
            themeToggle.onclick = () => {
                const active = document.documentElement.getAttribute('data-theme') || 'light';
                setPortalTheme(active === 'dark' ? 'light' : 'dark');
            };
        }

        this.setupNotifications(cu);
    },

    setupNotifications: function(currentUser) {
        const btn = document.getElementById('notifications-btn');
        const panel = document.getElementById('notifications-panel');
        const list = document.getElementById('notifications-list');
        const badge = document.getElementById('notifications-badge');
        const markAll = document.getElementById('notifications-mark-all');
        if (!btn || !panel || !currentUser?.id) return;

        const renderList = (items) => {
            if (!items || !items.length) {
                list.innerHTML = '<p class="notifications-empty">No notifications yet.</p>';
                return;
            }
            list.innerHTML = items.map(n => {
                const body = escapeNotifHtml(n.body || '').replace(/\n/g, '<br>');
                return `
                <div class="notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
                    <div class="notification-title">${escapeNotifHtml(n.title)}</div>
                    <div class="notification-body">${body}</div>
                    <div class="notification-time">${formatNotifTime(n.created_at)}</div>
                </div>`;
            }).join('');
            list.querySelectorAll('.notification-item').forEach(el => {
                el.onclick = async () => {
                    const id = el.dataset.id;
                    await markNotificationRead(id, currentUser.id);
                    el.classList.remove('unread');
                    loadNotifications();
                };
            });
        };

        const loadNotifications = async () => {
            try {
                const data = await getNotifications(currentUser.id);
                const unread = data?.unread_count || 0;
                if (badge) {
                    badge.textContent = unread > 99 ? '99+' : String(unread);
                    badge.style.display = unread > 0 ? 'flex' : 'none';
                }
                renderList(data?.notifications || []);
            } catch (e) {
                console.warn('Notifications load failed', e);
            }
        };

        btn.onclick = (e) => {
            e.stopPropagation();
            const open = panel.classList.toggle('open');
            panel.setAttribute('aria-hidden', open ? 'false' : 'true');
            if (open) loadNotifications();
        };

        if (markAll) {
            markAll.onclick = async (e) => {
                e.stopPropagation();
                await markAllNotificationsRead(currentUser.id);
                loadNotifications();
            };
        }

        document.addEventListener('click', (e) => {
            if (!document.getElementById('notifications-wrap')?.contains(e.target)) {
                panel.classList.remove('open');
                panel.setAttribute('aria-hidden', 'true');
            }
        });

        loadNotifications();
        setInterval(loadNotifications, 60000);
    },

    setupMobileToggle: function() {
        const toggle = document.getElementById('mobile-toggle');
        const sidebar = document.getElementById('sidebar');
        
        // Create backdrop if it doesn't exist
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.className = 'sidebar-backdrop';
            document.body.appendChild(backdrop);
        }

        if (toggle && sidebar) {
            toggle.onclick = (e) => {
                e.stopPropagation();
                sidebar.classList.toggle('active');
                backdrop.classList.toggle('active');
            };

            // Close on backdrop click
            backdrop.onclick = () => {
                sidebar.classList.remove('active');
                backdrop.classList.remove('active');
            };

            // Close when clicking any menu link (on mobile)
            const menuLinks = sidebar.querySelectorAll('.menu-link');
            menuLinks.forEach(link => {
                link.onclick = (e) => {
                    if (window.innerWidth <= 992) {
                        sidebar.classList.remove('active');
                        backdrop.classList.remove('active');
                    }
                };
            });
        }
    },

    renderFooter: function() {
        const mainContent = document.querySelector('.main-content');
        if (!mainContent) return;

        let footer = document.getElementById('footer-copyright');
        if (!footer) {
            footer = document.createElement('div');
            footer.id = 'footer-copyright';
            mainContent.appendChild(footer);
        }

        const year = new Date().getFullYear();
        footer.innerHTML = `
            <div class="footer-content">
                <p>&copy; ${year} <b>HSF SYSTEM</b>. Designed &amp; Developed by <a href="https://engsaqawe.com" target="_blank" rel="noopener" class="footer-link">Eng Saqawe</a>. All rights reserved.</p>
            </div>
        `;
    },

    showToast: function(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        
        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <div class="toast-content">${message}</div>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    },

};

function escapeNotifHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatNotifTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '';
    }
}

Object.assign(Components, {
    setLoading: function(btn, isLoading) {
        if (!btn) return;
        if (isLoading) {
            btn.dataset.originalHtml = btn.innerHTML;
            btn.innerHTML = '<div class="spinner"></div> Sending...';
            btn.disabled = true;
        } else {
            btn.innerHTML = btn.dataset.originalHtml || 'Save Changes';
            btn.disabled = false;
        }
    }
});