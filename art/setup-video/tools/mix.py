#!/usr/bin/env python3
"""The sound of the CEL-94 onboarding video: each narration line at its start time, the baroque track ducked
under the voice, laid on a silent picture. Used by cut.py (the footage cut) and v2/render.sh (motion graphics).
Usage: python3 tools/mix.py --picture PICTURE.mp4 --timeline TIMELINE.json --out OUT.mp4
The timeline is a list of {"voice": "audio/<scene>-a.mp3", "at": seconds}; voice paths are relative to art/setup-video."""
import argparse, json, os, subprocess

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.join(BASE, "music", "baroque-long.mp3")

def mix(picture, voice, out, total):
    """voice: [(path, start seconds)], paths relative to art/setup-video; total: the video's length in seconds."""
    inputs, fc, amix = [], "", ""
    for n, (vo, at) in enumerate(voice, start=1):
        inputs += ["-i", os.path.join(BASE, vo)]; ms = int(at * 1000)
        fc += f"[{n}]adelay={ms}|{ms}[v{n}];"; amix += f"[v{n}]"
    m = len(voice) + 1
    fc += f"{amix}amix=inputs={len(voice)}:normalize=0,apad=whole_dur={total:.2f}[vo];"
    fc += f"[{m}]volume=0.22,apad=whole_dur={total:.2f},afade=t=in:d=1,afade=t=out:st={total-2.5:.2f}:d=2.5[mu];"
    fc += "[vo]asplit[vo1][vo2];[mu][vo1]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[duck];"
    fc += "[duck][vo2]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", picture, *inputs, "-i", MUSIC, "-filter_complex", fc,
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{total:.2f}", out], check=True)

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--picture", required=True)
    ap.add_argument("--timeline", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    rows = json.load(open(args.timeline))
    total = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", args.picture]))
    mix(args.picture, [(r["voice"], r["at"]) for r in rows], args.out, total)
    print(f"{args.out}: {total:.1f}s")
