# PRODUCT.md — Find Photos (handoff brief)

Use this when opening this folder as its own Cursor project so context survives outside the old HSF chat.

## Origin
Built inside **nahsf system** (HSF club portal) as Find My Photos + Media Admin. Copied into this kit folder (`here`) to become a **separate official product** with its own domain later.

## Problem
Event guests cannot scroll thousands of photos. They want: selfie → only pictures of me → download. Organizers want less support load and optional disk cleanup after guests already downloaded.

## Solution (core loop)
1. Organizer creates event, uploads photos.
2. Guest opens link/QR, accepts privacy, takes selfie or uploads face photo.
3. Client-side face-api matches against event images.
4. Guest downloads matches; organizer sees who downloaded; can delete already-downloaded files to free space while keeping history.

## Market
- **Category exists globally** (SnapSeek, SnapFind, Eventiere, InItPic, 9Pic FaceFind, etc.).
- **Somalia / local region**: believed underserved → go-to-market advantage (language, schools/clubs, simple flow), not invention claim.
- Compete on: bilingual UX, privacy clarity, price, WhatsApp/QR ease — not on inventing face search.

## Tech
| Layer | Choice |
|-------|--------|
| Match AI | `@vladmandic/face-api` in browser (neural nets — already AI) |
| Storage (HSF era) | Files under `face_recognition/uploads/{event}/` + JSON meta |
| API | Flask blueprint `face_photos_api.py` |
| Admin UI | `portal/pages/media-admin/` |
| Guest UI | `face_recognition/` and/or portal find pages |

**Enough for MVP.** Server-side indexing / stronger models / VPS = optional when galleries get huge or accuracy hurts. Cost barrier is mostly **time + hosting**, not mandatory expensive licenses. Avoid per-photo cloud AI bills before revenue.

## Privacy (decided direction)
- Accept / Reject before camera or selfie.
- Reject = no processing/storage of face for match.
- Prefer ephemeral selfie; clear retention messaging.
- Delete-downloaded: files gone, matches scrubbed, users notified; **history table kept**.

## Features already in the HSF-derived code (bring forward)
- Events, batch upload + compress, background “photos ready” email pattern.
- Download tracking, blur downloaded in admin, filters/sort.
- Delete downloaded photos (disk free) vs erase all vs (old wrong) clear history only.
- My Photos / matches persistence patterns (portal).
- Media Admin first page = Gallery (not student dashboard).

## Still to build for true separation
- [ ] Own brand name + domain
- [ ] Thin Flask (or other) app: register blueprint, config, mail, storage paths
- [ ] Organizer signup/login (not HSF `hsf_current_user`)
- [ ] Public guest event URL/QR without club membership
- [ ] First-class privacy Accept/Reject screens
- [ ] Optional payments later
- [ ] Strip remaining HSF-only assumptions from `email_helpers` / components

## Non-goals
HSF payments, attendance, summer courses, Quran contest, main-leader member CRM as part of this product.

## How agents should work
Follow `.cursor/rules/*.mdc` and `AGENTS.md`. Prefer small diffs. Ask before inventing billing or cloud face APIs.
