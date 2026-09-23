import pytest
import io
import json
import time
from fastapi.testclient import TestClient
from app.main import app
from app.session_manager import session_manager
from app.models import Room, Clip

client = TestClient(app)

def test_self_contained_zero_external_calls():
    # 1. Verify index.html does not reference external Google Fonts or Altcha
    res_index = client.get("/")
    assert res_index.status_code == 200
    html = res_index.text
    assert "fonts.googleapis.com" not in html
    assert "fonts.gstatic.com" not in html
    assert "altcha.js" not in html

    # 2. Verify crypto.js is served locally
    res_crypto = client.get("/static/js/crypto.js")
    assert res_crypto.status_code == 200
    assert "QuickClipCrypto" in res_crypto.text

def test_instant_room_creation_and_joining():
    # Create room without any bot token
    res_create = client.post("/api/room")
    assert res_create.status_code == 200
    data = res_create.json()
    assert data["success"] is True
    code = data["room"]["code"]
    assert len(code) == 5 and code.isdigit()

    # Join existing room via POST
    res_join_post = client.post("/api/room", json={"code": code})
    assert res_join_post.status_code == 200
    assert res_join_post.json()["room"]["code"] == code

    # Lookup room via GET
    res_lookup = client.get(f"/api/room/{code}")
    assert res_lookup.status_code == 200
    assert res_lookup.json()["room"]["code"] == code

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
    meta_json = b'{"name":"doc.pdf","type":"application/pdf","size":35}'
    meta_len = len(meta_json)
    qce_header = b"QCE1" + b"\x00" * 12 + bytes([meta_len >> 8, meta_len & 0xFF]) + meta_json
    encrypted_file_payload = qce_header + b"CIPHERTEXT_BYTES_HERE_NOT_RAW"

    files = {"file": ("encrypted.bin", io.BytesIO(encrypted_file_payload), "application/octet-stream")}
    res_up = client.post(f"/api/room/{code}/upload", files=files)
    assert res_up.status_code == 200

    uploaded_clip = session_manager.get_room(code).clips[0]
    assert uploaded_clip.file_bytes.startswith(b"QCE1")
    assert raw_secret_doc not in uploaded_clip.file_bytes
    assert uploaded_clip.file_name == "doc.pdf"
    assert uploaded_clip.type == "pdf"

def test_media_type_detection_and_upload():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    # 1. Image Upload
    img_data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
    files = {"file": ("screenshot.png", io.BytesIO(img_data), "image/png")}
    res_img = client.post(f"/api/room/{code}/upload", files=files)
    assert res_img.status_code == 200
    assert res_img.json()["clip"]["type"] == "image"

    # 2. Video Upload
    vid_data = b"MOCK_VIDEO_STREAM" * 50
    files = {"file": ("vacation.mp4", io.BytesIO(vid_data), "video/mp4")}
    res_vid = client.post(f"/api/room/{code}/upload", files=files)
    assert res_vid.status_code == 200
    assert res_vid.json()["clip"]["type"] == "video"

    # 3. Audio Upload
    aud_data = b"MOCK_AUDIO_DATA" * 50
    files = {"file": ("podcast.mp3", io.BytesIO(aud_data), "audio/mpeg")}
    res_aud = client.post(f"/api/room/{code}/upload", files=files)
    assert res_aud.status_code == 200
    assert res_aud.json()["clip"]["type"] == "audio"

    # 4. PDF Upload
    pdf_data = b"%PDF-1.5" + b"\x00" * 50
    files = {"file": ("report.pdf", io.BytesIO(pdf_data), "application/pdf")}
    res_pdf = client.post(f"/api/room/{code}/upload", files=files)
    assert res_pdf.status_code == 200
    assert res_pdf.json()["clip"]["type"] == "pdf"

    # 5. Code / Text File Upload
    code_data = b"def hello(): return 'world'"
    files = {"file": ("script.py", io.BytesIO(code_data), "text/x-python")}
    res_code = client.post(f"/api/room/{code}/upload", files=files)
    assert res_code.status_code == 200
    assert res_code.json()["clip"]["type"] == "code"

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
    assert "altcha.js" not in res_sw.text

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

def test_burn_room_instant_wipe():
    res = client.post("/api/room")
    code = res.json()["room"]["code"]

    res_burn = client.post(f"/api/room/{code}/burn")
    assert res_burn.status_code == 200
    assert client.get(f"/api/room/{code}").status_code == 404

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
