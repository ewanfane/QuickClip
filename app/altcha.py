import hashlib
import hmac
import json
import base64
import time
import secrets
from typing import Optional, Dict, Any

# Ephemeral server secret generated on startup - resets on server restart
ALTCHA_SECRET = secrets.token_bytes(32)

# In-memory used challenge nonces to prevent replay attacks
_used_challenges = {}

def clean_expired_nonces():
    now = time.time()
    expired = [ch for ch, exp in _used_challenges.items() if exp < now]
    for ch in expired:
        _used_challenges.pop(ch, None)

def create_challenge(max_number: int = 50000, expires_in: int = 180) -> Dict[str, Any]:
    """
    Creates an Altcha-compatible Proof-of-Work challenge.
    max_number: maximum number to test (50,000 takes ~40-100ms in modern browsers).
    expires_in: challenge expiration in seconds (default 3 minutes).
    """
    clean_expired_nonces()
    
    salt_random = secrets.token_hex(12)
    expires_at = int(time.time()) + expires_in
    salt = f"{salt_random}?expires={expires_at}"
    
    # Secret solution number
    secret_number = secrets.randbelow(max_number) + 1
    
    # Challenge is the SHA-256 hash of salt + secret_number
    challenge_data = f"{salt}{secret_number}".encode("utf-8")
    challenge = hashlib.sha256(challenge_data).hexdigest()
    
    # Sign salt + challenge using HMAC
    sig_data = f"{salt}{challenge}".encode("utf-8")
    signature = hmac.new(ALTCHA_SECRET, sig_data, hashlib.sha256).hexdigest()
    
    return {
        "algorithm": "SHA-256",
        "challenge": challenge,
        "maxnumber": max_number,
        "salt": salt,
        "signature": signature
    }

def verify_solution(payload: Any) -> bool:
    """
    Verifies that the client submitted a valid Proof-of-Work solution.
    Accepts dictionary or base64 JSON string.
    """
    if not payload:
        return False
        
    try:
        if isinstance(payload, str):
            # Base64 decoded if string
            try:
                decoded = base64.b64decode(payload).decode("utf-8")
                data = json.loads(decoded)
            except Exception:
                data = json.loads(payload)
        elif isinstance(payload, dict):
            data = payload
        else:
            return False

        algorithm = data.get("algorithm")
        challenge = data.get("challenge")
        number = data.get("number")
        salt = data.get("salt")
        signature = data.get("signature")

        if algorithm != "SHA-256" or not challenge or number is None or not salt or not signature:
            return False

        # 1. Verify expiration
        if "?expires=" in salt:
            exp_str = salt.split("?expires=")[-1]
            try:
                if int(exp_str) < int(time.time()):
                    return False  # Expired
            except ValueError:
                return False

        # 2. Verify HMAC signature
        expected_sig = hmac.new(
            ALTCHA_SECRET,
            f"{salt}{challenge}".encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        
        if not hmac.compare_digest(expected_sig, signature):
            return False

        # 3. Check for replay
        clean_expired_nonces()
        if challenge in _used_challenges:
            return False

        # 4. Verify Proof of Work
        computed_challenge = hashlib.sha256(f"{salt}{number}".encode("utf-8")).hexdigest()
        if not hmac.compare_digest(computed_challenge, challenge):
            return False

        # Mark challenge as used
        exp_time = time.time() + 300
        _used_challenges[challenge] = exp_time
        return True

    except Exception:
        return False
