#!/usr/bin/env python3
"""
FB Reels Video Clipper Helper
Mengunduh video (yt-dlp), memotong highlight, menambahkan judul atas-bawah (padding 16:9 / 9:16),
dan menghasilkan video MP4 siap posting ke Facebook Reels.
"""

import os
import sys
import json
import argparse
import subprocess
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
TEMP_DIR = DATA_DIR / "temp"
OUTPUT_DIR = DATA_DIR / "output"
HISTORY_FILE = DATA_DIR / "download_history.json"

for d in [DATA_DIR, TEMP_DIR, OUTPUT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

def load_history():
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_history(video_id):
    history = load_history()
    if video_id not in history:
        history.append(video_id)
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history[-500:], f, indent=2)

def check_command(cmd):
    return shutil.which(cmd) is not None

def download_video(url_or_search):
    """Download video using yt-dlp with history check"""
    if not check_command("yt-dlp"):
        print("[ERROR] yt-dlp tidak terpasang di sistem. Jalankan 'pip install yt-dlp'.", file=sys.stderr)
        sys.exit(1)

    history = load_history()
    target_url = url_or_search

    # If it's a search term
    if not target_url.startswith("http"):
        print(f"[CLIPPER] Mencari video dengan kata kunci: '{target_url}'...")
        search_cmd = [
            "yt-dlp",
            f"ytsearch5:{target_url}",
            "--get-id",
            "--get-title",
            "--no-playlist",
            "--skip-download"
        ]
        proc = subprocess.run(search_cmd, capture_output=True, text=True, check=True)
        lines = [l.strip() for l in proc.stdout.splitlines() if l.strip()]
        
        # Parse titles and IDs
        found_id = None
        for i in range(1, len(lines), 2):
            vid_id = lines[i]
            if vid_id not in history:
                found_id = vid_id
                target_url = f"https://www.youtube.com/watch?v={found_id}"
                print(f"[CLIPPER] Menemukan video baru: {lines[i-1]} ({vid_id})")
                break
        
        if not found_id and len(lines) >= 2:
            target_url = f"https://www.youtube.com/watch?v={lines[1]}"
        elif not found_id and len(lines) == 1:
            target_url = f"https://www.youtube.com/watch?v={lines[0]}"

    # Download video to TEMP_DIR
    out_template = str(TEMP_DIR / "%(id)s.%(ext)s")
    dl_cmd = [
        "yt-dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "-o", out_template,
        target_url
    ]
    print(f"[CLIPPER] Mengunduh: {target_url}...")
    subprocess.run(dl_cmd, check=True)

    # Locate downloaded file
    info_cmd = ["yt-dlp", "--get-id", target_url]
    info_proc = subprocess.run(info_cmd, capture_output=True, text=True, check=True)
    id_lines = [l.strip() for l in info_proc.stdout.splitlines() if l.strip()]
    vid_id = id_lines[-1] if id_lines else "video"

    matched = [f for f in TEMP_DIR.glob(f"{vid_id}.*") if f.suffix.lower() in [".mp4", ".mkv", ".webm", ".ts"]]
    downloaded_file = matched[0] if matched else TEMP_DIR / f"{vid_id}.mp4"

    save_history(vid_id)
    return str(downloaded_file), vid_id

def process_video_ffmpeg(input_path, output_path, start_time="00:01:00", duration="45",
                         title_top="HIGHLIGHT VIRAL", title_bottom="Simak sampai akhir 👇",
                         aspect_ratio="16:9"):
    """
    Apply FFmpeg cutting, padding, and top/bottom title bars
    """
    if not check_command("ffmpeg"):
        print("[ERROR] ffmpeg tidak ditemukan. Pastikan ffmpeg terpasang di sistem.", file=sys.stderr)
        sys.exit(1)

    print(f"[CLIPPER] Memproses FFmpeg: {input_path} -> {output_path}")

    # Escape title text for FFmpeg drawtext
    def escape_text(txt):
        return txt.replace("'", "").replace(":", " ").replace("%", " ")

    clean_top = escape_text(title_top)
    clean_bot = escape_text(title_bottom)

    # Detect font file on Windows to prevent fontconfig errors
    font_param = ""
    if os.name == "nt":
        for fp in ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"]:
            if os.path.exists(fp):
                escaped_fp = fp.replace(":", r"\:")
                font_param = f"fontfile='{escaped_fp}':"
                break

    # Setup filtergraph depending on aspect ratio
    if aspect_ratio == "16:9":
        # 16:9 Letterboxed with top & bottom bar:
        # Scale to 1920x800, pad to 1920x1080 (140px black bar top & bottom)
        vf = (
            "scale=1920:800:force_original_aspect_ratio=decrease,"
            "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,"
            f"drawtext={font_param}text='{clean_top}':fontsize=44:fontcolor=yellow:x=(w-text_w)/2:y=45:borderw=3:bordercolor=black,"
            f"drawtext={font_param}text='{clean_bot}':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=h-90:borderw=2:bordercolor=black"
        )
    else:
        # 9:16 Vertical Reels with video in middle
        # Scale width to 1080, pad height to 1920 (bars above and below)
        vf = (
            "scale=1080:-2,"
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,"
            f"drawtext={font_param}text='{clean_top}':fontsize=52:fontcolor=yellow:x=(w-text_w)/2:y=240:borderw=3:bordercolor=black,"
            f"drawtext={font_param}text='{clean_bot}':fontsize=42:fontcolor=white:x=(w-text_w)/2:y=h-300:borderw=2:bordercolor=black"
        )

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_time),
        "-i", str(input_path),
        "-t", str(duration),
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "128k",
        str(output_path)
    ]

    print("[CLIPPER] Menjalankan perintah FFmpeg...")
    subprocess.run(cmd, check=True)
    print(f"[CLIPPER] Sukses! File siap: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="FB Reels Video Clipper Helper")
    parser.add_argument("--url", help="URL video target atau kata kunci pencarian (misal: 'podcast bisnis viral')")
    parser.add_argument("--search", help="Kata kunci pencarian YouTube otomatis")
    parser.add_argument("--input", help="Path file video lokal yang sudah ada")
    parser.add_argument("--start", default="00:00:30", help="Waktu mulai highlight (format: HH:MM:SS)")
    parser.add_argument("--duration", default="45", help="Durasi klip dalam detik (default: 45)")
    parser.add_argument("--title-top", default="PILIHAN TERBAIK HARI INI", help="Judul di bar atas")
    parser.add_argument("--title-bottom", default="Tonton sampai akhir 👇", help="Teks di bar bawah")
    parser.add_argument("--ratio", default="16:9", choices=["16:9", "9:16"], help="Rasio video output")
    parser.add_argument("--output", help="Path output file MP4")

    args = parser.parse_args()

    # Step 1: Get input file
    input_video = args.input
    if not input_video:
        target = args.search or args.url or "podcast inspirasi indonesia"
        input_video, vid_id = download_video(target)
    else:
        vid_id = Path(input_video).stem

    # Step 2: Determine output path
    out_file = args.output
    if not out_file:
        out_file = str(OUTPUT_DIR / f"reels_{vid_id}_{args.ratio.replace(':', 'x')}.mp4")

    # Step 3: Render video
    process_video_ffmpeg(
        input_path=input_video,
        output_path=out_file,
        start_time=args.start,
        duration=args.duration,
        title_top=args.title_top,
        title_bottom=args.title_bottom,
        aspect_ratio=args.ratio
    )

    # Output path to stdout for Agent to read
    print(f"\n[OUTPUT_FILE] {out_file}")

if __name__ == "__main__":
    main()
