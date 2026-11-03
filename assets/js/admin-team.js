const TEAM_API = (() => {
  const host = window.location.hostname || '';
  const port = window.location.port || '';
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:5000/api/public';
  if (port === '5000') return `${window.location.origin}/api/public`;
  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:5000/api/public';
  }
  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return `${window.location.protocol}//${host}:5000/api/public`;
  }
  return `${window.location.origin}/api/public`;
})();
let teamMembersCache = [];
let teamAdminInited = false;
let teamPendingPhotoFile = null;
let teamPreviewObjectUrl = null;

function teamPhotoSrc(url) {
  const u = (url || '').trim();
  if (!u) return 'portal/img/logo.svg';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('blob:')) return u;
  return encodeURI(u);
}

function clearTeamPhotoPreview() {
  if (teamPreviewObjectUrl) {
    URL.revokeObjectURL(teamPreviewObjectUrl);
    teamPreviewObjectUrl = null;
  }
  teamPendingPhotoFile = null;
}

function setTeamPhotoHint(text) {
  const hint = document.getElementById('teamPhotoHint');
  if (!hint) return;
  if (text) {
    hint.textContent = text;
    hint.hidden = false;
  } else {
    hint.textContent = '';
    hint.hidden = true;
  }
}

async function loadTeamAdmin() {
  const tbody = document.getElementById('team-admin-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted);">Loading…</td></tr>';
  try {
    const res = await fetch(`${TEAM_API}/admin/site-team`);
    const members = await res.json();
    teamMembersCache = Array.isArray(members) ? members : [];
    if (!teamMembersCache.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted);">No team members yet. Click <strong>Add member</strong> or upload photos to <code>assets/team/</code>.</td></tr>';
      return;
    }
    tbody.innerHTML = teamMembersCache.map((m, idx) => `
      <tr style="border-bottom:1px solid var(--border-color);" data-team-id="${m.id != null ? m.id : ''}">
        <td style="padding:10px;"><img src="${attrTeam(teamPhotoSrc(m.photo_url))}" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;background:#eee;" onerror="this.src='portal/img/logo.svg'"></td>
        <td style="padding:10px;">${escTeam(m.name)}</td>
        <td style="padding:10px;">${escTeam(m.title)}</td>
        <td style="padding:10px;">
          <div class="team-admin-actions">
            <button type="button" class="team-admin-icon-btn" title="Edit" onclick="editTeamMemberByIndex(${idx})"><i class="fas fa-pen"></i></button>
            <button type="button" class="team-admin-icon-btn team-admin-icon-btn--danger" title="Delete" onclick="deleteTeamMemberByIndex(${idx})"><i class="fas fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:#dc2626;">Could not load team.</td></tr>';
  }
}

function escTeam(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function attrTeam(s) {
  return String(s || 'portal/img/logo.svg').replace(/"/g, '&quot;');
}

function openTeamModal(member) {
  const modal = document.getElementById('teamModal');
  const card = document.getElementById('teamModalCard');
  if (!modal || !card) return;

  clearTeamPhotoPreview();
  document.getElementById('teamEditForm')?.reset();
  setTeamPhotoHint('');
  const maxOrder = teamMembersCache.reduce((m, x) => Math.max(m, x.sort_order ?? 0), -1);

  if (member) {
    document.getElementById('teamEditId').value = String(member.id);
    document.getElementById('teamEditName').value = member.name || '';
    document.getElementById('teamEditTitle').value = member.title || '';
    document.getElementById('teamEditPhoto').value = member.photo_url || '';
    document.getElementById('teamEditSort').value = member.sort_order ?? 0;
    document.getElementById('teamPhotoPreview').src = teamPhotoSrc(member.photo_url || 'portal/img/logo.svg');
    document.getElementById('teamModalTitle').textContent = 'Edit team member';
  } else {
    document.getElementById('teamEditId').value = '';
    document.getElementById('teamEditPhoto').value = '';
    document.getElementById('teamEditSort').value = maxOrder + 1;
    document.getElementById('teamPhotoPreview').src = 'portal/img/logo.svg';
    document.getElementById('teamModalTitle').textContent = 'Add team member';
  }

  modal.classList.add('is-open');
  card.classList.add('is-open');
  document.body.classList.add('hs-modal-open');
}

function closeTeamModal() {
  const modal = document.getElementById('teamModal');
  const card = document.getElementById('teamModalCard');
  modal?.classList.remove('is-open');
  card?.classList.remove('is-open');
  clearTeamPhotoPreview();
  setTeamPhotoHint('');
  if (!document.querySelector('.hs-modal.is-open')) {
    document.body.classList.remove('hs-modal-open');
  }
}

function editTeamMemberByIndex(idx) {
  const m = teamMembersCache[idx];
  if (m) openTeamModal(m);
}

function onTeamPhotoChosen(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Please choose an image file.');
    return;
  }
  clearTeamPhotoPreview();
  teamPendingPhotoFile = file;
  teamPreviewObjectUrl = URL.createObjectURL(file);
  document.getElementById('teamPhotoPreview').src = teamPreviewObjectUrl;
  document.getElementById('teamEditPhoto').value = '';
  setTeamPhotoHint(`Selected: ${file.name} (uploads when you click Save)`);
}

async function uploadTeamPhotoFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${TEAM_API}/admin/site-team/upload`, { method: 'POST', body: fd });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || 'Upload failed.');
  }
  return data.photo_url;
}

async function saveTeamMember(e) {
  if (e) e.preventDefault();
  const id = document.getElementById('teamEditId').value.trim();
  let photoUrl = document.getElementById('teamEditPhoto').value.trim();
  const name = document.getElementById('teamEditName').value.trim();
  const saveBtn = document.getElementById('teamSaveBtn');

  if (name.length < 2) {
    alert('Please enter a name (at least 2 characters).');
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = teamPendingPhotoFile ? 'Uploading…' : 'Saving…';
  }

  try {
    if (teamPendingPhotoFile) {
      photoUrl = await uploadTeamPhotoFile(teamPendingPhotoFile);
      document.getElementById('teamEditPhoto').value = photoUrl;
      clearTeamPhotoPreview();
      setTeamPhotoHint('');
    }

    if (!photoUrl) {
      alert('Please choose a photo before saving.');
      return;
    }

    if (saveBtn) saveBtn.textContent = 'Saving…';

    const payload = {
      name,
      title: document.getElementById('teamEditTitle').value.trim(),
      photo_url: photoUrl,
      sort_order: parseInt(document.getElementById('teamEditSort').value, 10) || 0,
      is_published: true,
    };

    const isEdit = id && /^\d+$/.test(id);
    const url = isEdit ? `${TEAM_API}/admin/site-team/${id}` : `${TEAM_API}/admin/site-team`;
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await res.json();
    } catch (parseErr) {
      data = {};
    }
    if (!res.ok) {
      alert(data.error || 'Could not save team member.');
      return;
    }
    closeTeamModal();
    await loadTeamAdmin();
    const newId = data.member?.id;
    if (newId != null) {
      const row = document.querySelector(`#team-admin-body tr[data-team-id="${newId}"]`);
      row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    console.error('Team save failed', err);
    alert(err.message || 'Could not save team member. Use http://127.0.0.1:5000/admin.html with the backend running.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

async function deleteTeamMemberByIndex(idx) {
  const m = teamMembersCache[idx];
  if (!m) return;
  if (!confirm(`Remove "${m.name}" from the public site?`)) return;
  try {
    const res = await fetch(`${TEAM_API}/admin/site-team/remove`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id ?? null, photo_url: m.photo_url || '' }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not delete.');
      return;
    }
    loadTeamAdmin();
  } catch (e) {
    alert('Could not delete team member.');
  }
}

function bindTeamAdminEvents() {
  document.getElementById('teamUploadBtn')?.addEventListener('click', () => {
    document.getElementById('teamPhotoFile')?.click();
  });
  document.getElementById('teamPhotoFile')?.addEventListener('change', (e) => {
    onTeamPhotoChosen(e.target);
  });
  document.getElementById('teamSaveBtn')?.addEventListener('click', saveTeamMember);
  document.getElementById('teamEditForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTeamMember(e);
  });
}

function initTeamAdminSection() {
  loadTeamAdmin();
  if (teamAdminInited) return;
  teamAdminInited = true;
  bindTeamAdminEvents();
  document.getElementById('teamModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'teamModal') closeTeamModal();
  });
  document.getElementById('teamModalClose')?.addEventListener('click', closeTeamModal);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindTeamAdminEvents);
} else {
  bindTeamAdminEvents();
}

window.openTeamModal = openTeamModal;
window.closeTeamModal = closeTeamModal;
window.saveTeamMember = saveTeamMember;
window.editTeamMemberByIndex = editTeamMemberByIndex;
window.deleteTeamMemberByIndex = deleteTeamMemberByIndex;
window.initTeamAdminSection = initTeamAdminSection;
