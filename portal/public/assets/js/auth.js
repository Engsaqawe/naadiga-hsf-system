document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const btn = document.getElementById('loginBtn');
    const msg = document.getElementById('loginMessage');

    btn.innerText = 'Verifying...';
    btn.disabled = true;

    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
    try {
        // Try fetching from real backend
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            localStorage.setItem('isAdmin', 'true');
            window.location.href = 'admin.html';
        } else {
            throw new Error('Invalid credentials');
        }
    } catch (err) {
        // Fallback to local simulation if backend is down or errors
        console.warn('Backend not available, using local simulation.', err);
        if (username === 'admin' && password === 'password123') {
            localStorage.setItem('isAdmin', 'true');
            window.location.href = 'admin.html';
        } else {
            msg.style.display = 'block';
            btn.innerText = 'Login to Dashboard';
            btn.disabled = false;
        }
    }
});

// Guard admin.html if not logged in
if (window.location.pathname.includes('admin.html')) {
    if (!localStorage.getItem('isAdmin')) {
        window.location.href = 'login.html';
    }
}
