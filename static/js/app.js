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
  const altchaStatusText = document.getElementById('altcha-status-text');
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

  const toastContainer = document.getElementById('toast-container');

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

  // --- Altcha Hook ---
  if (window.altchaClient) {
    window.altchaClient.onStatusChange((status, text) => {
      if (altchaStatusText) altchaStatusText.textContent = text;
    });
    window.altchaClient.fetchAndSolve();
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
        
        // Auto trigger download
        const a = document.createElement('a');
        a.href = fileData.downloadUrl;
        a.download = fileData.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Add to local feed
        const p2pClip = {
          id: fileData.id,
          type: 'p2p_file',
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

  async function initRoom(requestedCode = null) {
    try {
      let altchaToken = null;
      if (window.altchaClient) {
        altchaToken = await window.altchaClient.getValidToken();
      }

      const payload = {};
      if (requestedCode) payload.code = requestedCode;
      if (altchaToken) payload.altcha = altchaToken;

      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.room) {
        currentRoomCode = data.room.code;
        remainingSeconds = data.room.remaining_seconds;
        clips = data.room.clips || [];

        if (window.quickclipCrypto) {
          currentCryptoKey = await window.quickclipCrypto.deriveKey(currentRoomCode);
        }

        const newUrl = `${window.location.origin}/?room=${currentRoomCode}`;
        window.history.replaceState({ room: currentRoomCode }, '', newUrl);

        renderRoomState();
        connectWebSocket();
        startTimer();
      } else {
        showToast(data.detail || 'Failed to initialize session', 'warning');
      }
    } catch (err) {
      console.error('Session init error:', err);
      showToast('Network error initializing session', 'warning');
    }
  }

  function renderRoomState() {
    if (currentRoomCode && currentRoomCode.length === 5) {
      for (let i = 0; i < 5; i++) {
        if (digitEls[i]) digitEls[i].textContent = currentRoomCode[i];
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

    let badgeClass = 'badge-txt';
    let badgeLabel = 'Text';
    if (clip.type === 'image') {
      badgeClass = 'badge-img';
      badgeLabel = 'Image';
    } else if (clip.type === 'p2p_file') {
      badgeClass = 'badge-p2p';
      badgeLabel = '⚡ P2P Direct';
    } else if (clip.type === 'file') {
      badgeClass = 'badge-doc';
      badgeLabel = 'File';
    }

    let bodyHtml = '';
    let actionsHtml = '';
    let decryptedText = clip.content;

    if (clip.type === 'text') {
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
    } else if (clip.type === 'image') {
      bodyHtml = `
        <div class="item-body-image">
          <img src="${clip.content || ''}" alt="Encrypted image preview" class="zoomable-thumb" id="img-${clip.id}" />
        </div>
      `;
      actionsHtml = `
        <button class="btn btn-primary btn-sm" id="copy-img-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Image
        </button>
        <button class="btn btn-secondary btn-sm" id="dl-img-${clip.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </button>
      `;
    } else {
      // General or P2P File
      bodyHtml = `
        <div class="item-body-file">
          <div class="doc-glyph" style="${clip.type === 'p2p_file' ? 'background: rgba(0, 210, 255, 0.15); color: #00d2ff;' : ''}">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          </div>
          <div class="doc-info">
            <div class="doc-name" id="doc-name-${clip.id}" title="${escapeHtml(clip.file_name)}">${escapeHtml(clip.file_name)}</div>
            <div class="doc-size">${formatBytes(clip.file_size)} &bull; ${clip.type === 'p2p_file' ? 'Direct P2P' : 'AES-256 Encrypted'}</div>
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
        <div style="display: flex; gap: 8px;">
          ${actionsHtml}
        </div>
        <button class="btn btn-danger btn-sm btn-delete-clip" data-id="${clip.id}" title="Delete clip">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;

    // Attach Listeners
    if (clip.type === 'text') {
      const copyBtn = card.querySelector('.btn-copy-clip');
      copyBtn.addEventListener('click', () => copyTextToClipboard(decryptedText, copyBtn));
    } else if (clip.type === 'image') {
      const imgEl = card.querySelector(`#img-${clip.id}`);
      const copyImgBtn = card.querySelector(`#copy-img-${clip.id}`);
      const dlImgBtn = card.querySelector(`#dl-img-${clip.id}`);

      let cachedDecrypted = null;
      async function getDecryptedImage() {
        if (cachedDecrypted) return cachedDecrypted;
        if (clip.download_url) {
          const res = await fetch(clip.download_url);
          const buf = await res.arrayBuffer();
          if (currentCryptoKey && window.quickclipCrypto) {
            cachedDecrypted = await window.quickclipCrypto.decryptFile(buf, currentCryptoKey);
          } else {
            const b = new Blob([buf]);
            cachedDecrypted = { blob: b, downloadUrl: URL.createObjectURL(b), name: clip.file_name };
          }
        }
        return cachedDecrypted;
      }

      if (!clip.content && clip.download_url) {
        getDecryptedImage().then((dec) => {
          if (dec && imgEl) imgEl.src = dec.downloadUrl;
        }).catch(console.warn);
      }

      copyImgBtn.addEventListener('click', async () => {
        const dec = await getDecryptedImage();
        if (dec && dec.blob) copyImageBlobToClipboard(dec.blob, copyImgBtn);
      });

      dlImgBtn.addEventListener('click', async () => {
        const dec = await getDecryptedImage();
        if (dec && dec.downloadUrl) triggerFileDownload(dec.downloadUrl, dec.name || 'image.png');
      });

      if (imgEl) {
        imgEl.addEventListener('click', async () => {
          const dec = await getDecryptedImage();
          openZoomModal(dec ? dec.downloadUrl : imgEl.src);
        });
      }
    } else {
      // General or P2P File
      const dlBtn = card.querySelector(`#dl-file-${clip.id}`);
      dlBtn.addEventListener('click', async () => {
        if (clip.type === 'p2p_file' && clip.download_url) {
          triggerFileDownload(clip.download_url, clip.file_name);
          return;
        }
        showToast('Decrypting file in memory...', 'info', 1000);
        try {
          const res = await fetch(clip.download_url);
          const buf = await res.arrayBuffer();
          if (currentCryptoKey && window.quickclipCrypto) {
            const dec = await window.quickclipCrypto.decryptFile(buf, currentCryptoKey);
            triggerFileDownload(dec.downloadUrl, dec.name || clip.file_name);
          } else {
            const b = new Blob([buf]);
            triggerFileDownload(URL.createObjectURL(b), clip.file_name);
          }
          showToast('Decrypted and downloaded!', 'success');
        } catch (err) {
          console.error('File decryption failed:', err);
          showToast('Decryption failed', 'warning');
        }
      });
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
    await uploadFileStandard(file, customType);
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
    let altchaToken = null;
    if (window.altchaClient) {
      altchaToken = await window.altchaClient.getValidToken();
    }

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
    if (customType) formData.append('custom_type', customType);
    if (altchaToken) formData.append('altcha', altchaToken);

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

  btnSubmitJoin.addEventListener('click', () => {
    const code = joinCodeInput.value.trim();
    if (code.length === 5 && /^\d+$/.test(code)) {
      joinModal.classList.remove('active');
      initRoom(code);
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
  initRoom(initialCode);
})();
