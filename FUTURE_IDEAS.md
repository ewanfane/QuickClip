# QuickClip — Future Ideas & Architectural Roadmap

This document outlines high-impact feature concepts and enhancements to expand QuickClip into an indispensable office staple and cross-platform productivity hub.

---

## 🎯 Target Use Cases & Personas

1. **The Multi-Device Power User (e.g. Mac ↔ Windows Dual-Desk)**
   - Developers, designers, and engineers operating across different operating systems simultaneously (e.g. coding on macOS, gaming/testing on Windows, testing mobile on iOS/Android).
   - Needs frictionless clipboard and file movement without emailing oneself, plugging in USB drives, or dealing with OS-walled gardens (AirDrop).
2. **The Ad-Hoc Office & Team Room**
   - Colleagues sitting near each other or in a temporary meeting needing to quickly share snippets, links, design mocks, or logs without cluttering persistent Slack channels, creating email threads, or creating new accounts.

---

## 💡 Feature Concepts & Reasoning

### 1. Workday TTL & "Keep-Alive" Mode
* **Utility**: The default 20-minute ephemeral wipe is perfect for one-off burner sharing, but actively interrupts all-day dual-desk workflows.
* **Proposed Design**:
  * **Session Preset Selector**: Dropdown when creating a session:
    * `20 minutes` (Quick Drop / Burner)
    * `2 hours` (Meeting Mode)
    * `8 hours` (Full Workday)
  * **"Extend +30m" Button**: Quick one-click tap on the radial timer ring to extend the session during active work.
  * **Peer-Presence Keep-Alive**: Optional toggle to keep the session alive as long as at least 2 active devices (e.g., your Mac and Windows machine) maintain an open WebSocket connection.

---

### 2. Custom Named Rooms / Vanity Slugs (e.g. `/room/ewan-desk`)
* **Utility**: Entering a random 5-digit PIN every morning introduces unnecessary friction.
* **Proposed Design**:
  * Allow rooms to have memorable alphanumeric slugs: `http://quickclip.local/?room=ewan-desk` or `http://quickclip.local/?room=boardroom-1`.
  * Users can bookmark their personal room on all their machines and browsers, instantly connecting upon launch without scanning QR codes or copying PINs.

---

### 3. Local Subnet (LAN) Peer Auto-Discovery ("Zero-Code AirDrop")
* **Utility**: When multiple devices are on the same Wi-Fi network, requiring a PIN code creates an extra step.
* **Proposed Design**:
  * Detect peers connected to the same local IP or network subnet.
  * Display a lightweight "Nearby Devices" radar bar with device tags (e.g., `MacBook Pro`, `Windows 11 Workstation`, `Pixel Phone`).
  * Clicking a device opens an instant direct P2P pipe to beam clips directly without having to exchange room codes first.

---

### 4. Direct Screen Snipping & Window Capture
* **Utility**: Cross-OS bug reporting, design feedback, and code sharing frequently require screenshots. Saving an image to disk and then uploading it wastes time.
* **Proposed Design**:
  * Add a **"Capture Screen / Snippet"** button in the capture dock utilizing the browser's native `navigator.mediaDevices.getDisplayMedia`.
  * Allows selecting a specific window, screen, or tab; captures an instant lossless snapshot, encrypts it in client memory, and pushes it directly into the room.

---

### 5. Multi-User Sender Avatars & Device Badges
* **Utility**: In a meeting or team session with 4–5 people, identical clip cards make it difficult to determine who contributed what.
* **Proposed Design**:
  * Optional, lightweight prompt for a sender display name or icon (e.g., `Alex (Mac)`, `Ewan (Windows)`).
  * Automatically display OS platform icons ( Apple, ⊞ Windows, 🐧 Linux, 📱 Mobile) on clip badges for immediate recognition.

---

### 6. Subtle Audio Chime & Desktop Notifications
* **Utility**: When working across two desks or monitors, users need confirmation that a clip has arrived on the target machine without constantly glancing over.
* **Proposed Design**:
  * Subtle, non-intrusive sound chime (toggleable / mute option) upon receiving a new clip from a peer.
  * Native browser notification integration (`navigator.serviceWorker.showNotification`) displaying a brief preview when the tab is running in the background.

---

### 7. Collaborative Live Scratchpad (Shared Meeting Notes)
* **Utility**: Individual clip cards are ideal for distinct files or snippets, but meetings often require a continuous, shared working surface.
* **Proposed Design**:
  * A secondary dock tab for a **Live Shared Markdown Scratchpad**.
  * Multi-cursor or real-time text sync over WebSockets for drafting meeting minutes, agendas, or scratch lists.
  * One-click "Copy All as Markdown" or "Export as Document" button.

---

### 8. Batch "Download All as ZIP" & Feed Filter Controls
* **Utility**: When 10+ photos or documents are dropped into a room, clicking download on each card is repetitive. Finding specific snippets in an active feed can also be difficult.
* **Proposed Design**:
  * Filter pills at the top of the feed: `All`, `Media`, `Links`, `Files`, `Code`.
  * A "Download All as ZIP" action that client-side zips all decrypted files in memory using JSZip, generating a single archive download.

---

### 9. Ephemeral Link Preview Unfurling (Zero-Leak)
* **Utility**: When pasting URLs, users appreciate seeing page titles and favicons rather than raw text.
* **Proposed Design**:
  * Client-side metadata parsing or safe backend metadata proxy with no tracking cookies to unfurl title, site name, and icon for pasted links.

---

### 10. CLI Integration (`quickclip` terminal tool)
* **Utility**: Power users and developers on macOS, Linux, and Windows terminal want to pipe terminal output or files directly into QuickClip:
  * `cat error.log | quickclip --room ewan-desk`
  * `quickclip file.zip`
* **Proposed Design**:
  * A tiny standalone shell script or Python/curl wrapper that speaks to the `/api/room/{code}/upload` endpoint.
