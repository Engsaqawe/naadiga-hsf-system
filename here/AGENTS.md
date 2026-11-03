# AGENTS.md — context for Cursor / coding agents

Read this and `.cursor/rules/` before large changes.

## What this project is
Standalone **Find Photos** product kit (event photos + face match). Extracted from HSF portal; **not** the HSF membership system.

## Product goals
1. Organizer uploads event albums.
2. Guests find photos with one selfie (or QR → selfie), download only theirs.
3. Privacy: Accept/Reject before face use; bilingual (Somali + English) user-facing copy.
4. Somalia/region first; global tools exist — win on local UX and simplicity.
5. MVP AI = browser **face-api.js**. No paid cloud face APIs unless necessary later.

## Organizer home
Media Gallery first — not a student-style dashboard. Profile + Settings exist; no HSF meetings/payments UI.

## Important behaviors already designed in the HSF source
- Faster uploads: compress + batch; emails in background.
- **Delete downloaded photos**: remove files, keep download history, scrub My Photos, notify users.
- Blur downloaded thumbnails in admin when `anyone_downloaded` is true.
- Media Admin role (in HSF); here becomes organizer account in a future thin backend.

## Do not
- Port entire HSF (reports, summer courses, convocations, etc.).
- Store face data without consent.
- Block upload HTTP on sending hundreds of emails.

## Entry files
| Surface | Path |
|---------|------|
| Guest find | `face_recognition/index.html` |
| Standalone upload UI | `face_recognition/upload.html` |
| Media admin | `portal/pages/media-admin/dashboard.html` |
| Portal-style find | `portal/pages/student/find-my-photos.html` |
| API | `backend/routes/face_photos_api.py` |

## Deeper brief
See `PRODUCT.md` and `README.md`.
