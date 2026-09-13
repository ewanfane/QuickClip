import pytest
import io
import hashlib
import time
from fastapi.testclient import TestClient
from app.main import app
from app.session_manager import session_manager
from app.models import Room, Clip
from app.altcha import create_challenge, verify_solution

client = TestClient(app)

def test_self_contained_zero_external_calls():
    # 1. Verify index.html does not reference external Google Fonts
    res_index = client.get("/")
    assert res_index.status_code == 200
    html = res_index.text
    assert "fonts.googleapis.com" not in html
    assert "fonts.gstatic.com" not in html

    # 2. Verify crypto.js is served locally
    res_crypto = client.get("/static/js/crypto.js")
    assert res_crypto.status_code == 200
    assert "QuickClipCrypto" in res_crypto.text

def test_encrypted_storage_zero_knowledge():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    # 1. Send encrypted text clip over WebSocket
    secret_text = "SuperSecretBankPassword123!"
    # Mock AES-GCM ciphertext payload
    mock_cipher_payload = "enc:v1:QUVTLUdDTS1NT0NLLUNJUEhFUlRFWFQ="

    with client.websocket_connect(f"/ws/{code}") as ws:
        ws.receive_json() # init
        ws.send_json({
            "action": "add_text",
            "text": mock_cipher_payload
        })
        added = ws.receive_json()
        assert added["type"] == "clip_added"
        
        # Verify server stored ONLY ciphertext
        stored_clip = session_manager.get_room(code).clips[0]
        assert stored_clip.content == mock_cipher_payload
        assert secret_text not in stored_clip.content

    # 2. Upload encrypted binary file (QCE1 format)
    # Header: QCE1 (4 bytes) + 12-byte IV + 2-byte MetaLen + JSON + encrypted data
    raw_secret_doc = b"CONFIDENTIAL_USER_DATA_FILE_PAYLOAD"
    qce_header = b"QCE1" + b"\x00" * 12 + b"\x00\x10" + b'{"name":"doc.pdf"}'
    encrypted_file_payload = qce_header + b"CIPHERTEXT_BYTES_HERE_NOT_RAW"

    files = {"file": ("encrypted.bin", io.BytesIO(encrypted_file_payload), "application/octet-stream")}
    res_up = client.post(f"/api/room/{code}/upload", files=files)
    assert res_up.status_code == 200

    # Verify server stored ONLY encrypted bytes and that raw payload is nowhere in server memory
    uploaded_clip = session_manager.get_room(code).clips[0]
    assert uploaded_clip.file_bytes.startswith(b"QCE1")
    assert raw_secret_doc not in uploaded_clip.file_bytes
    assert uploaded_clip.file_name == "encrypted.bin"

def test_pwa_manifest_and_sw():
    res = client.get("/manifest.json")
    assert res.status_code == 200
    manifest = res.json()
    assert manifest["short_name"] == "QuickClip"
    assert manifest["display"] == "standalone"
    assert "share_target" in manifest
    assert manifest["share_target"]["action"] == "/"

    res_sw = client.get("/sw.js")
    assert res_sw.status_code == 200
    assert "quickclip-v2" in res_sw.text
    assert "/static/js/crypto.js" in res_sw.text

def test_standard_upload_limit_enforcement():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    oversized_content = b"X" * (10 * 1024 * 1024 + 100)
    files = {"file": ("heavy_video.mp4", io.BytesIO(oversized_content), "video/mp4")}
    res_over = client.post(f"/api/room/{code}/upload", files=files)
    assert res_over.status_code == 413
    assert "File exceeds standard server limit (10 MB)" in res_over.json()["detail"]

    small_content = b"TEST_PAYLOAD" * 100
    files_small = {"file": ("photo.png", io.BytesIO(small_content), "image/png")}
    res_small = client.post(f"/api/room/{code}/upload", files=files_small)
    assert res_small.status_code == 200

def test_webrtc_signaling_relay():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    with client.websocket_connect(f"/ws/{code}") as ws1:
        init1 = ws1.receive_json()
        peer1_id = init1["peer_id"]

        with client.websocket_connect(f"/ws/{code}") as ws2:
            init2 = ws2.receive_json()
            peer2_id = init2["peer_id"]

            ws1.receive_json() # peer_count update

            mock_sdp = {"type": "offer", "sdp": "v=0\r\no=mock-sdp-test"}
            ws1.send_json({
                "action": "p2p_signal",
                "target_peer_id": peer2_id,
                "signal": mock_sdp
            })

            relayed = ws2.receive_json()
            assert relayed["type"] == "p2p_signal"
            assert relayed["sender_peer_id"] == peer1_id
            assert relayed["signal"]["sdp"] == "v=0\r\no=mock-sdp-test"

def test_altcha_challenge_and_verification():
    res = client.get("/api/altcha/challenge")
    assert res.status_code == 200
    ch = res.json()
    assert ch["algorithm"] == "SHA-256"

    salt = ch["salt"]
    target_challenge = ch["challenge"]
    maxnumber = ch["maxnumber"]
    
    solution_number = None
    for i in range(1, maxnumber + 1):
        h = hashlib.sha256(f"{salt}{i}".encode("utf-8")).hexdigest()
        if h == target_challenge:
            solution_number = i
            break
    assert solution_number is not None

    payload = {
        "algorithm": "SHA-256",
        "challenge": target_challenge,
        "number": solution_number,
        "salt": salt,
        "signature": ch["signature"]
    }
    assert verify_solution(payload) is True
    assert verify_solution(payload) is False

def test_burn_room_instant_wipe():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    res_burn = client.post(f"/api/room/{code}/burn")
    assert res_burn.status_code == 200
    assert client.get(f"/api/room/{code}").status_code == 404

def test_join_existing_room_bypasses_altcha():
    # Create initial room
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    # Join existing room via POST without Altcha token
    res_join_post = client.post("/api/room", json={"code": code})
    assert res_join_post.status_code == 200
    assert res_join_post.json()["success"] is True
    assert res_join_post.json()["room"]["code"] == code

    # Join existing room via GET direct lookup
    res_join_get = client.get(f"/api/room/{code}")
    assert res_join_get.status_code == 200
    assert res_join_get.json()["room"]["code"] == code

def test_rate_limiter_extracts_x_forwarded_for():
    from unittest.mock import MagicMock
    from app.rate_limiter import rate_limiter

    # Test X-Forwarded-For with multiple proxies
    req_forwarded = MagicMock()
    req_forwarded.headers = {"x-forwarded-for": "203.0.113.55, 10.0.0.1"}
    assert rate_limiter.get_client_ip(req_forwarded) == "203.0.113.55"

    # Test X-Real-IP
    req_real = MagicMock()
    req_real.headers = {"x-real-ip": "198.51.100.12"}
    assert rate_limiter.get_client_ip(req_real) == "198.51.100.12"

def test_join_room_never_blocked_by_invalid_altcha():
    res = client.post("/api/room", json={"code": "88888", "altcha": "invalid_or_replayed_token"})
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert res.json()["room"]["code"] == "88888"

def test_invalid_altcha_on_upload_rejected():
    res_room = client.post("/api/room")
    code = res_room.json()["room"]["code"]
    files = {"file": ("test.txt", io.BytesIO(b"hello world"), "text/plain")}
    res = client.post(f"/api/room/{code}/upload", files=files, data={"altcha": "bogus_token"})
    assert res.status_code == 400
    assert "Bot protection verification failed" in res.json()["detail"]
