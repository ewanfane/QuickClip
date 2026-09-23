/**
 * QuickClip v2.1 - Real-time ASGI WebSocket, PWA & WebRTC P2P Transfer
 */

(function () {
  'use strict';

  // State
  let currentRoomCode = null;
  let currentCryptoKey = null;
  let localPeerId = null;
  let remainingSeconds = 1200;
  const TOTAL_SECONDS = 1200;
  const CIRCLE_CIRCUMFERENCE = 113.1;
  const STANDARD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB limit
  let timerInterval = null;
  let ws = null;
  let reconnectTimeout = null;
  let clips = [];
  let deferredInstallPrompt = null;

  // DOM Elements
  const digitEls = [
    document.getElementById('digit-0'),
    document.getElementById('digit-1'),
    document.getElementById('digit-2'),
    document.getElementById('digit-3'),
    document.getElementById('digit-4'),
  ];
  const timerText = document.getElementById('timer-text');
  const timerRing = document.getElementById('timer-ring');
  const peerCountText = document.getElementById('peer-count-text');
  const clipsFeed = document.getElementById('clips-feed');
  const emptyState = document.getElementById('empty-state');
  const clipsCountPill = document.getElementById('clips-count-pill');
  const textInput = document.getElementById('text-input');
  const btnSendText = document.getElementById('btn-send-text');
  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  const btnPickFile = document.getElementById('btn-pick-file');
  const fileInput = document.getElementById('file-input');
  const dropTarget = document.getElementById('drop-target');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const btnShowQr = document.getElementById('btn-show-qr');
  const btnNewRoom = document.getElementById('btn-new-room');
  const btnJoinModal = document.getElementById('btn-join-modal');
  const btnBurnSession = document.getElementById('btn-burn-session');
  const btnClearAll = document.getElementById('btn-clear-all');
  const btnInstallPwa = document.getElementById('btn-install-pwa');

  // P2P Panel Elements
  const p2pPanel = document.getElementById('p2p-panel');
  const p2pFilename = document.getElementById('p2p-filename');
  const p2pStatus = document.getElementById('p2p-status');
  const p2pFill = document.getElementById('p2p-fill');
  const p2pBytes = document.getElementById('p2p-bytes');
  const p2pSpeed = document.getElementById('p2p-speed');
  const p2pPct = document.getElementById('p2p-pct');
  const p2pBadge = document.getElementById('p2p-badge');

  const btnHowModal = document.getElementById('btn-how-modal');
  const howModal = document.getElementById('how-modal');
  const howModalClose = document.getElementById('how-modal-close');

  const qrModal = document.getElementById('qr-modal');
  const qrContainer = document.getElementById('qr-container');
  const modalCodeDigits = document.getElementById('modal-code-digits');
  const qrModalClose = document.getElementById('qr-modal-close');

  const joinModal = document.getElementById('join-modal');
  const joinCodeInput = document.getElementById('join-code-input');
  const btnSubmitJoin = document.getElementById('btn-submit-join');
  const btnCancelJoin = document.getElementById('btn-cancel-join');
  const joinModalClose = document.getElementById('join-modal-close');

  const zoomModal = document.getElementById('zoom-modal');
  const zoomedImage = document.getElementById('zoomed-image');
  const zoomModalClose = document.getElementById('zoom-modal-close');

  // Video Theater Modal
  const videoModal = document.getElementById('video-modal');
  const videoModalClose = document.getElementById('video-modal-close');
  const modalVideoPlayer = document.getElementById('modal-video-player');
  const videoModalTitle = document.getElementById('video-modal-title');

  // PDF Quick View Modal
  const pdfModal = document.getElementById('pdf-modal');
  const pdfModalClose = document.getElementById('pdf-modal-close');
  const pdfModalFrame = document.getElementById('pdf-modal-frame');
  const pdfModalTitle = document.getElementById('pdf-modal-title');
  const pdfModalOpenTab = document.getElementById('pdf-modal-open-tab');

  // Text / Code Snippet Modal
  const codeModal = document.getElementById('code-modal');
  const codeModalClose = document.getElementById('code-modal-close');
  const codeModalContent = document.getElementById('code-modal-content');
  const codeModalTitle = document.getElementById('code-modal-title');
  const codeModalCopy = document.getElementById('code-modal-copy');

  const toastContainer = document.getElementById('toast-container');

  function detectMediaType(name = '', mime = '', customType = null) {
    if (customType && ['image', 'video', 'audio', 'pdf', 'code', 'file'].includes(customType)) {
      return customType;
    }
    const mimeLower = (mime || '').toLowerCase();
    const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();

    if (mimeLower.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext)) {
      return 'image';
    }
    if (mimeLower.startsWith('video/') || ['mp4', 'webm', 'ogg', 'mov', 'm4v', 'mkv'].includes(ext)) {
      return 'video';
    }
    if (mimeLower.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'weba'].includes(ext)) {
      return 'audio';
    }
    if (mimeLower === 'application/pdf' || ext === 'pdf') {
      return 'pdf';
    }
    if (['txt', 'md', 'json', 'js', 'py', 'html', 'css', 'csv', 'xml', 'yaml', 'yml', 'sh', 'sql', 'c', 'cpp', 'ts', 'jsx', 'tsx'].includes(ext)) {
      return 'code';
    }
    return 'file';
  }

  // --- Service Worker & PWA Install ---

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (btnInstallPwa) {
      btnInstallPwa.style.display = 'inline-flex';
    }
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          btnInstallPwa.style.display = 'none';
        }
        deferredInstallPrompt = null;
      }
    });
  }

  // --- Web Share Target Handler ---
  function handleWebShareTarget() {
    const params = new URLSearchParams(window.location.search);
    const sharedText = params.get('share_text') || params.get('text');
    const sharedUrl = params.get('share_url') || params.get('url');
    const sharedTitle = params.get('share_title') || params.get('title');

    const content = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n').trim();
    if (content) {
      textInput.value = content;
      showToast('Shared content loaded into composer', 'info');
    }
  }

  // --- Utility Functions ---

  function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `app-toast ${type}`;
    toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatRelativeTime(timestamp) {
    const diff = Math.floor(Date.now() / 1000 - timestamp);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    return 'Earlier';
  }

  function formatTimer(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // --- WebRTC Progress & Receiver Callbacks ---

  function setupWebRTCCallbacks() {
    if (!window.webrtcManager) return;

    window.webrtcManager.init(localPeerId, (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }, {
      onProgress: (info) => {
        p2pPanel.classList.add('active');
        p2pFilename.textContent = info.name;
        p2pBadge.textContent = info.direction === 'send' ? '⚡ P2P Sending' : '⚡ P2P Receiving';
        p2pStatus.textContent = info.completed ? 'Completed' : 'Streaming Direct';
        p2pFill.style.width = `${info.percent}%`;
        p2pBytes.textContent = `${formatBytes(info.transferred)} / ${formatBytes(info.total)}`;
        p2pSpeed.textContent = `${formatBytes(info.speed)}/s`;
        p2pPct.textContent = `${info.percent}%`;

        if (info.completed) {
          setTimeout(() => {
            p2pPanel.classList.remove('active');
          }, 3500);
        }
      },
      onFileReceived: (fileData) => {
        showToast(`Received ${fileData.name} via direct P2P!`, 'success');
        const mediaType = detectMediaType(fileData.name, fileData.mime_type);
        
        // Add to local feed with rich in-browser playback/viewing
        const p2pClip = {
          id: fileData.id,
          type: mediaType,
          is_p2p: true,
          content: null,
          file_name: fileData.name,
          file_size: fileData.size,
          mime_type: fileData.mime_type,
          download_url: fileData.downloadUrl,
          created_at: Date.now() / 1000
        };
        clips.unshift(p2pClip);
        renderClips();
      }
    });
  }

  // --- Room Discovery & Initialization ---

  function getRoomCodeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryRoom = params.get('room');
    if (queryRoom && queryRoom.length === 5 && /^\d+$/.test(queryRoom)) {
      return queryRoom;
    }
    const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
    if (path && path.length === 5 && /^\d+$/.test(path)) {
      return path;
    }
    return null;
  }

  let activeInitId = 0;

  async function initRoom(requestedCode = null) {
    const initId = ++activeInitId;
    try {
      let roomData = null;

      if (requestedCode) {
        // Direct lookup for joining existing room
        try {
          const checkRes = await fetch(`/api/room/${requestedCode}`);
          if (initId !== activeInitId) return false;

          if (checkRes.ok) {
            const data = await checkRes.json();
            if (data.success && data.room) {
              roomData = data.room;
            }
          } else if (checkRes.status === 404) {
            showToast(`Session ${requestedCode} not found or has expired`, 'warning');
            return false;
          }
        } catch (err) {
          console.warn('Room check error:', err);
        }
      }

      // If creating a fresh room (or code was provided to initialize a new room)
      if (!roomData) {
        const payload = {};
        if (requestedCode) payload.code = requestedCode;

        const res = await fetch('/api/room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (initId !== activeInitId) return false;

        const data = await res.json();
        if (data.success && data.room) {
          roomData = data.room;
        } else {
          showToast(data.detail || 'Failed to initialize session', 'warning');
          return false;
        }
      }

      if (roomData) {
        currentRoomCode = roomData.code;
        remainingSeconds = roomData.remaining_seconds;
        clips = roomData.clips || [];

        if (window.quickclipCrypto) {
          currentCryptoKey = await window.quickclipCrypto.deriveKey(currentRoomCode);
        }
        if (initId !== activeInitId) return false;

        const newUrl = `${window.location.origin}/?room=${currentRoomCode}`;
        window.history.replaceState({ room: currentRoomCode }, '', newUrl);

        renderRoomState();
        connectWebSocket();
        startTimer();
        return true;
      }
      return false;
    } catch (err) {
      if (initId !== activeInitId) return false;
      console.error('Session init error:', err);
      showToast('Network error initializing session', 'warning');
      return false;
    }
  }

  function renderRoomState() {
    if (currentRoomCode && currentRoomCode.length === 5) {
      for (let i = 0; i < 5; i++) {
        if (digitEls[i]) {
          digitEls[i].textContent = currentRoomCode[i];
          digitEls[i].classList.remove('loading');
        }
      }
    }
    if (modalCodeDigits) modalCodeDigits.textContent = currentRoomCode;
    renderClips();
  }

  // --- WebSocket Connection ---

  function connectWebSocket() {
    if (ws) {
      ws.close();
      ws = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${currentRoomCode}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      peerCountText.textContent = 'Syncing...';
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('WebSocket parse error:', err);
      }
    };

    ws.onclose = (event) => {
      peerCountText.textContent = 'Disconnected';
      if (event.reason === 'Session expired') {
        handleExpiredSession();
        return;
      }
      if (!reconnectTimeout && remainingSeconds > 0) {
        reconnectTimeout = setTimeout(connectWebSocket, 2500);
      }
    };

    ws.onerror = () => {
      peerCountText.textContent = 'Connection Issue';
    };
  }

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init':
        localPeerId = msg.peer_id;
        clips = msg.room.clips || [];
        remainingSeconds = msg.room.remaining_seconds;
        updatePeerCount(msg.peer_count);
        if (window.webrtcManager) {
          setupWebRTCCallbacks();
          window.webrtcManager.setKnownPeers(msg.peers);
        }
        renderClips();
        break;

      case 'peer_count':
        updatePeerCount(msg.count);
        if (window.webrtcManager && msg.peers) {
          window.webrtcManager.setKnownPeers(msg.peers);
        }
        break;

      case 'p2p_signal':
        if (window.webrtcManager) {
          window.webrtcManager.handleSignalingMessage(msg.sender_peer_id, msg.signal);
        }
        break;

      case 'clip_added':
        if (!clips.some((c) => c.id === msg.clip.id)) {
          clips.unshift(msg.clip);
          renderClips();
          showToast('New clip received!', 'success');
        }
        break;

      case 'clip_deleted':
        clips = clips.filter((c) => c.id !== msg.clip_id);
        renderClips();
        showToast('Clip deleted', 'info');
        break;

      case 'room_cleared':
        clips = [];
        renderClips();
        showToast('All clips cleared', 'info');
        break;

      case 'session_expired':
      case 'room_burned':
        handleExpiredSession(msg.message);
        break;

      case 'pong':
        if (msg.remaining_seconds !== undefined) {
          remainingSeconds = msg.remaining_seconds;
        }
        if (msg.peer_count !== undefined) {
          updatePeerCount(msg.peer_count);
        }
        break;
    }
  }

  function updatePeerCount(count) {
    if (count === 1) {
      peerCountText.textContent = '1 device (Ready)';
    } else if (count > 1) {
      peerCountText.textContent = `${count} devices (Live P2P)`;
    } else {
      peerCountText.textContent = 'Connected';
    }
  }

  function handleExpiredSession(msg) {
    if (timerInterval) clearInterval(timerInterval);
    timerText.textContent = '00:00';
    if (timerRing) timerRing.style.strokeDashoffset = CIRCLE_CIRCUMFERENCE;
    clips = [];
    renderClips();
    alert(msg || 'This 20-minute session has expired and all memory was wiped.');
    initRoom();
  }

  // --- Countdown Timer & Circular Ring ---

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    function tick() {
      if (remainingSeconds <= 0) {
        handleExpiredSession();
        return;
      }
      remainingSeconds--;
      timerText.textContent = formatTimer(remainingSeconds);

      if (timerRing) {
        const ratio = Math.max(0, remainingSeconds / TOTAL_SECONDS);
        const offset = CIRCLE_CIRCUMFERENCE * (1 - ratio);
        timerRing.style.strokeDashoffset = offset;

        if (remainingSeconds <= 120) {
          timerRing.style.stroke = 'var(--accent-danger)';
        } else if (remainingSeconds <= 300) {
          timerRing.style.stroke = 'var(--accent-warning)';
        } else {
          timerRing.style.stroke = 'var(--accent-cyan)';
        }
      }

      if (remainingSeconds % 10 === 0 && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'ping' }));
      }
    }

    timerText.textContent = formatTimer(remainingSeconds);
    timerInterval = setInterval(tick, 1000);
  }

  // --- Clips Feed Rendering ---

  async function renderClips() {
    clipsCountPill.textContent = clips.length;
    if (clips.length === 0) {
      emptyState.style.display = 'block';
      btnClearAll.style.display = 'none';
      const cards = clipsFeed.querySelectorAll('.clip-item-card');
      cards.forEach((c) => c.remove());
      return;
    }

    emptyState.style.display = 'none';
    btnClearAll.style.display = 'inline-flex';

    const fragment = document.createDocumentFragment();
    for (const clip of clips) {
      const card = await createClipCardElement(clip);
      fragment.appendChild(card);
    }

    const oldCards = clipsFeed.querySelectorAll('.clip-item-card');
    oldCards.forEach((c) => c.remove());
    clipsFeed.appendChild(fragment);
  }

  async function createClipCardElement(clip) {
    const card = document.createElement('div');
    card.className = 'clip-item-card';
    card.id = `clip-${clip.id}`;

    const effectiveType = clip.type === 'text' 
      ? 'text' 
      : detectMediaType(clip.file_name, clip.mime_type, clip.type !== 'p2p_file' && clip.type !== 'file' ? clip.type : null);

    let badgeClass = 'badge-txt';
    let badgeLabel = 'Text';
    if (clip.is_p2p || clip.type === 'p2p_file') {
      badgeClass = 'badge-p2p';
      badgeLabel = '⚡ P2P Direct';
    } else if (effectiveType === 'image') {
      badgeClass = 'badge-img';
      badgeLabel = 'Image';
    } else if (effectiveType === 'video') {
      badgeClass = 'badge-vid';
      badgeLabel = 'Video';
    } else if (effectiveType === 'audio') {
      badgeClass = 'badge-aud';
      badgeLabel = 'Audio';
    } else if (effectiveType === 'pdf') {
      badgeClass = 'badge-pdf';
      badgeLabel = 'PDF';
    } else if (effectiveType === 'code') {
      badgeClass = 'badge-code';
      badgeLabel = 'Code / Text';
    } else {
      badgeClass = 'badge-doc';
      badgeLabel = 'File';
    }

    let bodyHtml = '';
    let actionsHtml = '';
    let decryptedText = clip.content;

    // Helper to fetch & decrypt media in memory (zero-knowledge)
    let cachedDecrypted = null;
    async function getDecryptedMedia() {
      if (cachedDecrypted) return cachedDecrypted;
      if (clip.download_url && clip.download_url.startsWith('blob:')) {
        cachedDecrypted = {
          blob: null,
          downloadUrl: clip.download_url,
          name: clip.file_name,
          mimeType: clip.mime_type,
          size: clip.file_size
        };
        return cachedDecrypted;
      }
      if (clip.download_url) {
        const res = await fetch(clip.download_url);
        const buf = await res.arrayBuffer();
        if (currentCryptoKey && window.quickclipCrypto) {
          cachedDecrypted = await window.quickclipCrypto.decryptFile(buf, currentCryptoKey);
        } else {
          const b = new Blob([buf], { type: clip.mime_type || 'application/octet-stream' });
          cachedDecrypted = {
            blob: b,
            downloadUrl: URL.createObjectURL(b),
            name: clip.file_name,
            mimeType: clip.mime_type,
            size: clip.file_size
          };
        }
      }
      return cachedDecrypted;
    }

    if (effectiveType === 'text') {
      if (clip.content && clip.content.startsWith('enc:v1:') && currentCryptoKey && window.quickclipCrypto) {
        decryptedText = await window.quickclipCrypto.decryptText(clip.content, currentCryptoKey);
      }
      const isUrl = /^https?:\/\/[^\s]+$/i.test((decryptedText || '').trim());
      const displayContent = isUrl
        ? `<a href="${escapeHtml(decryptedText.trim())}" target="_blank" rel="noopener noreferrer">${escapeHtml(decryptedText)}</a>`
        : escapeHtml(decryptedText);

      bodyHtml = `<div class="item-body-text">${displayContent}</div>`;
      actionsHtml = `
        <button class="btn btn-primary btn-sm btn-copy-clip" data-id="${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Text
        </button>
      `;
    } else if (effectiveType === 'image') {
      bodyHtml = `
        <div class="item-body-image">
          <img src="${clip.content || ''}" alt="Image preview" class="zoomable-thumb" id="img-${clip.id}" style="${clip.content ? '' : 'display:none;'}" />
          <div class="media-skeleton" id="img-skel-${clip.id}" style="${clip.content ? 'display:none;' : ''}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Decrypting image preview...
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="view-img-${clip.id}" title="View image full size">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          View Full
        </button>
        <button class="btn btn-secondary btn-sm" id="copy-img-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Image
        </button>
        <button class="btn btn-secondary btn-sm" id="dl-img-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>
      `;
    } else if (effectiveType === 'video') {
      bodyHtml = `
        <div class="item-body-video">
          <video id="vid-${clip.id}" controls playsinline preload="metadata" style="display: none;"></video>
          <div class="media-skeleton" id="vid-skel-${clip.id}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            Preparing in-browser video player...
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="theater-vid-${clip.id}" title="Open video theater view">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>
          Theater View
        </button>
        <button class="btn btn-secondary btn-sm" id="dl-vid-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download Video
        </button>
      `;
    } else if (effectiveType === 'audio') {
      bodyHtml = `
        <div class="item-body-audio">
          <div class="audio-track-header">
            <div class="audio-glyph">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            </div>
            <div class="doc-info">
              <div class="doc-name" id="aud-name-${clip.id}" title="${escapeHtml(clip.file_name || 'Audio')}">${escapeHtml(clip.file_name || 'Audio Track')}</div>
              <div class="doc-size">${formatBytes(clip.file_size)} &bull; In-Browser Playback</div>
            </div>
          </div>
          <audio id="aud-${clip.id}" controls preload="metadata" style="display: none;"></audio>
          <div class="media-skeleton" id="aud-skel-${clip.id}" style="min-height: 48px;">
            Decrypting audio player...
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-secondary btn-sm" id="dl-aud-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download Audio
        </button>
      `;
    } else if (effectiveType === 'pdf') {
      bodyHtml = `
        <div class="item-body-file">
          <div class="doc-glyph" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <div class="doc-info">
            <div class="doc-name" id="doc-name-${clip.id}" title="${escapeHtml(clip.file_name || 'document.pdf')}">${escapeHtml(clip.file_name || 'Document.pdf')}</div>
            <div class="doc-size">${formatBytes(clip.file_size)} &bull; Viewable in Browser</div>
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="view-pdf-${clip.id}" title="Read PDF in browser without downloading">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Quick View (In-Browser)
        </button>
        <button class="btn btn-secondary btn-sm" id="dl-pdf-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>
      `;
    } else if (effectiveType === 'code') {
      bodyHtml = `
        <div class="item-body-file">
          <div class="doc-glyph" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          </div>
          <div class="doc-info">
            <div class="doc-name" id="doc-name-${clip.id}" title="${escapeHtml(clip.file_name)}">${escapeHtml(clip.file_name)}</div>
            <div class="doc-size">${formatBytes(clip.file_size)} &bull; Source / Text Document</div>
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="view-code-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          Preview Snippet
        </button>
        <button class="btn btn-secondary btn-sm" id="copy-code-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Text
        </button>
        <button class="btn btn-secondary btn-sm" id="dl-code-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>
      `;
    } else {
      // General File
      bodyHtml = `
        <div class="item-body-file">
          <div class="doc-glyph">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          </div>
          <div class="doc-info">
            <div class="doc-name" id="doc-name-${clip.id}" title="${escapeHtml(clip.file_name)}">${escapeHtml(clip.file_name)}</div>
            <div class="doc-size">${formatBytes(clip.file_size)} &bull; ${clip.is_p2p || clip.type === 'p2p_file' ? 'Direct P2P' : 'AES-256 Encrypted'}</div>
          </div>
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="dl-file-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download File
        </button>
      `;
    }

    card.innerHTML = `
      <div class="item-meta">
        <span class="item-badge ${badgeClass}">${badgeLabel}</span>
        <span class="item-time">${formatRelativeTime(clip.created_at)}</span>
      </div>
      ${bodyHtml}
      <div class="item-actions-bar">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          ${actionsHtml}
        </div>
        <button class="btn btn-danger btn-sm btn-delete-clip" data-id="${clip.id}" title="Delete clip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;

    // --- Attach Interactive Listeners per Type ---

    if (effectiveType === 'text') {
      const copyBtn = card.querySelector('.btn-copy-clip');
      copyBtn.addEventListener('click', () => copyTextToClipboard(decryptedText, copyBtn));

    } else if (effectiveType === 'image') {
      const imgEl = card.querySelector(`#img-${clip.id}`);
      const imgSkel = card.querySelector(`#img-skel-${clip.id}`);
      const copyImgBtn = card.querySelector(`#copy-img-${clip.id}`);
      const viewImgBtn = card.querySelector(`#view-img-${clip.id}`);
      const dlImgBtn = card.querySelector(`#dl-img-${clip.id}`);

      getDecryptedMedia().then((dec) => {
        if (dec && imgEl) {
          imgEl.src = dec.downloadUrl;
          imgEl.style.display = 'block';
          if (imgSkel) imgSkel.style.display = 'none';
        }
      }).catch(console.warn);

      if (viewImgBtn) {
        viewImgBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          openZoomModal(dec ? dec.downloadUrl : imgEl.src);
        });
      }

      if (imgEl) {
        imgEl.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          openZoomModal(dec ? dec.downloadUrl : imgEl.src);
        });
      }

      if (copyImgBtn) {
        copyImgBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.blob) copyImageBlobToClipboard(dec.blob, copyImgBtn);
          else showToast('Image format cannot be copied directly. Use Download.', 'info');
        });
      }

      if (dlImgBtn) {
        dlImgBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name || 'image.png');
        });
      }

    } else if (effectiveType === 'video') {
      const vidEl = card.querySelector(`#vid-${clip.id}`);
      const vidSkel = card.querySelector(`#vid-skel-${clip.id}`);
      const theaterBtn = card.querySelector(`#theater-vid-${clip.id}`);
      const dlVidBtn = card.querySelector(`#dl-vid-${clip.id}`);

      getDecryptedMedia().then((dec) => {
        if (dec && vidEl) {
          vidEl.src = dec.downloadUrl;
          vidEl.style.display = 'block';
          if (vidSkel) vidSkel.style.display = 'none';
        }
      }).catch(console.warn);

      if (theaterBtn) {
        theaterBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) {
            openVideoModal(dec.downloadUrl, dec.name || clip.file_name);
          }
        });
      }

      if (dlVidBtn) {
        dlVidBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name || 'video.mp4');
        });
      }

    } else if (effectiveType === 'audio') {
      const audEl = card.querySelector(`#aud-${clip.id}`);
      const audSkel = card.querySelector(`#aud-skel-${clip.id}`);
      const dlAudBtn = card.querySelector(`#dl-aud-${clip.id}`);

      getDecryptedMedia().then((dec) => {
        if (dec && audEl) {
          audEl.src = dec.downloadUrl;
          audEl.style.display = 'block';
          if (audSkel) audSkel.style.display = 'none';
        }
      }).catch(console.warn);

      if (dlAudBtn) {
        dlAudBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name || 'audio.mp3');
        });
      }

    } else if (effectiveType === 'pdf') {
      const viewPdfBtn = card.querySelector(`#view-pdf-${clip.id}`);
      const dlPdfBtn = card.querySelector(`#dl-pdf-${clip.id}`);

      if (viewPdfBtn) {
        viewPdfBtn.addEventListener('click', async () => {
          showToast('Decrypting PDF for in-browser view...', 'info', 1000);
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) {
            openPdfModal(dec.downloadUrl, dec.name || clip.file_name);
          }
        });
      }

      if (dlPdfBtn) {
        dlPdfBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name || 'document.pdf');
        });
      }

    } else if (effectiveType === 'code') {
      const viewCodeBtn = card.querySelector(`#view-code-${clip.id}`);
      const copyCodeBtn = card.querySelector(`#copy-code-${clip.id}`);
      const dlCodeBtn = card.querySelector(`#dl-code-${clip.id}`);

      async function getCodeText() {
        const dec = await getDecryptedMedia();
        if (dec && dec.blob) {
          return await dec.blob.text();
        }
        return '';
      }

      if (viewCodeBtn) {
        viewCodeBtn.addEventListener('click', async () => {
          showToast('Loading text snippet...', 'info', 800);
          const text = await getCodeText();
          openCodeModal(text, clip.file_name || 'Code Snippet');
        });
      }

      if (copyCodeBtn) {
        copyCodeBtn.addEventListener('click', async () => {
          const text = await getCodeText();
          if (text) copyTextToClipboard(text, copyCodeBtn);
        });
      }

      if (dlCodeBtn) {
        dlCodeBtn.addEventListener('click', async () => {
          const dec = await getDecryptedMedia();
          if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name || 'file.txt');
        });
      }

    } else {
      // General File
      const dlBtn = card.querySelector(`#dl-file-${clip.id}`);
      if (dlBtn) {
        dlBtn.addEventListener('click', async () => {
          showToast('Decrypting file in memory...', 'info', 1000);
          try {
            const dec = await getDecryptedMedia();
            if (dec && dec.downloadUrl) {
              triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name);
              showToast('Decrypted and downloaded!', 'success');
            }
          } catch (err) {
            console.error('File decryption failed:', err);
            showToast('Decryption failed', 'warning');
          }
        });
      }
    }

    const delBtn = card.querySelector('.btn-delete-clip');
    delBtn.addEventListener('click', () => deleteClip(clip.id));

    return card;
  }

  // --- Copy Actions ---

  async function copyTextToClipboard(text, btnElement) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnElement) {
        const originalHtml = btnElement.innerHTML;
        btnElement.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Copied!
        `;
        btnElement.style.background = 'var(--accent-teal)';
        btnElement.style.color = '#051424';
        setTimeout(() => {
          btnElement.innerHTML = originalHtml;
          btnElement.style.background = '';
          btnElement.style.color = '';
        }, 1800);
      }
      showToast('Text copied to clipboard!', 'success');
    } catch (err) {
      fallbackCopyText(text);
    }
  }

  function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    } catch (e) {
      showToast('Could not access clipboard automatically', 'warning');
    }
    document.body.removeChild(ta);
  }

  async function copyImageBitmapToClipboard(clip, btnElement) {
    try {
      const src = clip.content || clip.download_url;
      const res = await fetch(src);
      const blob = await res.blob();

      if (navigator.clipboard && window.ClipboardItem) {
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
          pngBlob = await convertBlobToPng(blob);
        }
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        if (btnElement) {
          const original = btnElement.innerHTML;
          btnElement.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Copied!
          `;
          setTimeout(() => (btnElement.innerHTML = original), 1800);
        }
        showToast('Image copied to clipboard!', 'success');
      } else {
        showToast('Direct image copy not supported. Use Download.', 'warning');
      }
    } catch (err) {
      console.error('Copy image error:', err);
      showToast('Could not copy image to clipboard', 'warning');
    }
  }

  function convertBlobToPng(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error('Conversion failed'));
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  // --- File Dispatcher: Server (<10MB) vs P2P Direct (>10MB) ---

  async function processFileDispatch(file, customType = null) {
    if (!currentRoomCode) return;
    const mediaType = customType || detectMediaType(file.name, file.type);

    // Check size against 10 MB standard transfer limit
    if (file.size > STANDARD_MAX_BYTES) {
      // Attempt P2P Direct Transfer
      const targetPeer = window.webrtcManager ? window.webrtcManager.getAvailableTargetPeer() : null;

      if (!targetPeer) {
        showToast(`Large file (${formatBytes(file.size)}). Connect your other device to stream direct via P2P!`, 'warning', 5000);
        return;
      }

      try {
        showToast(`Starting direct P2P stream: ${file.name}...`, 'info');
        await window.webrtcManager.sendFile(file, targetPeer);
        showToast(`Sent ${file.name} directly via P2P!`, 'success');
      } catch (err) {
        console.error('P2P stream failed:', err);
        showToast(`P2P transfer error: ${err.message}`, 'warning');
      }
      return;
    }

    // Standard HTTP upload for files under 10 MB
    await uploadFileStandard(file, mediaType);
  }

  function triggerFileDownload(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function copyImageBlobToClipboard(blob, btnElement) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        let pngBlob = blob;
        if (blob.type !== 'image/png') {
          pngBlob = await convertBlobToPng(blob);
        }
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob }),
        ]);
        if (btnElement) {
          const original = btnElement.innerHTML;
          btnElement.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            Copied!
          `;
          setTimeout(() => (btnElement.innerHTML = original), 1800);
        }
        showToast('Image copied to clipboard!', 'success');
      } else {
        showToast('Direct image copy not supported. Use Download.', 'warning');
      }
    } catch (err) {
      console.error('Copy image error:', err);
      showToast('Could not copy image to clipboard', 'warning');
    }
  }

  async function uploadFileStandard(file, customType = null) {
    const mediaType = customType || detectMediaType(file.name, file.type);
    let fileToUpload = file;
    let uploadName = file.name || 'item';

    if (currentCryptoKey && window.quickclipCrypto) {
      try {
        showToast('Encrypting with AES-256 in browser...', 'info', 1000);
        const encRes = await window.quickclipCrypto.encryptFile(file, currentCryptoKey);
        fileToUpload = encRes.encryptedBlob;
        uploadName = 'encrypted.bin';
      } catch (err) {
        console.warn('File encryption error:', err);
      }
    }

    const formData = new FormData();
    formData.append('file', fileToUpload, uploadName);
    formData.append('file_name', file.name || 'item');
    formData.append('mime_type', file.type || 'application/octet-stream');
    formData.append('custom_type', mediaType);

    try {
      showToast(`Uploading ${file.name || 'item'}...`, 'info', 1500);
      const res = await fetch(`/api/room/${currentRoomCode}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.detail || 'Upload failed', 'warning');
      } else {
        showToast('Encrypted clip stored!', 'success');
      }
    } catch (err) {
      console.error('Upload error:', err);
      showToast('Upload failed due to network issue', 'warning');
    }
  }

  async function sendTextMessage() {
    const text = textInput.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      let payloadText = text;
      if (currentCryptoKey && window.quickclipCrypto) {
        payloadText = await window.quickclipCrypto.encryptText(text, currentCryptoKey);
      }
      ws.send(JSON.stringify({
        action: 'add_text',
        text: payloadText,
      }));
      textInput.value = '';
      textInput.style.height = 'auto';
    } else {
      showToast('WebSocket reconnecting... please wait', 'warning');
    }
  }

  async function deleteClip(clipId) {
    // If local p2p clip, delete locally
    clips = clips.filter((c) => c.id !== clipId);
    renderClips();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        action: 'delete_clip',
        clip_id: clipId,
      }));
    }
  }

  async function clearAllClips() {
    if (!confirm('Clear all clips in this session?')) return;
    clips = [];
    renderClips();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'clear_all' }));
    }
  }

  async function burnSession() {
    if (!confirm('Burn this session immediately? All content will be wiped and cannot be recovered.')) return;
    try {
      await fetch(`/api/room/${currentRoomCode}/burn`, { method: 'POST' });
    } catch (e) {}
    handleExpiredSession('Session burned. Starting fresh room.');
  }

  // --- Global Keyboard & Paste Listeners ---

  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let fileFound = false;

    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const file = items[i].getAsFile();
          if (file) {
            e.preventDefault();
            fileFound = true;
            const isImg = file.type.startsWith('image/');
            processFileDispatch(file, isImg ? 'image' : 'file');
          }
        }
      }
    }

    if (fileFound) return;

    if (document.activeElement !== textInput && document.activeElement !== joinCodeInput) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        textInput.value = text;
        sendTextMessage();
        showToast('Pasted & sent from clipboard!', 'success');
      }
    }
  });

  btnPasteClipboard.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        let handled = false;
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              const file = new File([blob], `pasted-${Date.now()}.png`, { type });
              processFileDispatch(file, 'image');
              handled = true;
              break;
            }
          }
        }
        if (handled) return;
      }

      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          textInput.value = text;
          sendTextMessage();
          showToast('Pasted & sent from clipboard!', 'success');
          return;
        }
      }
      showToast('Clipboard is empty or permission denied', 'info');
    } catch (err) {
      console.warn('Clipboard read failed:', err);
      showToast('Click in the box and press Ctrl + V to paste', 'info');
    }
  });

  // Drag and Drop
  ['dragenter', 'dragover'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropTarget.classList.add('drag-over');
    });
  });

  ['dragleave', 'dragend'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX === 0 && e.clientY === 0) {
        dropTarget.classList.remove('drag-over');
      }
    });
  });

  dropTarget.addEventListener('dragleave', (e) => {
    if (e.target === dropTarget) {
      dropTarget.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropTarget.classList.remove('drag-over');

    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        processFileDispatch(dt.files[i]);
      }
    } else if (dt && dt.getData('text')) {
      textInput.value = dt.getData('text');
      sendTextMessage();
    }
  });

  textInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendTextMessage();
    }
  });

  btnSendText.addEventListener('click', sendTextMessage);

  // File Picker
  btnPickFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      for (let i = 0; i < fileInput.files.length; i++) {
        processFileDispatch(fileInput.files[i]);
      }
      fileInput.value = '';
    }
  });

  // Copy Code & Link
  btnCopyCode.addEventListener('click', () => {
    copyTextToClipboard(currentRoomCode, btnCopyCode);
  });

  btnCopyLink.addEventListener('click', () => {
    const fullUrl = `${window.location.origin}/?room=${currentRoomCode}`;
    copyTextToClipboard(fullUrl, btnCopyLink);
  });

  // How It Works Modal
  if (btnHowModal && howModal) {
    btnHowModal.addEventListener('click', () => howModal.classList.add('active'));
    if (howModalClose) howModalClose.addEventListener('click', () => howModal.classList.remove('active'));
    howModal.addEventListener('click', (e) => {
      if (e.target === howModal) howModal.classList.remove('active');
    });
  }

  // QR Code Modal
  btnShowQr.addEventListener('click', () => {
    qrContainer.innerHTML = '';
    const fullUrl = `${window.location.origin}/?room=${currentRoomCode}`;
    new QRCode(qrContainer, {
      text: fullUrl,
      width: 220,
      height: 220,
      colorDark: '#070b14',
      colorLight: '#ffffff',
    });
    qrModal.classList.add('active');
  });

  qrModalClose.addEventListener('click', () => qrModal.classList.remove('active'));
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.classList.remove('active');
  });

  // Join Modal
  btnJoinModal.addEventListener('click', () => {
    joinCodeInput.value = '';
    joinModal.classList.add('active');
    setTimeout(() => joinCodeInput.focus(), 50);
  });

  joinModalClose.addEventListener('click', () => joinModal.classList.remove('active'));
  btnCancelJoin.addEventListener('click', () => joinModal.classList.remove('active'));
  joinModal.addEventListener('click', (e) => {
    if (e.target === joinModal) joinModal.classList.remove('active');
  });

  btnSubmitJoin.addEventListener('click', async () => {
    const code = joinCodeInput.value.trim();
    if (code.length === 5 && /^\d+$/.test(code)) {
      btnSubmitJoin.disabled = true;
      const originalText = btnSubmitJoin.textContent;
      btnSubmitJoin.textContent = 'Connecting...';
      try {
        const success = await initRoom(code);
        if (success) {
          joinModal.classList.remove('active');
        }
      } finally {
        btnSubmitJoin.disabled = false;
        btnSubmitJoin.textContent = originalText;
      }
    } else {
      showToast('Please enter a valid 5-digit number', 'warning');
    }
  });

  joinCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSubmitJoin.click();
  });

  // Zoom Modal
  function openZoomModal(imgSrc) {
    zoomedImage.src = imgSrc;
    zoomModal.classList.add('active');
  }

  zoomModalClose.addEventListener('click', () => zoomModal.classList.remove('active'));
  zoomModal.addEventListener('click', (e) => {
    if (e.target === zoomModal) zoomModal.classList.remove('active');
  });

  // Video Theater Modal
  function openVideoModal(videoSrc, title = 'Video Player') {
    if (modalVideoPlayer) {
      modalVideoPlayer.src = videoSrc;
      modalVideoPlayer.play().catch(() => {});
    }
    if (videoModalTitle) videoModalTitle.textContent = title;
    if (videoModal) videoModal.classList.add('active');
  }

  function closeVideoModal() {
    if (modalVideoPlayer) {
      modalVideoPlayer.pause();
      modalVideoPlayer.removeAttribute('src');
      modalVideoPlayer.load();
    }
    if (videoModal) videoModal.classList.remove('active');
  }

  if (videoModalClose) videoModalClose.addEventListener('click', closeVideoModal);
  if (videoModal) {
    videoModal.addEventListener('click', (e) => {
      if (e.target === videoModal) closeVideoModal();
    });
  }

  // PDF Quick View Modal
  function openPdfModal(pdfUrl, title = 'Document Preview') {
    if (pdfModalFrame) pdfModalFrame.src = pdfUrl;
    if (pdfModalOpenTab) pdfModalOpenTab.href = pdfUrl;
    if (pdfModalTitle) pdfModalTitle.textContent = title;
    if (pdfModal) pdfModal.classList.add('active');
  }

  function closePdfModal() {
    if (pdfModalFrame) pdfModalFrame.src = 'about:blank';
    if (pdfModal) pdfModal.classList.remove('active');
  }

  if (pdfModalClose) pdfModalClose.addEventListener('click', closePdfModal);
  if (pdfModal) {
    pdfModal.addEventListener('click', (e) => {
      if (e.target === pdfModal) closePdfModal();
    });
  }

  // Text / Code Snippet Modal
  let activeCodeSnippet = '';
  function openCodeModal(text, title = 'Code Snippet') {
    activeCodeSnippet = text;
    if (codeModalContent) codeModalContent.textContent = text;
    if (codeModalTitle) codeModalTitle.textContent = title;
    if (codeModal) codeModal.classList.add('active');
  }

  function closeCodeModal() {
    activeCodeSnippet = '';
    if (codeModal) codeModal.classList.remove('active');
  }

  if (codeModalClose) codeModalClose.addEventListener('click', closeCodeModal);
  if (codeModalCopy) {
    codeModalCopy.addEventListener('click', () => {
      if (activeCodeSnippet) copyTextToClipboard(activeCodeSnippet, codeModalCopy);
    });
  }
  if (codeModal) {
    codeModal.addEventListener('click', (e) => {
      if (e.target === codeModal) closeCodeModal();
    });
  }

  // New Session & Burn Actions
  btnNewRoom.addEventListener('click', () => {
    if (confirm('Start a new session? This will create a fresh 5-digit room.')) {
      initRoom();
    }
  });

  btnBurnSession.addEventListener('click', burnSession);
  btnClearAll.addEventListener('click', clearAllClips);

  textInput.addEventListener('input', () => {
    textInput.style.height = 'auto';
    textInput.style.height = Math.min(textInput.scrollHeight, 280) + 'px';
  });

  // Initialize
  handleWebShareTarget();
  const initialCode = getRoomCodeFromUrl();
  initRoom(initialCode).then((success) => {
    if (!success && initialCode) {
      initRoom();
    }
  });
})();
