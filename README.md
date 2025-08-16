# YouTube/Media Downloader (Flask + yt-dlp)

A lightweight Flask web app to fetch available formats and download media using **yt-dlp**.  
It first tries to return a **direct client-side URL** for the chosen format; if unavailable, it **falls back** to a **server-side download + merge** (requires FFmpeg).

> ⚠️ **Legal & Ethical Use**  
> This project is for educational/testing purposes. Download content **only** if you have the right to do so. Respect the source platform’s **Terms of Service**, copyright laws, and local regulations.

---

## ✨ Features
- Get video/audio **formats** with labels (resolution, ext, type, size).
- **Direct download URL** when possible (no server bandwidth).
- **Fallback server-side merge** to MP4 (needs FFmpeg in PATH).
- Clean error handling and filename sanitization.

---

## 🧱 Tech Stack
- **Backend:** Python, Flask, yt-dlp
- **Runtime tools:** FFmpeg (for merges)
- **Frontend:** (Your `templates/index.html` + static assets)

---

## 📂 Project Structure
