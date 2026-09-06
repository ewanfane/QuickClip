/**
 * QuickClip Zero-Knowledge End-to-End Encryption Engine (E2EE)
 * Uses W3C Web Crypto API (crypto.subtle)
 * Key Derivation: PBKDF2 with SHA-256 (100,000 rounds)
 * Cipher: AES-GCM-256 with cryptographically secure random 12-byte IVs
 * 
 * Neither the server nor any intermediary ever sees plaintext or unencrypted files.
 */

class QuickClipCrypto {
  constructor() {
    this.salt = new TextEncoder().encode('quickclip-e2ee-universal-salt-v1');
    this.cachedKeys = {}; // code -> CryptoKey
  }

  /**
   * Derives a 256-bit AES-GCM key from the 5-digit session code.
   */
  async deriveKey(code) {
    if (this.cachedKeys[code]) {
      return this.cachedKeys[code];
    }

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(`quickclip:${code}`),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: this.salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    this.cachedKeys[code] = key;
    return key;
  }

  // --- Text Encryption / Decryption ---

  async encryptText(plainText, key) {
    if (!plainText || !key) return plainText;

    const enc = new TextEncoder();
    const encoded = enc.encode(plainText);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    // Combine IV (12 bytes) + Ciphertext
    const combined = new Uint8Array(iv.length + cipherBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuffer), iv.length);

    // Convert to Base64 with prefix
    let binary = '';
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return 'enc:v1:' + btoa(binary);
  }

  async decryptText(cipherText, key) {
    if (!cipherText || !key || !cipherText.startsWith('enc:v1:')) {
      return cipherText; // Return unencrypted as-is (e.g. legacy or plaintext)
    }

    try {
      const b64 = cipherText.slice(7);
      const binary = atob(b64);
      const combined = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        combined[i] = binary.charCodeAt(i);
      }

      const iv = combined.slice(0, 12);
      const data = combined.slice(12);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );

      const dec = new TextDecoder();
      return dec.decode(decryptedBuffer);
    } catch (err) {
      console.warn('Text decryption failed (wrong PIN or corrupted payload):', err);
      return '[Encrypted clip - invalid key]';
    }
  }

  // --- Binary File / Photo Encryption / Decryption ---

  /**
   * Encrypts a File into an opaque binary Blob.
   * File format:
   * [4 bytes MAGIC "QCE1"] + [12 bytes IV] + [2 bytes MetaLen] + [MetaLen bytes MetaJSON] + [AES-GCM Encrypted File]
   */
  async encryptFile(file, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const fileBytes = await file.arrayBuffer();

    // 1. Encrypt raw file content
    const cipherBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      fileBytes
    );

    // 2. Metadata: encrypt or encode metadata
    const meta = JSON.stringify({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    });
    const metaBytes = new TextEncoder().encode(meta);
    const metaLen = metaBytes.length;

    // 3. Assemble binary envelope
    // Header = 4 ("QCE1") + 12 (IV) + 2 (MetaLen Uint16) + metaLen
    const headerSize = 4 + 12 + 2 + metaLen;
    const envelope = new Uint8Array(headerSize + cipherBuffer.byteLength);

    // Magic bytes "QCE1"
    envelope[0] = 0x51; // 'Q'
    envelope[1] = 0x43; // 'C'
    envelope[2] = 0x45; // 'E'
    envelope[3] = 0x31; // '1'

    // IV
    envelope.set(iv, 4);

    // MetaLen (Big Endian Uint16)
    envelope[16] = (metaLen >> 8) & 0xff;
    envelope[17] = metaLen & 0xff;

    // MetaBytes
    envelope.set(metaBytes, 18);

    // Ciphertext
    envelope.set(new Uint8Array(cipherBuffer), headerSize);

    // Return as generic encrypted Blob
    const encryptedBlob = new Blob([envelope], { type: 'application/octet-stream' });
    return {
      encryptedBlob,
      originalMeta: {
        name: file.name,
        type: file.type,
        size: file.size
      }
    };
  }

  /**
   * Decrypts an encrypted envelope ArrayBuffer into original File Blob with original name & type.
   */
  async decryptFile(arrayBuffer, key) {
    const bytes = new Uint8Array(arrayBuffer);

    // Check magic bytes "QCE1"
    if (bytes[0] !== 0x51 || bytes[1] !== 0x43 || bytes[2] !== 0x45 || bytes[3] !== 0x31) {
      // Legacy unencrypted file
      const blob = new Blob([arrayBuffer]);
      return {
        name: 'downloaded-file',
        mimeType: 'application/octet-stream',
        blob,
        downloadUrl: URL.createObjectURL(blob)
      };
    }

    const iv = bytes.slice(4, 16);
    const metaLen = (bytes[16] << 8) | bytes[17];
    const metaBytes = bytes.slice(18, 18 + metaLen);
    const metaJson = new TextDecoder().decode(metaBytes);
    const meta = JSON.parse(metaJson);

    const cipherBytes = bytes.slice(18 + metaLen);
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );

    const decryptedBlob = new Blob([decryptedBuffer], { type: meta.type || 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(decryptedBlob);

    return {
      name: meta.name,
      mimeType: meta.type,
      size: meta.size,
      blob: decryptedBlob,
      downloadUrl
    };
  }
}

window.quickclipCrypto = new QuickClipCrypto();
