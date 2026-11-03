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
    } else if (sectionId === 'public-users') {
        loadPublicUsers();
    } else if (sectionId === 'messages') {
        loadMessages();
    } else if (sectionId === 'articles-manager') {
        if (typeof initArticlesAdminSection === 'function') initArticlesAdminSection();
    } else if (sectionId === 'books-manager') {
        if (typeof initBooksAdminSection === 'function') initBooksAdminSection();
    } else if (sectionId === 'team-manager') {
        if (typeof initTeamAdminSection === 'function') initTeamAdminSection();
    }
}

// Stats & Management
async function fetchStats() {
    try {
        const response = await fetch(`${getAdminApiBase()}/public/stats`);
        const data = await response.json();
        
        if (document.getElementById('stat-visitors')) document.getElementById('stat-visitors').innerText = data.today_visitors;
        if (document.getElementById('stat-total-visitors')) document.getElementById('stat-total-visitors').innerText = data.total_visitors.toLocaleString();
        const visitBadge = document.getElementById('stat-visitors-badge');
        if (visitBadge) {
            visitBadge.innerHTML = '<i class="fas fa-arrow-up"></i> Today';
            visitBadge.title = 'Homepage loads today (one per browser per day)';
        }
        if (document.getElementById('stat-total-users')) document.getElementById('stat-total-users').innerText = data.total_users;
        if (document.getElementById('stat-total-messages')) document.getElementById('stat-total-messages').innerText = (data.total_messages ?? 0).toLocaleString();
        if (document.getElementById('stat-unread-messages')) document.getElementById('stat-unread-messages').innerText = data.unread_messages;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

async function loadPublicUsers() {
    const tbody = document.getElementById('public-users-table-body');
    if (!tbody) return;

    try {
        const response = await fetch(`${getAdminApiBase()}/public/users`);
        if (!response.ok) throw new Error('Failed to fetch');
        
        const users = await response.json();
        
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No public users registered yet. Users appear here after self-registration.</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => `
            <tr style="border-bottom: 1px solid var(--border-color);">
                <td style="padding: 12px; color: var(--text-main); font-weight: 500;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="width: 32px; height: 32px; background: var(--primary-green); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem;">
                            ${user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                        </div>
                        ${escapeHtml(user.name || '—')}
                    </div>
                </td>
                <td style="padding: 12px; color: var(--text-main);">${escapeHtml(user.email || 'N/A')}</td>
                <td style="padding: 12px; color: var(--text-main); font-weight: 600;">${escapeHtml(user.username || '—')}</td>
                <td style="padding: 12px; color: var(--text-muted); font-family: monospace; font-size: 0.85rem;">${escapeHtml(user.password || '—')}</td>
                <td style="padding: 12px; color: var(--text-muted);">${user.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}</td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('Failed to load users:', err);
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #ef4444;">Failed to load users.</td></tr>';
    }
}

async function loadMessages() {
    const tbody = document.getElementById('messages-table-body');
    if (!tbody) return;

    try {
        const response = await fetch(`${getAdminApiBase()}/public/messages`);
        if (!response.ok) throw new Error('Failed to fetch');
        
        const messages = await response.json();
        
        if (messages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No messages received yet.</td></tr>';
            return;
        }

        tbody.innerHTML = messages.map(msg => `
            <tr style="border-bottom: 1px solid var(--border-color); ${!msg.is_read ? 'background: rgba(245, 158, 11, 0.05);' : ''}">
                <td style="padding: 12px; color: var(--text-main); font-weight: 500;">
                    ${escapeHtml(msg.name)}
                    ${!msg.is_read ? '<span style="background: #f59e0b; color: white; font-size: 0.6rem; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">NEW</span>' : ''}
                    ${msg.replied_at ? '<span style="background:#2E946A;color:white;font-size:0.6rem;padding:2px 6px;border-radius:4px;margin-left:8px;">REPLIED</span>' : ''}
                </td>
                <td style="padding: 12px; color: var(--text-main);">${escapeHtml(msg.email)}</td>
                <td class="messages-preview-cell" style="padding: 12px;" title="${escapeHtml(msg.message)}" onclick="openMessageModal(${msg.id}, '${encodeURIComponent(msg.email)}', '${encodeURIComponent(msg.name)}', '${encodeURIComponent(msg.message)}', ${msg.has_account ? 'true' : 'false'}, '${encodeURIComponent(msg.username || '')}', '${encodeURIComponent(msg.login_hint || '')}', '${encodeURIComponent(msg.admin_reply || '')}', '${msg.replied_at || ''}')">${escapeHtml(msg.message)}</td>
                <td style="padding: 12px; color: var(--text-muted);">${new Date(msg.created_at).toLocaleDateString()}</td>
                <td style="padding: 12px;">
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button onclick="openMessageModal(${msg.id}, '${encodeURIComponent(msg.email)}', '${encodeURIComponent(msg.name)}', '${encodeURIComponent(msg.message)}', ${msg.has_account ? 'true' : 'false'}, '${encodeURIComponent(msg.username || '')}', '${encodeURIComponent(msg.login_hint || '')}', '${encodeURIComponent(msg.admin_reply || '')}', '${msg.replied_at || ''}')" class="btn-primary" style="padding: 6px 14px; font-size: 0.8rem; border:none; border-radius: 8px; cursor: pointer; white-space: nowrap;">View &amp; Reply</button>
                        ${!msg.is_read ? `<button onclick="markAsRead(${msg.id})" class="btn-outline" style="padding: 6px 12px; font-size: 0.8rem; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-main); border-radius: 6px; cursor: pointer;">Mark Read</button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('');

    } catch (err) {
        console.error('Failed to load messages:', err);
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: #ef4444;">Failed to load messages.</td></tr>';
    }
}

let _activeMessage = { id: null, email: '', name: '' };

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function openMessageModal(msgId, encodedEmail, encodedName, encodedMessage, hasAccount, encodedUsername, encodedLoginHint, encodedAdminReply, repliedAt) {
    _activeMessage = {
        id: msgId,
        email: decodeURIComponent(encodedEmail || ''),
        name: decodeURIComponent(encodedName || ''),
    };
    const meta = document.getElementById('messageModalMeta');
    const loginInfo = document.getElementById('messageModalLoginInfo');
    const replyStatus = document.getElementById('messageModalReplyStatus');
    const body = document.getElementById('messageModalContent');
    const replyInput = document.getElementById('messageReplyInput');
    const hasAcct = hasAccount === true || hasAccount === 'true';
    const username = decodeURIComponent(encodedUsername || '');
    const loginHint = decodeURIComponent(encodedLoginHint || '');
    const adminReply = decodeURIComponent(encodedAdminReply || '');

    if (meta) {
        meta.innerHTML = `<strong>${escapeHtml(_activeMessage.name)}</strong> &lt;${escapeHtml(_activeMessage.email)}&gt;<br><span style="font-size:0.78rem;">Reply will be emailed to this address — check for typos.</span>`;
    }
    if (loginInfo) {
        if (hasAcct && username) {
            loginInfo.innerHTML = `<i class="fas fa-user-check" style="color:#2E946A;margin-right:6px;"></i><strong>Registered user.</strong> Login username: <strong>${escapeHtml(username)}</strong>`;
        } else {
            loginInfo.innerHTML = `<i class="fas fa-info-circle" style="color:var(--text-muted);margin-right:6px;"></i>Legacy message — sender may not have a current registered account.`;
        }
        loginInfo.style.color = 'var(--text-main)';
    }
    if (replyStatus) {
        if (adminReply && repliedAt) {
            replyStatus.style.display = 'block';
            replyStatus.innerHTML = `<strong>Previous reply</strong> (${new Date(repliedAt).toLocaleString()}):<br>${escapeHtml(adminReply)}`;
        } else {
            replyStatus.style.display = 'none';
            replyStatus.innerHTML = '';
        }
    }
    if (body) {
        body.textContent = decodeURIComponent(encodedMessage || '');
        body.scrollTop = 0;
    }
    if (replyInput) replyInput.value = '';
    const modal = document.getElementById('messageModal');
    if (modal) modal.scrollTop = 0;
    document.getElementById('messageModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
    if (msgId) markAsRead(msgId);
}

function showFullMessage(encodedText) {
    openMessageModal(null, encodeURIComponent(''), encodeURIComponent('Contact'), encodedText);
}

async function sendMessageReply() {
    const replyText = (document.getElementById('messageReplyInput')?.value || '').trim();
    if (!replyText) {
        alert('Please enter a reply message.');
        return;
    }
    if (!_activeMessage.email) {
        alert('No recipient email for this message.');
        return;
    }
    const btn = document.getElementById('messageReplySendBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
        const response = await fetch(`${getAdminApiBase()}/public/reply-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: _activeMessage.email,
                name: _activeMessage.name,
                message: replyText,
                message_id: _activeMessage.id,
            })
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
            alert(`Reply sent to ${result.sent_to || _activeMessage.email}. Ask them to check inbox and spam folder.`);
            if (_activeMessage.id) {
                loadMessages();
                fetchStats();
            }
            document.getElementById('messageReplyInput').value = '';
        } else {
            alert(result.error || 'Failed to send reply. Check backend/.env mail settings.');
        }
    } catch (err) {
        console.error('Failed to send reply:', err);
        alert('Server error while sending reply.');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Reply'; }
    }
}

async function markAsRead(msgId) {
    try {
        const response = await fetch(`${getAdminApiBase()}/public/messages/${msgId}/read`, {
            method: 'POST'
        });
        if (response.ok) {
            loadMessages();
            fetchStats();
        }
    } catch (err) {
        console.error('Failed to mark as read:', err);
    }
}

function galleryDefaultSlides(id) {
    const catId = Number(id);
    if (window.HSFContentSlides) {
        return HSFContentSlides.defaultSlidesFor(catId);
    }
    return [];
}

const GALLERY_MOMENTS_IDS = [7, 8, 9, 11];
const GALLERY_IMPACT_IDS = [1, 2, 3, 4, 5];
const GALLERY_SITE_IDS = [6, 14, 15, 16, 17];

const CONTENT_GROUPS = {
    7: { key: 'moments', name: 'Gallery card 1', hint: 'Moments That Matter — 5 rotating pictures' },
    8: { key: 'moments', name: 'Gallery card 2', hint: 'Moments That Matter — 5 rotating pictures' },
    9: { key: 'moments', name: 'Gallery card 3', hint: 'Moments That Matter — 5 rotating pictures' },
    11: { key: 'moments', name: 'Gallery card 4', hint: 'Moments That Matter — 5 rotating pictures' },
    1: { key: 'impact', name: 'Activity card 1', hint: 'Our Impact Activities — 5 rotating pictures' },
    2: { key: 'impact', name: 'Activity card 2', hint: 'Our Impact Activities — 5 rotating pictures' },
    3: { key: 'impact', name: 'Activity card 3', hint: 'Our Impact Activities — 5 rotating pictures' },
    4: { key: 'impact', name: 'Activity card 4', hint: 'Our Impact Activities — 5 rotating pictures' },
    5: { key: 'impact', name: 'Activity card 5', hint: 'Our Impact Activities — 5 rotating pictures' },
    6: { key: 'site', name: 'Hero banner', hint: 'Site Cards — 5 rotating hero pictures' },
    14: { key: 'site', name: 'Story section 1', hint: 'Site Cards — 5 rotating pictures' },
    15: { key: 'site', name: 'Story section 2', hint: 'Site Cards — 5 rotating pictures' },
    16: { key: 'site', name: 'Story section 3', hint: 'Site Cards — 5 rotating pictures' },
    17: { key: 'site', name: 'Story section 4', hint: 'Site Cards — 5 rotating pictures' },
};

const GALLERY_CATEGORY_NAMES = Object.fromEntries(
    Object.entries(CONTENT_GROUPS).map(([id, g]) => [Number(id), g.name]),
);

const CONTENT_TEXT_FIELDS = {
    7: ['caption'],
    8: ['caption'],
    9: ['caption'],
    11: ['caption'],
    1: ['badge_text', 'title', 'description'],
    2: ['badge_text', 'title', 'description'],
    3: ['badge_text', 'title', 'description'],
    4: ['badge_text', 'title', 'description'],
    5: ['badge_text', 'title', 'description'],
    6: ['title', 'description'],
    14: ['title', 'description'],
    15: ['title', 'description'],
    16: ['title', 'description'],
    17: ['title', 'description'],
};

const TEXT_FIELD_UI = {
    section_title: { wrap: 'textFieldSectionTitle', input: 'textInputSectionTitle' },
    section_description: { wrap: 'textFieldSectionDesc', input: 'textInputSectionDesc' },
    title: { wrap: 'textFieldTitle', input: 'textInputTitle' },
    description: { wrap: 'textFieldDescription', input: 'textInputDescription' },
    badge_text: { wrap: 'textFieldBadge', input: 'textInputBadge' },
    caption: { wrap: 'textFieldCaption', input: 'textInputCaption' },
};

function contentDefaultText(id) {
    if (window.HSFContentSlides) return HSFContentSlides.defaultTextFor(Number(id));
    return {};
}

function contentTextFromApi(data, id) {
    if (window.HSFContentSlides) return HSFContentSlides.textFromApi(data, Number(id));
    return data.text || {};
}

function contentSlideTextsFromApi(data, id) {
    if (window.HSFContentSlides) return HSFContentSlides.slideTextsFromApi(data, Number(id));
    return data.slide_texts || [];
}

function contentSlideTextFromApi(data, id, slideIndex) {
    if (window.HSFContentSlides) return HSFContentSlides.slideTextFromApi(data, Number(id), Number(slideIndex));
    const all = contentSlideTextsFromApi(data, id);
    return all[slideIndex] || contentTextFromApi(data, id);
}

function slideTextHeadline(text, catId) {
    const t = text || {};
    if ([7, 8, 9, 11].includes(catId)) return t.caption || '';
    return t.title || t.caption || '';
}

const BADGE_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function badgeTextToMonthValue(text) {
    const raw = (text || '').trim();
    if (!raw) return '';
    const parsed = Date.parse(raw.replace(/^([A-Za-z]{3,9})\s+(\d{4})$/, '$1 1, $2'));
    if (Number.isNaN(parsed)) return '';
    const d = new Date(parsed);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function monthValueToBadgeText(value) {
    if (!value || !value.includes('-')) return '';
    const [y, m] = value.split('-');
    const idx = parseInt(m, 10) - 1;
    if (idx < 0 || idx > 11 || !y) return '';
    return `${BADGE_MONTH_NAMES[idx]} ${y}`;
}

function setBadgeInputsFromText(badgeText) {
    const monthEl = document.getElementById('textInputBadgeMonth');
    const textEl = document.getElementById('textInputBadge');
    const raw = (badgeText || '').trim();
    const monthVal = badgeTextToMonthValue(raw);
    if (monthEl) monthEl.value = monthVal;
    if (textEl) textEl.value = monthVal ? '' : raw;
}

function readBadgeTextFromInputs() {
    const custom = document.getElementById('textInputBadge')?.value.trim() || '';
    if (custom) return custom;
    const month = document.getElementById('textInputBadgeMonth')?.value || '';
    return monthValueToBadgeText(month);
}

function truncatePreview(str, max) {
    const s = (str || '').trim();
    if (!s) return '';
    return s.length > (max || 120) ? `${s.slice(0, max || 120)}…` : s;
}

function renderTextPreviewRow(label, value) {
    const val = (value || '').trim();
    const emptyClass = val ? '' : ' gm-text-preview--empty';
    return `
        <div class="gm-text-preview-row${emptyClass}">
            <span class="gm-text-preview-label">${escapeHtml(label)}</span>
            <span class="gm-text-preview-value">${val ? escapeHtml(truncatePreview(val, 160)) : '— default —'}</span>
        </div>`;
}

function renderSlideCardHtml(catId, url, slideIndex, isCustom, slideText, isCustomText) {
    const num = slideIndex + 1;
    const id = Number(catId);
    const imgBadge = isCustom ? 'Uploaded' : 'Default';
    const customClass = isCustom ? ' gm-slide-card--custom' : '';
    const deleteDisabled = isCustom ? '' : ' disabled';
    return `
        <div class="gm-slide-card${customClass}">
            <span class="gm-slide-label">Picture ${num}</span>
            <img src="${url}" alt="Picture ${num}">
            <span class="gm-slide-badge">${imgBadge}</span>
            <div class="gm-slide-actions">
                <button type="button" class="gm-slide-btn" onclick="editGalleryItem(${catId}, ${slideIndex})" title="Replace picture">
                    <i class="fas fa-image"></i>
                </button>
                <button type="button" class="gm-slide-btn" onclick="openContentTextModal(${catId}, ${slideIndex})" title="Edit text for this picture">
                    <i class="fas fa-font"></i>
                </button>
                <button type="button" class="gm-slide-btn gm-slide-btn--danger" onclick="deleteGallerySlide(${catId}, ${slideIndex}, ${isCustom ? 'true' : 'false'})" title="Remove picture upload"${deleteDisabled}>
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>`;
}

function renderSectionBlockHtml(item) {
    const meta = CONTENT_GROUPS[item.id] || {};
    const name = escapeHtml(meta.name || item.name || `Card ${item.id}`);
    const hint = escapeHtml(meta.hint || '');
    const slides = item.slides || [];
    const customSlides = item.customSlides || [];
    const slideTexts = item.slideTexts || [];
    const customSlideTexts = item.customSlideTexts || [];
    const slideCards = slides.map((url, idx) => renderSlideCardHtml(
        item.id,
        url,
        idx,
        !!customSlides[idx],
        slideTexts[idx],
        !!customSlideTexts[idx],
    )).join('');
    const customCount = customSlides.filter(Boolean).length;
    const customTextCount = customSlideTexts.filter(Boolean).length;
    const subtitle = `<span class="gm-section-cat">${hint} · ${customCount} custom pictures · ${customTextCount} custom texts</span>`;
    const resetBtn = customCount > 0
        ? `<button type="button" class="gm-text-btn" onclick="deleteAllGallerySlides(${item.id})" title="Restore all 5 defaults">
                <i class="fas fa-undo"></i> Reset pictures
           </button>`
        : '';

    return `
        <div class="gm-section-block">
            <div class="gm-section-head">
                <div>
                    <strong>${name}</strong>
                    ${subtitle}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${resetBtn}
                </div>
            </div>
            <div class="gm-slides-grid">${slideCards}</div>
        </div>`;
}

function gallerySlidesFromApi(data, id, timestamp) {
    if (window.HSFContentSlides) {
        return HSFContentSlides.slidesFromApi(data, Number(id)).map((url) => {
            if (url.startsWith('data:') || url.length > 300) return url;
            return `${url}${url.includes('?') ? '&' : '?'}v=${timestamp}`;
        });
    }
    return galleryDefaultSlides(id);
}

async function fetchGalleryItem(id, timestamp) {
    const res = await fetch(`${getAdminApiBase()}/public/content/${id}`);
    const data = await res.json();
    const slides = gallerySlidesFromApi(data, id, timestamp);
    const isCustom = Array.isArray(data.custom_slides)
        ? data.custom_slides.some(Boolean)
        : !!(data.image && data.image.length > 100);
    const slideTexts = contentSlideTextsFromApi(data, id);
    const text = slideTexts[0] || contentTextFromApi(data, id);
    return {
        id,
        image: slides[0] || '',
        slides,
        name: GALLERY_CATEGORY_NAMES[id] || `Section ${id}`,
        caption: text.caption || text.title || '',
        text,
        slideTexts,
        isCustom,
        customSlides: data.custom_slides || [],
        customSlideTexts: data.custom_slide_texts || [],
    };
}

async function renderGallery() {
    const grids = {
        moments: document.getElementById('gallery-section-moments'),
        impact: document.getElementById('gallery-section-impact'),
        site: document.getElementById('gallery-section-site'),
    };
    if (!grids.moments && !grids.impact && !grids.site) return;

    Object.values(grids).forEach(g => { if (g) g.innerHTML = '<div class="gm-loading">Synchronizing…</div>'; });

    try {
        const timestamp = Date.now();
        const loadGroup = async (ids) => Promise.all(ids.map(id => fetchGalleryItem(id, timestamp)));

        const [moments, impact, site] = await Promise.all([
            loadGroup(GALLERY_MOMENTS_IDS),
            loadGroup(GALLERY_IMPACT_IDS),
            loadGroup(GALLERY_SITE_IDS),
        ]);

        if (grids.moments) {
            grids.moments.innerHTML = moments.map((i) => renderSectionBlockHtml(i)).join('');
        }
        if (grids.impact) {
            grids.impact.innerHTML = impact.map((i) => renderSectionBlockHtml(i)).join('');
        }
        if (grids.site) {
            grids.site.innerHTML = site.map((i) => renderSectionBlockHtml(i)).join('');
        }
        await renderHomepageVideoAdmin();
    } catch (err) {
        const errHtml = '<div class="gm-loading">Could not load gallery. Is the server running?</div>';
        Object.values(grids).forEach(g => { if (g) g.innerHTML = errHtml; });
        const videoAdmin = document.getElementById('homepage-video-admin');
        if (videoAdmin) videoAdmin.innerHTML = errHtml;
    }
}

async function renderHomepageVideoAdmin() {
    const container = document.getElementById('homepage-video-admin');
    if (!container) return;
    container.innerHTML = '<div class="gm-loading">Loading video settings…</div>';

    try {
        const res = await fetch(`${getAdminApiBase()}/public/homepage-video`);
        if (!res.ok) throw new Error('load failed');
        const data = await res.json();
        const videos = Array.isArray(data.videos) ? data.videos : [];
        const customCount = videos.filter((v) => v.is_custom).length;
        const cards = videos.map((item, idx) => renderVideoSlideCardHtml(item, idx)).join('');
        const resetAllBtn = customCount > 0
            ? `<button type="button" class="gm-text-btn" onclick="resetAllHomepageVideos()" title="Restore all default videos">
                    <i class="fas fa-undo"></i> Reset all videos
               </button>`
            : '';

        container.innerHTML = `
            <div class="gm-section-block">
                <div class="gm-section-head">
                    <div>
                        <strong>Impact video showcase</strong>
                        <span class="gm-section-cat">3 homepage videos · ${customCount} custom upload${customCount === 1 ? '' : 's'}</span>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        ${resetAllBtn}
                    </div>
                </div>
                <div class="gm-slides-grid gm-slides-grid--videos">${cards}</div>
            </div>
        `;
    } catch (err) {
        container.innerHTML = '<div class="gm-loading">Could not load homepage video settings.</div>';
    }
}

function renderVideoSlideCardHtml(item, index) {
    const num = index + 1;
    const videoUrl = escapeHtml(item.video_url || '');
    const isCustom = !!item.is_custom;
    const imgBadge = isCustom ? 'Uploaded' : 'Default';
    const customClass = isCustom ? ' gm-slide-card--custom' : '';
    const deleteDisabled = isCustom ? '' : ' disabled';
    const ts = Date.now();
    return `
        <div class="gm-slide-card${customClass}">
            <span class="gm-slide-label">Video ${num}</span>
            <video src="${videoUrl}?t=${ts}" muted playsinline loop class="gm-slide-video-preview"></video>
            <span class="gm-slide-badge">${imgBadge}</span>
            <div class="gm-slide-actions">
                <button type="button" class="gm-slide-btn" onclick="triggerHomepageVideoUpload(${index})" title="Replace video">
                    <i class="fas fa-image"></i>
                </button>
                <button type="button" class="gm-slide-btn" onclick="openHomepageVideoTextModal(${index})" title="Edit text for this video">
                    <i class="fas fa-font"></i>
                </button>
                <button type="button" class="gm-slide-btn" onclick="resetHomepageVideoSlot(${index}, ${isCustom ? 'true' : 'false'})" title="Remove custom upload"${deleteDisabled}>
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <input type="file" id="homepageVideoFile${index}" accept="video/mp4,video/webm" hidden onchange="uploadHomepageVideo(this, ${index})">
        </div>`;
}

function triggerHomepageVideoUpload(index) {
    document.getElementById(`homepageVideoFile${index}`)?.click();
}

let homepageVideoCache = [];

async function loadHomepageVideoCache() {
    const res = await fetch(`${getAdminApiBase()}/public/homepage-video`);
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    homepageVideoCache = Array.isArray(data.videos) ? data.videos : [];
    return homepageVideoCache;
}

async function openHomepageVideoTextModal(index) {
    try {
        await loadHomepageVideoCache();
        const item = homepageVideoCache[index] || {};
        document.getElementById('videoTextModalIndex').value = String(index);
        document.getElementById('videoTextModalLabel').textContent = `Video ${index + 1} — intro overlay text`;
        document.getElementById('videoTextInputTitle').value = item.title || '';
        document.getElementById('videoTextInputDescription').value = item.description || '';
        document.getElementById('videoTextModal').style.display = 'block';
        document.getElementById('modalOverlay').style.display = 'block';
    } catch {
        alert('Could not load video text.');
    }
}

function closeVideoTextModal() {
    document.getElementById('videoTextModal').style.display = 'none';
    const overlay = document.getElementById('modalOverlay');
    if (overlay && !document.getElementById('addModal')?.style.display?.includes('block')
        && !document.getElementById('textModal')?.style.display?.includes('block')) {
        overlay.style.display = 'none';
    }
}

async function saveHomepageVideoText() {
    const index = Number(document.getElementById('videoTextModalIndex').value || '0');
    const title = document.getElementById('videoTextInputTitle')?.value?.trim() || '';
    const description = document.getElementById('videoTextInputDescription')?.value?.trim() || '';
    if (!title) {
        alert('Intro title is required.');
        return;
    }
    try {
        const res = await fetch(`${getAdminApiBase()}/public/admin/homepage-video`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_index: index, title, description }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed');
        closeVideoTextModal();
        await renderHomepageVideoAdmin();
        alert(`Video ${index + 1} intro text saved.`);
    } catch (err) {
        alert(err.message || 'Could not save intro text.');
    }
}

async function uploadHomepageVideo(input, index) {
    const file = input?.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['mp4', 'webm'].includes(ext)) {
        alert('Please choose an MP4 or WebM file.');
        input.value = '';
        return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('video_index', String(index));
    try {
        const res = await fetch(`${getAdminApiBase()}/public/admin/homepage-video/upload`, {
            method: 'POST',
            body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        input.value = '';
        await renderHomepageVideoAdmin();
        alert(`Video ${index + 1} uploaded.`);
    } catch (err) {
        alert(err.message || 'Could not upload video.');
        input.value = '';
    }
}

async function resetHomepageVideoSlot(index, isCustom) {
    if (!isCustom) {
        alert('This video is the default. Only uploaded videos can be removed.');
        return;
    }
    if (!confirm(`Remove your upload for Video ${index + 1} and restore the default file?`)) return;
    try {
        const res = await fetch(
            `${getAdminApiBase()}/public/admin/homepage-video?video_index=${index}`,
            { method: 'DELETE' },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Reset failed');
        await renderHomepageVideoAdmin();
        alert(`Video ${index + 1} restored to default.`);
    } catch (err) {
        alert(err.message || 'Could not reset video.');
    }
}

async function resetAllHomepageVideos() {
    if (!confirm('Remove every custom video upload and restore all 3 defaults?')) return;
    try {
        for (let i = 0; i < 3; i += 1) {
            await fetch(`${getAdminApiBase()}/public/admin/homepage-video?video_index=${i}`, { method: 'DELETE' });
        }
        await renderHomepageVideoAdmin();
        alert('All videos restored to defaults.');
    } catch {
        alert('Could not reset all videos.');
    }
}

function closeTextModal() {
    document.getElementById('textModal').style.display = 'none';
    const overlay = document.getElementById('modalOverlay');
    if (overlay && !document.getElementById('addModal')?.style.display?.includes('block')) {
        overlay.style.display = 'none';
    }
}

function showTextFieldsForCategory(id) {
    const catId = Number(id);
    const fields = CONTENT_TEXT_FIELDS[catId] || ['title', 'description'];
    Object.values(TEXT_FIELD_UI).forEach(({ wrap }) => {
        const el = document.getElementById(wrap);
        if (el) el.style.display = 'none';
    });
    fields.forEach((field) => {
        const ui = TEXT_FIELD_UI[field];
        if (ui) {
            const wrap = document.getElementById(ui.wrap);
            if (wrap) wrap.style.display = 'block';
        }
    });
    const titleLabel = document.getElementById('textLabelTitle');
    if (titleLabel) {
        if (catId === 6) titleLabel.textContent = 'Hero headline';
        else if (GALLERY_IMPACT_IDS.includes(catId)) titleLabel.textContent = 'Activity card title';
        else if (GALLERY_SITE_IDS.includes(catId) && catId !== 6) titleLabel.textContent = 'Story section title';
        else titleLabel.textContent = 'Title';
    }
}

function openTextEditorForSelectedCategory() {
    const cat = document.getElementById('contentCategory')?.value;
    const slide = document.getElementById('contentSlideIndex')?.value || '0';
    if (!cat) return;
    closeAddModal();
    openContentTextModal(cat, slide);
}

async function openContentTextModal(id, slideIndex) {
    const catId = Number(id);
    const slideIdx = slideIndex != null ? Number(slideIndex) : 0;
    const res = await fetch(`${getAdminApiBase()}/public/content/${catId}`);
    const data = await res.json();
    const text = contentSlideTextFromApi(data, catId, slideIdx);
    document.getElementById('textModalCategoryId').value = String(catId);
    document.getElementById('textModalSlideIndex').value = String(slideIdx);
    const sectionName = GALLERY_CATEGORY_NAMES[catId] || `Category ${catId}`;
    document.getElementById('textModalCategoryLabel').textContent =
        `Picture ${slideIdx + 1} — ${sectionName}`;
    showTextFieldsForCategory(catId);
    Object.entries(TEXT_FIELD_UI).forEach(([field, { input }]) => {
        if (field === 'badge_text') {
            setBadgeInputsFromText(text.badge_text || '');
            return;
        }
        const el = document.getElementById(input);
        if (el) el.value = text[field] || '';
    });
    document.getElementById('textModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
}

async function saveContentText() {
    const id = Number(document.getElementById('textModalCategoryId').value);
    const slideIndex = Number(document.getElementById('textModalSlideIndex').value || '0');
    const fields = CONTENT_TEXT_FIELDS[id] || [];
    const payload = { slide_index: slideIndex };
    fields.forEach((field) => {
        if (field === 'badge_text') {
            payload.badge_text = readBadgeTextFromInputs();
            return;
        }
        const ui = TEXT_FIELD_UI[field];
        if (!ui) return;
        const el = document.getElementById(ui.input);
        payload[field] = el ? el.value.trim() : '';
    });
    try {
        const response = await fetch(`${getAdminApiBase()}/public/content/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (response.ok) {
            closeTextModal();
            renderGallery();
            alert(`Text saved for Picture ${slideIndex + 1}. Refresh the public homepage to see changes.`);
        } else {
            alert('Could not save text.');
        }
    } catch {
        alert('Server error while saving text.');
    }
}

async function resetContentText() {
    const id = Number(document.getElementById('textModalCategoryId').value);
    const slideIndex = Number(document.getElementById('textModalSlideIndex').value || '0');
    if (!confirm(`Restore Picture ${slideIndex + 1} text to site defaults?`)) return;
    const fields = CONTENT_TEXT_FIELDS[id] || [];
    const payload = { slide_index: slideIndex };
    fields.forEach((field) => { payload[field] = ''; });
    try {
        const response = await fetch(`${getAdminApiBase()}/public/content/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (response.ok) {
            closeTextModal();
            renderGallery();
            alert(`Picture ${slideIndex + 1} text reset to defaults.`);
        } else {
            alert('Could not reset text.');
        }
    } catch {
        alert('Server error while resetting text.');
    }
}

/** @deprecated use openContentTextModal */
async function editGalleryCaption(id) {
    openContentTextModal(id, 0);
}

async function deleteGallerySlide(id, slideIndex, isCustom) {
    if (!isCustom) {
        alert('This picture is the default. Only uploaded pictures can be removed.');
        return;
    }
    const slideNum = Number(slideIndex) + 1;
    if (!confirm(`Remove your upload for Picture ${slideNum} and restore the default image?`)) return;
    try {
        const response = await fetch(
            `${getAdminApiBase()}/public/content/${id}?slide_index=${slideIndex}`,
            { method: 'DELETE' },
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
            localStorage.removeItem(`cat_${id}_img`);
            renderGallery();
            fetchStats();
        } else {
            alert(data.message || 'Delete failed.');
        }
    } catch {
        alert('Delete failed. Backend might be down.');
    }
}

async function deleteAllGallerySlides(id) {
    if (!confirm('Remove every custom upload for this section and restore all 5 default pictures?')) return;
    try {
        const response = await fetch(`${getAdminApiBase()}/public/content/${id}`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
            localStorage.removeItem(`cat_${id}_img`);
            renderGallery();
            fetchStats();
        } else {
            alert(data.message || 'Delete failed.');
        }
    } catch {
        alert('Delete failed. Backend might be down.');
    }
}

/** @deprecated use deleteGallerySlide */
async function deleteGalleryItem(id, isCustom) {
    if (!isCustom) {
        alert('Default images cannot be deleted. Only uploaded pictures can be removed.');
        return;
    }
    await deleteAllGallerySlides(id);
}

function toggleDashboardTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('dashboard-theme', isDark ? 'dark' : 'light');
    updateThemeUI(isDark);
}

function updateThemeUI(isDark) {
    const iconCls = isDark ? 'fas fa-sun' : 'fas fa-moon';
    const label = isDark ? 'Light Mode' : 'Dark Mode';
    ['theme-icon-header', 'theme-icon-desktop'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = iconCls;
    });
    ['header-theme-toggle', 'desktop-theme-toggle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.setAttribute('aria-label', label);
            el.setAttribute('title', label);
        }
    });
}

async function loadAdminSettings() {
    try {
        const response = await fetch(`${getAdminApiBase()}/public/admin/settings`);
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

    try {
        const response = await fetch(`${getAdminApiBase()}/public/admin/settings`, {
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
    const modalTitle = document.querySelector('#addModal h2');
    if (modalTitle) modalTitle.textContent = 'Upload Website Picture';
}

function closeAddModal() {
    document.getElementById('addModal').style.display = 'none';
    const modalTitle = document.querySelector('#addModal h2');
    if (modalTitle) modalTitle.textContent = 'Upload Website Picture';
    if (document.getElementById('textModal')?.style.display !== 'block') {
        document.getElementById('modalOverlay').style.display = 'none';
    }
}

function closeMessageModal() {
    document.getElementById('messageModal').style.display = 'none';
    document.getElementById('modalOverlay').style.display = 'none';
}

function editGalleryItem(id, slideIndex) {
    document.getElementById('addModal').style.display = 'block';
    document.getElementById('modalOverlay').style.display = 'block';
    document.getElementById('contentCategory').value = id;
    const slideEl = document.getElementById('contentSlideIndex');
    const idx = slideIndex != null ? slideIndex : 0;
    if (slideEl) slideEl.value = String(idx);
    document.getElementById('contentImage').value = '';
    const modalTitle = document.querySelector('#addModal h2');
    if (modalTitle) {
        const sectionName = GALLERY_CATEGORY_NAMES[id] || `Section ${id}`;
        modalTitle.textContent = `Replace picture ${idx + 1} — ${sectionName}`;
    }
}

function submitNewContent() {
    const category = document.getElementById('contentCategory').value;
    const slideIndex = parseInt(document.getElementById('contentSlideIndex')?.value || '0', 10);
    const fileInput = document.getElementById('contentImage');
    const sectionName = GALLERY_CATEGORY_NAMES[Number(category)] || `Card ${category}`;

    if (!fileInput.files || !fileInput.files[0]) {
        alert("Please select a picture first!");
        return;
    }

    const file = fileInput.files[0];
    const maxBytes = 12 * 1024 * 1024;
    if (file.size > maxBytes) {
        alert('Image is too large. Please use a file under 12 MB.');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('slide_index', String(slideIndex));

    const submitBtn = document.querySelector('.admin-modal .btn-primary')
        || document.querySelector('#addModal button[onclick="submitNewContent()"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Uploading...";
    }

    (async () => {
        try {
            const response = await fetch(`${getAdminApiBase()}/public/content/${category}`, {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                localStorage.removeItem(`cat_${category}_img`);
                alert(`SUCCESS: Picture ${slideIndex + 1} for ${sectionName} saved!`);
                renderGallery();
                fetchStats();
                closeAddModal();
            } else {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || 'Server rejected the upload.');
            }
        } catch (err) {
            console.error('Upload Error:', err);
            alert(`ERROR: Could not save to database.\nReason: ${err.message}\n\nPlease check your server connection.`);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "💾 Upload & Save Content";
            }
        }
    })();
}

function getAdminApiBase() {
    const host = window.location.hostname || '';
    const port = window.location.port || '';
    if (port === '5000') {
        return `${window.location.origin.replace(/\/$/, '')}/api`;
    }
    if (!host || host === 'localhost' || host === '127.0.0.1') {
        return 'http://127.0.0.1:5000/api';
    }
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
        return `${window.location.protocol}//${host}:5000/api`;
    }
    return '/api';
}

function getAdminLeaderUser() {
    try {
        return JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
    } catch {
        return {};
    }
}

function escapeAdminNotifHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatAdminNotifTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const now = new Date();
        const diffMs = now - d;
        if (diffMs < 60000) return 'Just now';
        if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
        if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function navigateForPublicAdminNotification(category) {
    if (category === 'contact') switchSection('messages');
    else if (category === 'public_registration' || category === 'registration') switchSection('public-users');
}

const ADMIN_MOBILE_BP = 768;

function placeAdminNotifications() {
    const wrap = document.getElementById('admin-notifications-wrap');
    const mobileSlot = document.getElementById('admin-notifications-slot-mobile');
    const desktopSlot = document.getElementById('admin-notifications-slot-desktop');
    if (!wrap || !mobileSlot || !desktopSlot) return;
    const target = window.innerWidth <= ADMIN_MOBILE_BP ? mobileSlot : desktopSlot;
    if (wrap.parentElement !== target) {
        target.appendChild(wrap);
    }
}

function setupAdminNotifications() {
    const user = getAdminLeaderUser();
    if (!user?.id) return;

    const btn = document.getElementById('admin-notifications-btn');
    const panel = document.getElementById('admin-notifications-panel');
    const list = document.getElementById('admin-notifications-list');
    const badge = document.getElementById('admin-notifications-badge');
    const markAll = document.getElementById('admin-notifications-mark-all');
    const wrap = document.getElementById('admin-notifications-wrap');
    if (!btn || !panel || !list) return;

    const renderList = (items) => {
        if (!items?.length) {
            list.innerHTML = '<p class="admin-notifications-empty">No notifications yet.</p>';
            return;
        }
        list.innerHTML = items.map((n) => {
            const body = escapeAdminNotifHtml(n.body || '').replace(/\n/g, '<br>');
            return `
                <div class="admin-notification-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-category="${escapeAdminNotifHtml(n.category || '')}">
                    <div class="title">${escapeAdminNotifHtml(n.title)}</div>
                    <div class="body">${body}</div>
                    <div class="time">${formatAdminNotifTime(n.created_at)}</div>
                </div>`;
        }).join('');

        list.querySelectorAll('.admin-notification-item').forEach((el) => {
            el.addEventListener('click', async () => {
                const id = el.dataset.id;
                const category = el.dataset.category || '';
                try {
                    await fetch(`${getAdminApiBase()}/notifications/${id}/read`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: user.id }),
                    });
                } catch (e) {
                    console.warn('Mark read failed', e);
                }
                el.classList.remove('unread');
                loadNotifications();
                navigateForPublicAdminNotification(category);
            });
        });
    };

    const loadNotifications = async () => {
        try {
            const res = await fetch(
                `${getAdminApiBase()}/notifications?user_id=${encodeURIComponent(user.id)}&limit=30&scope=public`,
            );
            if (!res.ok) return;
            const data = await res.json();
            const unread = data?.unread_count || 0;
            if (badge) {
                badge.textContent = unread > 99 ? '99+' : String(unread);
                badge.style.display = unread > 0 ? 'flex' : 'none';
            }
            renderList(data?.notifications || []);
        } catch (e) {
            console.warn('Admin notifications load failed', e);
        }
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.classList.toggle('open');
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) loadNotifications();
    });

    markAll?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            await fetch(`${getAdminApiBase()}/notifications/mark-all-read`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: user.id, scope: 'public' }),
            });
        } catch (e) {
            console.warn('Mark all read failed', e);
        }
        loadNotifications();
    });

    document.addEventListener('click', (e) => {
        if (!wrap?.contains(e.target)) {
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
        }
    });

    loadNotifications();
    setInterval(loadNotifications, 60000);
}

function hasPublicAdminAccess() {
    if (localStorage.getItem('isAdmin') === 'true') return true;
    try {
        const u = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
        return u.role === 'Main Leader';
    } catch {
        return false;
    }
}

function checkAuth() {
    if (!hasPublicAdminAccess()) {
        window.location.href = 'admin_login.html';
    }
}

function setupCrossPanelLinks() {
    const portalLink = document.getElementById('linkMemberPortal');
    if (!portalLink) return;
    try {
        const u = JSON.parse(localStorage.getItem('hsf_current_user') || '{}');
        if (u.role === 'Main Leader' && u.id) {
            portalLink.href = 'portal/pages/main-leader/dashboard.html';
            portalLink.title = 'Open Member Portal (Main Leader dashboard)';
        } else {
            portalLink.href = 'portal/login.html';
            portalLink.title = 'Log in to Member Portal';
        }
    } catch {
        portalLink.href = 'portal/login.html';
    }
}

// Logout Utility
document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('isAdmin');
    localStorage.removeItem('hsf_current_user');
    window.location.href = 'index.html';
});

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupCrossPanelLinks();
    placeAdminNotifications();
    window.addEventListener('resize', placeAdminNotifications);
    setupAdminNotifications();
    
    // Theme Initial Load
    const savedTheme = localStorage.getItem('dashboard-theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        updateThemeUI(true);
    }

    fetchStats();
    renderGallery();

    document.getElementById('messageReplySendBtn')?.addEventListener('click', sendMessageReply);
});

// Mobile Sidebar Logic
document.getElementById('adminMenuToggle')?.addEventListener('click', () => {
    document.getElementById('adminSidebar')?.classList.add('active');
});

document.getElementById('adminMenuClose')?.addEventListener('click', () => {
    document.getElementById('adminSidebar')?.classList.remove('active');
});
