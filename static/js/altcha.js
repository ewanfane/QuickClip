/**
 * QuickClip Altcha Proof-of-Work Bot Protection Client
 * Lightweight, GDPR-compliant, privacy-first Proof-of-Work solver.
 * Runs seamlessly in the background with zero user interruption.
 */

class AltchaClient {
  constructor() {
    this.cachedSolution = null;
    this.isSolving = false;
    this.statusListeners = [];
  }

  onStatusChange(fn) {
    this.statusListeners.push(fn);
  }

  _notifyStatus(status, text) {
    this.statusListeners.forEach((fn) => {
      try { fn(status, text); } catch (e) {}
    });
  }

  async bufferToHex(buffer) {
    const byteArray = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < byteArray.length; i++) {
      hex += byteArray[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async solveChallenge(challengeData) {
    const { algorithm, challenge, salt, signature, maxnumber } = challengeData;
    const max = maxnumber || 50000;
    const encoder = new TextEncoder();

    this._notifyStatus('verifying', 'Verifying bot protection...');

    // Asynchronous chunked solver to never freeze UI
    const chunkSize = 2000;
    let current = 0;

    while (current <= max) {
      const end = Math.min(current + chunkSize, max);
      for (let i = current; i <= end; i++) {
        const input = salt + i;
        const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(input));
        const hashHex = await this.bufferToHex(hashBuf);

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

  async fetchAndSolve() {
    if (this.isSolving) return this.solvePromise;

    this.isSolving = true;
    this.solvePromise = (async () => {
      try {
        const res = await fetch('/api/altcha/challenge');
        if (!res.ok) throw new Error('Challenge fetch failed');
        const challengeData = await res.json();
        const solution = await this.solveChallenge(challengeData);
        this.cachedSolution = solution;
        return solution;
      } catch (err) {
        console.warn('Altcha background solve error:', err);
        this._notifyStatus('error', 'Protection standby');
        return null;
      } finally {
        this.isSolving = false;
      }
    })();

    return this.solvePromise;
  }

  async getValidToken() {
    if (this.cachedSolution) {
      const tok = this.cachedSolution;
      this.cachedSolution = null;
      // Trigger background pre-solve for next action
      setTimeout(() => this.fetchAndSolve(), 200);
      return tok;
    }
    return await this.fetchAndSolve();
  }
}

window.altchaClient = new AltchaClient();
