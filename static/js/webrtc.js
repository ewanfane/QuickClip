/**
 * QuickClip WebRTC P2P Direct DataChannel Transfer Engine
 * Enables browser-to-browser streaming of large files (video, archives, heavy docs)
 * bypassing the server completely. 0 server bandwidth & 0 server storage used.
 */

class WebRTCManager {
  constructor() {
    this.localPeerId = null;
    this.peerConnections = {}; // peerId -> RTCPeerConnection
    this.dataChannels = {};    // peerId -> RTCDataChannel
    this.knownPeers = [];
    this.wsSendFn = null;
    this.onProgressCallback = null;
    this.onFileReceivedCallback = null;
    this.activeReceives = {};  // file_id -> { name, size, mime_type, chunks, receivedBytes, startTime }

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    };
  }

  init(localPeerId, wsSendFn, callbacks = {}) {
    this.localPeerId = localPeerId;
    this.wsSendFn = wsSendFn;
    this.onProgressCallback = callbacks.onProgress || (() => {});
    this.onFileReceivedCallback = callbacks.onFileReceived || (() => {});
  }

  setKnownPeers(peers) {
    this.knownPeers = (peers || []).filter((p) => p !== this.localPeerId);
  }

  getAvailableTargetPeer() {
    if (this.knownPeers.length > 0) {
      return this.knownPeers[0];
    }
    return null;
  }

  // --- Signaling Relay ---

  async handleSignalingMessage(senderPeerId, signal) {
    if (signal.type === 'offer') {
      await this._handleOffer(senderPeerId, signal.sdp);
    } else if (signal.type === 'answer') {
      await this._handleAnswer(senderPeerId, signal.sdp);
    } else if (signal.type === 'ice_candidate') {
      await this._handleCandidate(senderPeerId, signal.candidate);
    }
  }

  _sendSignal(targetPeerId, signal) {
    if (this.wsSendFn) {
      this.wsSendFn({
        action: 'p2p_signal',
        target_peer_id: targetPeerId,
        signal: signal
      });
    }
  }

  // --- WebRTC PeerConnection Setup ---

  _getOrCreatePeerConnection(peerId) {
    if (this.peerConnections[peerId]) {
      return this.peerConnections[peerId];
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections[peerId] = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal(peerId, {
          type: 'ice_candidate',
          candidate: event.candidate
        });
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this._setupDataChannel(peerId, channel);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this._cleanupPeer(peerId);
      }
    };

    return pc;
  }

  _setupDataChannel(peerId, channel) {
    this.dataChannels[peerId] = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log(`P2P DataChannel open with ${peerId}`);
    };

    channel.onmessage = (event) => {
      this._handleIncomingData(peerId, event.data);
    };

    channel.onclose = () => {
      delete this.dataChannels[peerId];
    };
  }

  async _handleOffer(senderPeerId, sdp) {
    const pc = this._getOrCreatePeerConnection(senderPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this._sendSignal(senderPeerId, {
      type: 'answer',
      sdp: answer
    });
  }

  async _handleAnswer(senderPeerId, sdp) {
    const pc = this.peerConnections[senderPeerId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }

  async _handleCandidate(senderPeerId, candidate) {
    const pc = this.peerConnections[senderPeerId];
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Error adding ICE candidate:', err);
      }
    }
  }

  async ensureConnection(targetPeerId) {
    if (this.dataChannels[targetPeerId] && this.dataChannels[targetPeerId].readyState === 'open') {
      return this.dataChannels[targetPeerId];
    }

    const pc = this._getOrCreatePeerConnection(targetPeerId);
    const channel = pc.createDataChannel('quickclip-p2p-channel', { ordered: true });
    this._setupDataChannel(targetPeerId, channel);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this._sendSignal(targetPeerId, {
      type: 'offer',
      sdp: offer
    });

    // Wait up to 8 seconds for channel to open
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('P2P connection timed out'));
      }, 8000);

      const checkInterval = setInterval(() => {
        if (channel.readyState === 'open') {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve(channel);
        }
      }, 100);
    });
  }

  // --- P2P Chunked File Sender ---

  async sendFile(file, targetPeerId, onProgress) {
    if (!targetPeerId) {
      throw new Error('No target device connected in this session');
    }

    const channel = await this.ensureConnection(targetPeerId);
    const fileId = 'f-' + Math.random().toString(36).substr(2, 9);
    const chunkSize = 64 * 1024; // 64 KB per chunk
    const totalChunks = Math.ceil(file.size / chunkSize);

    // 1. Send Header
    const header = {
      type: 'file_start',
      file_id: fileId,
      name: file.name,
      size: file.size,
      mime_type: file.type || 'application/octet-stream',
      total_chunks: totalChunks
    };
    channel.send(JSON.stringify(header));

    // 2. Stream Chunks with backpressure handling
    let offset = 0;
    let chunkIndex = 0;
    const startTime = Date.now();

    channel.bufferedAmountLowThreshold = 1024 * 1024; // 1 MB buffer limit

    while (offset < file.size) {
      // Pause if channel buffer is crowded
      if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) {
        await new Promise((resolve) => {
          channel.onbufferedamountlow = () => {
            channel.onbufferedamountlow = null;
            resolve();
          };
        });
      }

      const slice = file.slice(offset, offset + chunkSize);
      const buffer = await slice.arrayBuffer();
      channel.send(buffer);

      offset += buffer.byteLength;
      chunkIndex++;

      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? offset / elapsed : 0; // bytes/sec
      const percent = Math.min(100, Math.round((offset / file.size) * 100));

      if (onProgress) {
        onProgress({
          direction: 'send',
          file_id: fileId,
          name: file.name,
          percent: percent,
          transferred: offset,
          total: file.size,
          speed: speed
        });
      }
    }

    // 3. Send End
    channel.send(JSON.stringify({ type: 'file_end', file_id: fileId }));
  }

  // --- P2P Incoming Data Receiver ---

  _handleIncomingData(peerId, data) {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'file_start') {
          this.activeReceives[msg.file_id] = {
            id: msg.file_id,
            name: msg.name,
            size: msg.size,
            mime_type: msg.mime_type,
            total_chunks: msg.total_chunks,
            chunks: [],
            receivedBytes: 0,
            startTime: Date.now()
          };
          if (this.onProgressCallback) {
            this.onProgressCallback({
              direction: 'receive',
              file_id: msg.file_id,
              name: msg.name,
              percent: 0,
              transferred: 0,
              total: msg.size,
              speed: 0
            });
          }
        } else if (msg.type === 'file_end') {
          const rec = this.activeReceives[msg.file_id];
          if (rec) {
            const blob = new Blob(rec.chunks, { type: rec.mime_type });
            const downloadUrl = URL.createObjectURL(blob);

            if (this.onProgressCallback) {
              this.onProgressCallback({
                direction: 'receive',
                file_id: msg.file_id,
                name: rec.name,
                percent: 100,
                transferred: rec.size,
                total: rec.size,
                speed: 0,
                completed: true
              });
            }

            if (this.onFileReceivedCallback) {
              this.onFileReceivedCallback({
                id: rec.id,
                name: rec.name,
                size: rec.size,
                mime_type: rec.mime_type,
                blob: blob,
                downloadUrl: downloadUrl
              });
            }

            delete this.activeReceives[msg.file_id];
          }
        }
      } catch (err) {
        console.error('P2P control message error:', err);
      }
    } else if (data instanceof ArrayBuffer) {
      // Chunk payload: append to current receiving file
      const keys = Object.keys(this.activeReceives);
      if (keys.length > 0) {
        const fileId = keys[keys.length - 1];
        const rec = this.activeReceives[fileId];
        rec.chunks.push(data);
        rec.receivedBytes += data.byteLength;

        const elapsed = (Date.now() - rec.startTime) / 1000;
        const speed = elapsed > 0 ? rec.receivedBytes / elapsed : 0;
        const percent = Math.min(100, Math.round((rec.receivedBytes / rec.size) * 100));

        if (this.onProgressCallback) {
          this.onProgressCallback({
            direction: 'receive',
            file_id: fileId,
            name: rec.name,
            percent: percent,
            transferred: rec.receivedBytes,
            total: rec.size,
            speed: speed
          });
        }
      }
    }
  }

  _cleanupPeer(peerId) {
    if (this.peerConnections[peerId]) {
      this.peerConnections[peerId].close();
      delete this.peerConnections[peerId];
    }
    delete this.dataChannels[peerId];
  }
}

window.webrtcManager = new WebRTCManager();
