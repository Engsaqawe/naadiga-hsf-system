document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('loginBtn');
    const msg = document.getElementById('loginMessage');

    btn.innerText = 'Verifying...';
    btn.disabled = true;

    const apiBase = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://127.0.0.1:5000'
        : window.location.origin;

    try {
        const response = await fetch(`${apiBase}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            const role = data.user.role;
            if (role === 'Public User') {
                localStorage.setItem('publicUser', JSON.stringify(data.user));
                const ret = (typeof HSFContactReturn !== 'undefined')
                    ? HSFContactReturn.getPostAuthReturn('index.html')
                    : (new URLSearchParams(window.location.search).get('return') || 'index.html');
                window.location.href = ret;
            } else if (role === 'Main Leader') {
                localStorage.setItem('isAdmin', 'true');
                localStorage.setItem('hsf_current_user', JSON.stringify(data.user));
                window.location.href = 'admin.html';
            } else {
                msg.innerText = 'Access denied. Members must use the Member Portal.';
                msg.style.display = 'block';
                btn.innerText = 'Login';
                btn.disabled = false;
                return;
            }
        } else {
            msg.innerText = data.message || 'Invalid username or password';
            msg.style.display = 'block';
            btn.innerText = 'Login to Dashboard';
            btn.disabled = false;
        }
    } catch (err) {
        console.error('Login error:', err);
        msg.innerText = 'Connection error. Is the server running?';
        msg.style.display = 'block';
        btn.innerText = 'Login to Dashboard';
        btn.disabled = false;
    }
});

function hasPublicAdminAccess() {
    if (localStorage.getItem('isAdmin') === 'true') return true;
    try {
        const u = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
        return u.role === 'Main Leader';
    } catch {
        return false;
    }
}

// Guard admin.html if not logged in
if (window.location.pathname.includes('admin.html')) {
    if (!hasPublicAdminAccess()) {
        window.location.href = 'admin_login.html';
    }
}
