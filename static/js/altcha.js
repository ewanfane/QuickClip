/**
 * QuickClip Altcha Proof-of-Work Bot Protection Client
 * Lightweight, GDPR-compliant, privacy-first Proof-of-Work solver.
 * Runs seamlessly in the background with zero user interruption.
 */

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

class AltchaClient {
  constructor() {
    this.cachedSolutions = [];
    this.isSolving = false;
    this.activeBackgroundPromise = null;
    this.statusListeners = [];

    // Pre-warm token in background as soon as script loads
    if (typeof window !== 'undefined') {
      setTimeout(() => this.fetchAndSolve(), 50);
    }
  }

  onStatusChange(fn) {
    this.statusListeners.push(fn);
  }

  _notifyStatus(status, text) {
    this.statusListeners.forEach((fn) => {
      try { fn(status, text); } catch (e) {}
    });
  }

  bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += HEX_TABLE[bytes[i]];
    }
    return hex;
  }

  async solveChallenge(challengeData) {
    const { algorithm, challenge, salt, signature, maxnumber } = challengeData;
    const max = maxnumber || 50000;
    const encoder = new TextEncoder();

    this._notifyStatus('verifying', 'Verifying bot protection...');

    // Asynchronous chunked solver to never freeze UI
    const chunkSize = 2500;
    let current = 0;

    while (current <= max) {
      const end = Math.min(current + chunkSize, max);
      for (let i = current; i <= end; i++) {
        const input = salt + i;
        const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
        const hashHex = this.bufferToHex(hashBuf);

        if (hashHex === challenge) {
          const solution = {
            algorithm,
            challenge,
            number: i,
            salt,
            signature,
          };
          const b64 = btoa(JSON.stringify(solution));
          this._notifyStatus('verified', 'Bot protection verified');
          return b64;
        }
      }
      current = end + 1;
      // Allow browser event loop to breathe
      await new Promise((r) => setTimeout(r, 0));
    }

    this._notifyStatus('error', 'Verification timeout');
    return null;
  }

  async _solveFresh() {
    try {
      const res = await fetch('/api/altcha/challenge');
      if (!res.ok) throw new Error('Challenge fetch failed');
      const challengeData = await res.json();
      return await this.solveChallenge(challengeData);
    } catch (err) {
      console.warn('Altcha solve error:', err);
      this._notifyStatus('error', 'Protection standby');
      return null;
    }
  }

  async fetchAndSolve() {
    if (this.isSolving) return this.activeBackgroundPromise;

    this.isSolving = true;
    this.activeBackgroundPromise = (async () => {
      try {
        const solution = await this._solveFresh();
        if (solution) {
          this.cachedSolutions.push(solution);
        }
        return solution;
      } finally {
        this.isSolving = false;
        this.activeBackgroundPromise = null;
      }
    })();

    return this.activeBackgroundPromise;
  }

  /**
   * Returns a single-use token guaranteed to be exclusive to this caller.
   * Never hands out the same token twice.
   */
  async getValidToken() {
    // 1. Consume from cached pre-solved queue if available
    if (this.cachedSolutions.length > 0) {
      const tok = this.cachedSolutions.shift();
      // Schedule background pre-solve to maintain pool
      setTimeout(() => this.fetchAndSolve(), 100);
      return tok;
    }

    // 2. If a background solve is currently running, claim its result exclusively
    if (this.isSolving && this.activeBackgroundPromise) {
      const promise = this.activeBackgroundPromise;
      // Clear background tracking so another concurrent caller won't claim this same promise
      this.activeBackgroundPromise = null;
      const solution = await promise;
      // If it was pushed into the array by fetchAndSolve, remove it since we're returning it directly
      const idx = this.cachedSolutions.indexOf(solution);
      if (idx !== -1) {
        this.cachedSolutions.splice(idx, 1);
      }
      setTimeout(() => this.fetchAndSolve(), 100);
      if (solution) return solution;
    }

    // 3. Otherwise solve a fresh challenge directly
    const freshSolution = await this._solveFresh();
    setTimeout(() => this.fetchAndSolve(), 100);
    return freshSolution;
  }
}

window.altchaClient = new AltchaClient();
