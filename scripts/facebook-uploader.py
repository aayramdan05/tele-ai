#!/usr/bin/env python3
"""
Facebook Reels & Video Auto-Uploader
Mengunggah video reels/MP4 secara otomatis ke Facebook Page menggunakan Facebook Graph API.
Menggunakan library bawaan Python standard library (urllib.request) tanpa dependensi eksternal.
"""

import os
import sys
import json
import uuid
import argparse
import urllib.request
import urllib.error
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DB_FILE = BASE_DIR / "data" / "db.json"

def get_db_settings():
    if DB_FILE.exists():
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("settings", {})
        except Exception as e:
            print(f"[WARN] Gagal membaca db.json: {e}", file=sys.stderr)
    return {}

def test_token(token, page_id):
    url = f"https://graph.facebook.com/v19.0/{page_id}?access_token={token}&fields=id,name,link"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read().decode("utf-8"))
            print(json.dumps({
                "success": True,
                "message": f"Koneksi Facebook Page terverifikasi: '{data.get('name')}' (ID: {data.get('id')})",
                "page": data
            }, indent=2))
            return True
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(json.dumps({
            "success": False,
            "error": f"HTTP {e.code}: {e.reason}",
            "details": err_body
        }, indent=2), file=sys.stderr)
        return False
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
        return False

def build_multipart(fields, file_field, file_path):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = bytearray()

    for name, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        body.extend(f"{value}\r\n".encode("utf-8"))

    filename = Path(file_path).name
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(f'Content-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'.encode("utf-8"))
    body.extend(b"Content-Type: video/mp4\r\n\r\n")

    with open(file_path, "rb") as f:
        body.extend(f.read())
    body.extend(f"\r\n--{boundary}--\r\n".encode("utf-8"))

    content_type = f"multipart/form-data; boundary={boundary}"
    return body, content_type

def upload_video(video_path, title, description, token, page_id):
    if not os.path.exists(video_path):
        print(json.dumps({"success": False, "error": f"File video tidak ditemukan: {video_path}"}))
        sys.exit(1)

    url = f"https://graph-video.facebook.com/v19.0/{page_id}/videos"
    fields = {
        "access_token": token,
        "title": title or "Reels Video",
        "description": description or ""
    }

    print(f"[FACEBOOK] Mengunggah {Path(video_path).name} ke Facebook Page ID: {page_id}...")
    body, content_type = build_multipart(fields, "source", video_path)

    req = urllib.request.Request(url, data=body)
    req.add_header("Content-Type", content_type)

    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            res_data = json.loads(res.read().decode("utf-8"))
            video_id = res_data.get("id")
            result = {
                "success": True,
                "video_id": video_id,
                "message": f"Video Reels berhasil terunggah ke Facebook Page! Video ID: {video_id}",
                "facebook_url": f"https://www.facebook.com/{video_id}"
            }
            print(json.dumps(result, indent=2))
            return result
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        err_res = {
            "success": False,
            "error": f"Gagal upload ke Facebook (HTTP {e.code})",
            "details": err_body
        }
        print(json.dumps(err_res, indent=2), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        err_res = {"success": False, "error": str(e)}
        print(json.dumps(err_res, indent=2), file=sys.stderr)
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Facebook Reels & Video Auto Uploader")
    parser.add_argument("--video", help="Path file video MP4")
    parser.add_argument("--title", default="Reels Video", help="Judul video Reels")
    parser.add_argument("--description", default="", help="Caption atau deskripsi postingan")
    parser.add_argument("--token", help="Facebook Page Access Token")
    parser.add_argument("--page-id", help="Facebook Page ID")
    parser.add_argument("--test", action="store_true", help="Uji validitas token dan Page ID")

    args = parser.parse_args()
    settings = get_db_settings()

    token = args.token or settings.get("facebook_page_access_token") or os.environ.get("FACEBOOK_PAGE_ACCESS_TOKEN")
    page_id = args.page_id or settings.get("facebook_page_id") or os.environ.get("FACEBOOK_PAGE_ID")

    if not token or not page_id:
        print(json.dumps({
            "success": False,
            "error": "Facebook Page Access Token dan Facebook Page ID belum diatur.",
            "hint": "Gunakan argumen --token dan --page-id, atau simpan melalui bot Telegram / web dashboard."
        }, indent=2), file=sys.stderr)
        sys.exit(1)

    if args.test:
        test_token(token, page_id)
        return

    if not args.video:
        print(json.dumps({"success": False, "error": "Harap tentukan file video via argumen --video"}), file=sys.stderr)
        sys.exit(1)

    upload_video(args.video, args.title, args.description, token, page_id)

if __name__ == "__main__":
    main()
