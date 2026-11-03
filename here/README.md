# Find Photos — separation starter kit

Copied from the HSF system so you can rename this folder and open it as its **own** Cursor project / product.

## Memory for AI (read these first)

| File | Purpose |
|------|---------|
| `AGENTS.md` | Short agent instructions |
| `PRODUCT.md` | Full product / market / tech handoff |
| `.cursor/rules/*.mdc` | Auto-applied Cursor rules (vision, privacy, matching) |

When you open a **new chat** here, say: *Read AGENTS.md and PRODUCT.md* if rules are not already attached.

## What’s inside

```
here/
  .cursor/rules/        Persistent AI context
  AGENTS.md / PRODUCT.md
  face_recognition/     Public find UI + media upload UI + data/uploads folders
  portal/
    pages/media-admin/  Media Gallery admin
    pages/student/      Find My Photos + My Photos
    assets/             Minimal shared JS/CSS
  backend/
    routes/face_photos_api.py
    utils/email_helpers.py   (still HSF-oriented — replace later)
    requirements.txt
```

Sample data was reset to empty. Uploaded event photos were **not** copied.

## What this is NOT yet

A **file kit**, not a finished separate SaaS. Still expects HSF-shaped auth/layout until you add a thin standalone backend.

## Suggested next steps

1. Rename this folder (your brand name).
2. Cursor → **File → Open Folder** on it alone.
3. Build thin Flask app + organizer auth + guest QR + privacy Accept/Reject.
4. Keep HSF’s live Find Photos working separately for the club.

## Entry points

| Role | Open |
|------|------|
| Guest find | `face_recognition/index.html` |
| Media upload (standalone) | `face_recognition/upload.html` |
| Media admin | `portal/pages/media-admin/dashboard.html` |
| API | `backend/routes/face_photos_api.py` |

## Tech note

Face matching uses **face-api.js** in the browser (already AI). No extra AI license required for MVP.
