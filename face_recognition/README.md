# Face photo finder (HSF media)

Free tool: media uploads all photos → students scan their face → download only matching pictures.

## URLs
- Find photos: `/face_recognition/` or `/face_recognition/index.html`
- Media upload: `/face_recognition/upload.html`

## Setup
1. Restart Flask backend (`python backend/app.py`).
2. Optional in `backend/.env`: `FACE_MEDIA_PIN=yourpin` (default `hsfmedia`).
3. Media: open upload page → PIN → create event → upload images.
4. Students: open find page → choose event → camera → scan → find matches.

## Tech (no paid face API)
- Upload/storage: Flask + local `face_recognition/uploads/`
- Matching: [face-api.js](https://github.com/vladmandic/face-api) in the browser (CDN models)

## Notes
- Works best with clear faces and good light.
- Large events (hundreds of photos) may take a while on phones — match runs on the device.
- Ask for consent before using face matching at club events.
