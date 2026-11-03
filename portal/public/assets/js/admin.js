// Section Switching Logic
function switchSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.display = 'none';
    });

    // Show target section
    const targetSection = document.getElementById(sectionId + '-section');
    if (targetSection) {
        targetSection.style.display = 'block';
    }

    // Update active sidebar link
    document.querySelectorAll('.sidebar-links a').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('onclick')?.includes(sectionId)) {
            link.classList.add('active');
        }
    });

    // Close sidebar on mobile after navigating
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar) sidebar.classList.remove('active');

    // Dynamic data loading
    if (sectionId === 'overview') {
        fetchStats();
    } else if (sectionId === 'gallery-manager') {
        renderGallery();
    } else if (sectionId === 'settings') {
        loadAdminSettings();
    }
}

// Stats & Management
async function fetchStats() {
    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
    try {
        const response = await fetch(`${API_BASE}/stats`);
        const data = await response.json();
        
        if (document.getElementById('stat-visitors')) document.getElementById('stat-visitors').innerText = data.visitors;
        if (document.getElementById('stat-total-visitors')) document.getElementById('stat-total-visitors').innerText = data.total_visitors.toLocaleString();
        if (document.getElementById('stat-gallery')) document.getElementById('stat-gallery').innerText = data.gallery_images;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

async function renderGallery() {
    const grid = document.getElementById('gallery-manager-grid');
    if (!grid) return;
    
    grid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); grid-column: 1/-1;">Synchronizing with database...</div>';
    
    try {
        const DefaultImages = {
            '1': 'https://images.pexels.com/photos/4101553/pexels-photo-4101553.jpeg?auto=compress&cs=tinysrgb&w=600',
            '2': 'https://images.pexels.com/photos/6646954/pexels-photo-6646954.jpeg?auto=compress&cs=tinysrgb&w=600',
            '3': 'https://images.pexels.com/photos/6994982/pexels-photo-6994982.jpeg?auto=compress&cs=tinysrgb&w=600',
            '4': 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=600',
            '5': 'https://images.pexels.com/photos/5212345/pexels-photo-5212345.jpeg?auto=compress&cs=tinysrgb&w=600',
            '6': 'https://images.pexels.com/photos/6646862/pexels-photo-6646862.jpeg?auto=compress&cs=tinysrgb&w=1600',
            '7': 'https://images.pexels.com/photos/4491864/pexels-photo-4491864.jpeg?auto=compress&cs=tinysrgb&w=600',
            '8': 'https://images.pexels.com/photos/6646951/pexels-photo-6646951.jpeg?auto=compress&cs=tinysrgb&w=600',
            '9': 'https://images.pexels.com/photos/5693873/pexels-photo-5693873.jpeg?auto=compress&cs=tinysrgb&w=600',
            '10': 'https://images.pexels.com/photos/4145190/pexels-photo-4145190.jpeg?auto=compress&cs=tinysrgb&w=600',
            '11': 'https://images.pexels.com/photos/5428835/pexels-photo-5428835.jpeg?auto=compress&cs=tinysrgb&w=600',
            '12': 'https://images.pexels.com/photos/4101553/pexels-photo-4101553.jpeg?auto=compress&cs=tinysrgb&w=600'
        };

        const CategoryNames = {
            '1': '🏖️ Beach Cleaning', '2': '🧥 Eid Clothing Donation', '3': '🌙 Ramadan Iftar Program',
            '4': '📚 Monthly Meetings', '5': '☀️ Summer Courses', '6': '🏠 Hero Section',
            '7': '✨ Gallery (Slot 1)', '8': '✨ Gallery (Slot 2)', '9': '✨ Gallery (Slot 3)',
            '10': '✨ Gallery (Slot 4)', '11': '✨ Gallery (Slot 5)', '12': '✨ Gallery (Slot 6)'
        };

        const items = [];
        // Categories 1 to 12 (Expanded)
        const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
        for (let i = 1; i <= 12; i++) {
            const res = await fetch(`${API_BASE}/content/${i}`);
            const data = await res.json();
            if (data.image) {
                items.push({ id: i, image: data.image, name: CategoryNames[i], isCustom: true });
            } else {
                items.push({ id: i, image: DefaultImages[i], name: CategoryNames[i] + ' (Default)', isCustom: false });
            }
        }
        
        if (items.length === 0) {
            grid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); grid-column: 1/-1;">No gallery items found. Use "Add New" to upload.</div>';
            return;
        }

        grid.innerHTML = items.map(item => `
            <div class="gm-card" style="${item.isCustom ? 'border: 2px solid var(--primary-green)' : ''}">
                <img src="${item.image}" alt="Gallery Item ${item.id}">
                ${item.isCustom ? `
                <div class="gm-actions">
                    <button class="btn-icon" onclick="deleteGalleryItem(${item.id})" title="Delete Custom Image & Revert to Default">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                ` : ''}
                <div style="position:absolute; bottom:10px; left:10px; background:rgba(0,0,0,0.6); color:white; padding:2px 8px; border-radius:4px; font-size:0.7rem;">
                    ${item.name || ('Category ' + item.id)}
                </div>
            </div>
        `).join('');
    } catch (err) {
        grid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted); grid-column: 1/-1;">Gallery is currently empty or synchronizing.</div>';
    }
}

async function deleteGalleryItem(id) {
    if (!confirm("Are you sure you want to delete this from the website?")) return;
    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
    try {
        const response = await fetch(`${API_BASE}/content/${id}`, { method: 'DELETE' });
        if (response.ok) {
            // Remove from local storage cache too
            localStorage.removeItem(`cat_${id}_img`);
            renderGallery(); // Refresh UI
            fetchStats();    // Refresh total count
        }
    } catch (err) {
        alert("Delete failed. Backend might be down.");
    }
}

function toggleDashboardTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('dashboard-theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    if (text) text.innerText = isDark ? 'Light Mode' : 'Dark Mode';
}

async function loadAdminSettings() {
    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
    try {
        const response = await fetch(`${API_BASE}/admin/settings`);
        const data = await response.json();
        document.getElementById('setting-foundation').value = data.foundation_name;
        document.getElementById('setting-email').value = data.admin_email;
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

async function saveAdminSettings() {
    const data = {
        foundation_name: document.getElementById('setting-foundation').value,
        admin_email: document.getElementById('setting-email').value
    };
    const newPass = document.getElementById('setting-password').value;
    if (newPass) data.password = newPass;

    const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
    try {
        const response = await fetch(`${API_BASE}/admin/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (response.ok) {
            alert("Settings saved successfully!");
            if (data.theme === 'dark') document.body.classList.add('dark-theme');
            else document.body.classList.remove('dark-theme');
        }
    } catch (err) {
        alert("Failed to save. Check backend.");
    }
}

// Modal Logic
function openAddModal() {
    document.getElementById('addModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
}

function closeAddModal() {
    document.getElementById('addModal').style.display = 'none';
    document.getElementById('modalOverlay').style.display = 'none';
}

function submitNewContent() {
    const category = document.getElementById('contentCategory').value;
    const fileInput = document.getElementById('contentImage');
    const CategoryNames = {
        '1': '🏖️ Beach Cleaning',
        '2': '🧥 Eid Clothing Donation',
        '3': '🌙 Ramadan Iftar Program',
        '4': '📚 Monthly Meetings',
        '5': '☀️ Summer Courses',
        '6': '🏠 Hero Section',
        '7': '✨ Gallery (Slot 1)',
        '8': '✨ Gallery (Slot 2)',
        '9': '✨ Gallery (Slot 3)',
        '10': '✨ Gallery (Slot 4)',
        '11': '✨ Gallery (Slot 5)',
        '12': '✨ Gallery (Slot 6)'
    };

    if (!fileInput.files || !fileInput.files[0]) {
        alert("Please select a picture first!");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const base64Image = e.target.result;
        
        try {
            const API_BASE = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "http://localhost:5000/api" : "/api";
            // Send to real backend
            const response = await fetch(`${API_BASE}/content/${category}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Image })
            });

            if (response.ok) {
                // Also update local storage as a cache fallback
                localStorage.setItem(`cat_${category}_img`, base64Image);
                alert(`Successfully updated: ${CategoryNames[category]}! \n\nRefresh your website to see the change.`);
                closeAddModal();
            } else {
                throw new Error('Backend failed to update content.');
            }
        } catch (err) {
            console.error('Backend failed, falling back to local simulation.', err);
            localStorage.setItem(`cat_${category}_img`, base64Image);
            alert(`Updated (Local Mode): ${CategoryNames[category]}!`);
            closeAddModal();
        }
    };

    reader.readAsDataURL(file);
}

// Authentication Check (Simulated)
function checkAuth() {
    const isAdmin = localStorage.getItem('isAdmin');
    if (isAdmin !== 'true') {
        window.location.href = 'login.html';
    }
}

// Logout Utility
document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('isAdmin');
    window.location.href = 'index.html';
});

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    // Theme Initial Load
    const savedTheme = localStorage.getItem('dashboard-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        updateThemeUI(true);
    }

    fetchStats();
    renderGallery();
});

// Mobile Sidebar Logic
document.getElementById('adminMenuToggle')?.addEventListener('click', () => {
    document.getElementById('adminSidebar')?.classList.add('active');
});

document.getElementById('adminMenuClose')?.addEventListener('click', () => {
    document.getElementById('adminSidebar')?.classList.remove('active');
});
