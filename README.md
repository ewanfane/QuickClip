# QuickClip 🚀

> **Instant, Zero-Knowledge Cross-Device Copy & Paste**  
> *No accounts. No logs. No emailing yourself files. 100% Self-Contained.*  
>
> 🌐 **Live Web App:** [https://quickclip.badduck.ie](https://quickclip.badduck.ie)

---

## ⚡ The Problem QuickClip Solves
How often do you email yourself a link, photo, code snippet, or PDF just to move it from your phone to your PC or vice-versa?

**QuickClip** replaces that tedious dance with a temporary, real-time shared clipboard. Open QuickClip on your devices (or try the live instance at [quickclip.badduck.ie](https://quickclip.badduck.ie)), pair them with a 5-digit code or QR scan, and paste. Text, screenshots, photos, and files synchronize instantly across screens. When you're done, the session automatically wipes clean from memory after 20 minutes—leaving zero traces on the server.

---

## ✨ Core Features

### 🔒 Zero-Knowledge End-to-End Encryption (AES-GCM-256)
- **PBKDF2 Key Derivation**: Each 5-digit PIN derives a unique 256-bit AES-GCM key inside the browser using 100,000 rounds of SHA-256 PBKDF2 with session salting.
- **Client-Side Encrypted Text**: Text snippets and clipboard pastes are encrypted with AES-256-GCM and unique 12-byte IVs (`enc:v1:...`) before leaving your device.
- **Encrypted Binary File Envelope (`QCE1`)**: Files uploaded to the server are wrapped in an encrypted binary container (`QCE1` magic header + IV + encrypted metadata header + encrypted payload). The server only stores `encrypted.bin`.
- **Zero Raw Server Memory**: The server operator, hosting provider, or network eavesdropper cannot read your plaintext, inspect filenames, or preview images. Decryption happens entirely in client memory.

### 🌐 WebRTC P2P Direct Streaming for Large Files
- **Zero Server Bandwidth for Heavy Files**: Files larger than 10 MB bypass server storage completely and stream device-to-device via chunked `RTCDataChannel` (64 KB chunks).
- **Adaptive Backpressure**: Built-in flow control prevents browser memory exhaustion during multi-gigabyte transfers.
- **Direct Local Network Transfers**: Uses WebRTC host candidates over local Wi-Fi or STUN fallback.
- **Strict 10 MB Server Protection**: Standard uploads to the server enforce a hard 10 MB limit (HTTP 413) to protect memory and bandwidth.

### 📲 Progressive Web App (PWA) & Web Share Target
- **Installable Native Feel**: Install QuickClip as a standalone app on iOS, Android, macOS, Windows, and Linux.
- **System Share Sheet Integration**: Built-in **Web Share Target** allows you to share photos, links, or text directly into QuickClip from your phone's native "Share" menu.
- **Offline Shell**: Service Worker caches all core app shell assets for instant sub-millisecond launches.

### 🛡️ 100% Self-Contained & Air-Gapped
- **Zero External Dependencies**: QuickClip makes **zero external API calls**. No external analytics, no CDNs, and no external web fonts (renders with optimized native system typography).
- **In-Memory IP Rate Limiting**: Sliding-window rate limiter prevents session exhaustion and spam without burning client CPU or introducing friction.
- **Zero Bot Friction**: Room joining, creation, and uploads execute instantaneously (sub-50ms) without CAPTCHAs, cookies, or PoW delays.

### 🎬 Rich In-Browser Media Viewing & Playback
- **Inline Image Viewing & Zoom**: Automatic client-side decryption of photos and screenshots; click to expand in high-res lightbox modal.
- **HTML5 Video Player**: Stream MP4, WebM, and MOV videos directly in-browser with scrubber, fullscreen, and dedicated Theater View modal.
- **Inline Audio Player**: Listen to audio clips (MP3, WAV, OGG, M4A, FLAC) with custom playback scrubber.
- **PDF Document Quick View**: Inspect and read PDFs in an interactive in-browser modal without having to download them to disk.
- **Code & Text Snippet Viewer**: Syntax-styled monospace previews for source files (`.py`, `.js`, `.json`, `.md`, `.txt`, `.csv`) with one-click clipboard copying.

### 📋 Seamless Input Everywhere
- **Global `Ctrl+V` / `Cmd+V`**: Press paste anywhere on the screen—QuickClip captures text, clipboard screenshots, and copied files automatically.
- **Drag & Drop Zone**: Drop files directly onto the window to share them.
- **One-Click Native Paste**: Mobile-friendly clipboard button requesting system clipboard permission.
- **One-Click Copy & Download**: Instant visual feedback for copying text, copying images to system clipboard, and downloading files with decrypted names.
- **Non-Intrusive P2P**: Files streamed via WebRTC direct transfer are viewable and playable directly in the browser upon receipt.

### ⏱️ Ephemeral Sessions & Zero-Log Architecture
- **5-Digit Room Codes**: Simple numeric PINs (e.g., `83921`) with instant QR code scanning.
- **Dynamic Countdown Timer**: Live SVG radial countdown ring showing remaining session time with color transitions (cyan → amber → red).
- **Automatic 20-Minute Eviction**: Sessions and all associated in-memory clips automatically vanish after 20 minutes.
- **Instant Burn Button**: Immediately wipes the room from server memory on demand and disconnects all connected peers.
- **Zero Disk Persistence**: No SQL/NoSQL database, no disk cache, and Uvicorn access logging disabled (`--no-access-log`).

---

## 🏗️ Architecture & Security Model

| Feature | Standard Transfer (Text / Light Files < 10 MB) | Direct P2P Transfer (Large Files > 10 MB) |
|---|---|---|
| **Transfer Channel** | WebSocket + ASGI HTTP | WebRTC `RTCDataChannel` |
| **Server Storage** | Opaque Ciphertext in RAM (max 20 mins) | **Zero** (Server only relays signaling) |
| **Encryption** | Client-Side AES-GCM-256 (`QCE1` Envelope) | DTLS / SCTP WebRTC Transport Encryption |
| **Max File Size** | 10 MB | Multi-Gigabyte (Device capability) |
| **Decryption** | Client Browser RAM | Client Browser RAM |

---

## 🌐 Try It Live

You can try the official hosted deployment of QuickClip directly in your browser:  
👉 **[https://quickclip.badduck.ie](https://quickclip.badduck.ie)**

---

## 🐳 Quick Start with Docker

The fastest way to run QuickClip is with Docker Compose:

```bash
docker compose up --build -d
```

Open your browser at:
```text
http://localhost:8081
```

To stop the container:
```bash
docker compose down
```

---

## 💻 Running Locally (Python)

### 1. Prerequisites
- Python 3.10+
- Modern web browser (Chrome, Safari, Firefox, Edge)

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the ASGI Server
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8081 --reload --no-access-log
```

Open `http://localhost:8081` or `http://<your-lan-ip>:8081` on any phone, tablet, or laptop on your local Wi-Fi.

---

## 🧪 Running Automated Tests

QuickClip includes an automated test suite verifying zero external calls, zero-knowledge encrypted storage, WebRTC signaling, PWA routes, media type detection, 10 MB upload limits, and auto-wipe mechanics:

```bash
docker compose run --rm quickclip sh -c "pip install pytest httpx >/dev/null 2>&1 && PYTHONPATH=. pytest tests/ -v"
```

---

## 📁 Project Structure

```text
quickclip/
├── app/
│   ├── main.py              # FastAPI ASGI app (WebSockets, upload endpoint, media detection)
│   ├── session_manager.py   # Ephemeral room state, peer tracking, 20-min auto-wipe
│   ├── models.py            # Clip and Room data models (image, video, audio, pdf, code, file)
│   └── rate_limiter.py      # Sliding-window in-memory IP rate limiter
├── static/
│   ├── index.html           # UI shell with PIN blocks, radial timer, QR & media modals
│   ├── manifest.json        # PWA Web App Manifest with Web Share Target
│   ├── sw.js                # Service Worker for offline asset caching
│   ├── css/
│   │   └── style.css        # Vanilla CSS design system (native fonts, media players)
│   ├── js/
│   │   ├── app.js           # Frontend orchestrator, UI binding, media players & lightboxes
│   │   ├── crypto.js        # Web Crypto API: PBKDF2 key derivation & AES-GCM-256 E2EE
│   │   ├── webrtc.js        # WebRTC P2P direct file streaming engine (RTCDataChannel)
│   │   └── qrcode.min.js    # Self-contained pure JS canvas QR generator
│   └── assets/              # App icons, favicons, and QuickClip brand glyph
├── tests/
│   └── test_quickclip.py    # Pytest test suite (9 comprehensive test cases)
├── Dockerfile               # Multi-stage container definition
├── docker-compose.yml       # Production-ready Docker Compose configuration
└── requirements.txt         # Python dependencies (FastAPI, Uvicorn, etc.)
```

---

## 🔒 Privacy & Threat Model

1. **Zero Logging**: Uvicorn runs with `--no-access-log`. No IP addresses or request URLs are recorded to disk.
2. **Zero Plaintext Storage**: Clips are encrypted in client memory using Web Crypto AES-GCM before transmission. The server cannot inspect clip contents, image previews, or file contents.
3. **Ephemeral Memory Only**: Rooms and encrypted clips exist purely in Python memory (`dict`) and are deleted immediately on expiry (20 min) or upon pressing **Burn Session**.
4. **Air-Gapped Operation**: No assets or fonts are loaded from third-party networks, preventing third-party tracking.

---

## 📄 License
MIT License. Free for personal and commercial use.
