#!/usr/bin/env python3
"""Cuts the CEL-94 onboarding video: picture per scene fitted to its narration, voice on top, the baroque track ducked under it.
Usage: python3 tools/cut.py [--footage DIR] [--out review/rough-cut.mp4]
A scene whose footage isn't recorded yet gets a labelled placeholder slate."""
import argparse, json, os, subprocess, tempfile
ap = argparse.ArgumentParser()
ap.add_argument("--footage", default="footage")
ap.add_argument("--out", default="review/rough-cut.mp4")
ap.add_argument("--takes", default='{}', help='JSON of scene -> "a"|"b", default a')
args = ap.parse_args()
os.chdir(os.path.join(os.path.dirname(__file__), ".."))
takes = json.loads(args.takes)
F = args.footage
FONT = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"
GAP, LEAD, TAIL = 1.0, 0.4, 2.0
# scene, pieces[, extra seconds of picture after the voice]: (kind, source, seconds or None = fill the rest[, crop w:h:x:y]). kind: clip (fit), loop, slate
SCENES = [
  ("s1-problem",       [("clip", f"{F}/s1-agents.mp4", None, "1600:900:160:30")]),
  ("s2-what",          [("clip", "footage/banner.mp4", 3.0), ("clip", f"{F}/s2-board.mp4", None, "1720:968:20:10")]),
  ("s3-setup",         [("clip", "footage/s3-terminal.mp4", None), ("clip", "footage/s3-board.mp4", 5.5)], 4.0),
  ("s3b-orchestrator", [("clip", "footage/loop.mp4", 5.0), ("clip", f"{F}/s3b-orchestrate.mp4", None, "1720:968:20:10")]),
  ("s4-watch",         [("clip", f"{F}/s4-watch.mp4", None, "1720:968:20:10")]),
  ("s5-decisions",     [("clip", f"{F}/s5-decisions.mp4", None)]),
  ("s6-proof",         [("clip", f"{F}/s6-proof.mp4", None)]),
  ("s7-local",         [("clip", "footage/architecture.mp4", None)]),
  ("s8-outro",         [("clip", "footage/banner.mp4", None)]),
]
dur = lambda p: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
run = lambda *a: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)
W = tempfile.mkdtemp()
V = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xfbf8f3,fps=30,format=yuv420p"
parts, voice, t, timeline = [], [], 0.0, []
for i, (scene, pieces, *extra) in enumerate(SCENES):
    vo = f"audio/{scene}-{takes.get(scene, 'a')}.mp3"
    D = LEAD + dur(vo) + GAP + (TAIL if i == len(SCENES) - 1 else 0) + (extra[0] if extra else 0)
    voice.append((vo, t + LEAD)); timeline.append({"scene": scene, "voice": vo, "at": round(t + LEAD, 3), "seconds": round(dur(vo), 3)})
    fixed = sum(p[2] for p in pieces if p[2])
    for j, piece in enumerate(pieces):
        kind, src, secs = piece[:3]; crop = f"crop={piece[3]}," if len(piece) > 3 else ""
        d = secs or (D - fixed)
        out = f"{W}/{i:02d}-{j}.mp4"
        if kind == "slate":
            txt = f"{W}/t{i}{j}.txt"; open(txt, "w").write(src)
            sub = f"{W}/s{i}{j}.txt"; open(sub, "w").write("Placeholder: recorded in your Docker session")
            run("-f", "lavfi", "-i", "color=c=0xfbf8f3:s=1920x1080:r=30", "-vf",
                f"drawtext=fontfile='{FONT}':textfile={txt}:fontsize=64:fontcolor=0x141414:x=(w-tw)/2:y=h/2-70,"
                f"drawtext=fontfile='{FONT}':textfile={sub}:fontsize=40:fontcolor=0xff7a2e:x=(w-tw)/2:y=h/2+30,format=yuv420p",
                "-t", f"{d:.3f}", "-c:v", "libx264", "-crf", "18", out)
        elif kind == "loop":
            run("-stream_loop", "-1", "-i", src, "-vf", V, "-t", f"{d:.3f}", "-an", "-c:v", "libx264", "-crf", "18", out)
        else:  # fit the clip's length to d (speed up or slow down)
            k = d / dur(src)
            run("-i", src, "-vf", f"{crop}setpts={k:.5f}*PTS,{V}", "-t", f"{d:.3f}", "-an", "-c:v", "libx264", "-crf", "18", out)
        parts.append(out)
    print(f"{scene:18s} {t:6.1f}s  +{D:5.1f}s")
    t += D
open(f"{W}/list.txt", "w").write("".join(f"file '{p}'\n" for p in parts))
run("-f", "concat", "-safe", "0", "-i", f"{W}/list.txt", "-c", "copy", f"{W}/picture.mp4")
inputs, fc, mix = [], "", ""
for n, (vo, at) in enumerate(voice, start=1):
    inputs += ["-i", vo]; ms = int(at * 1000)
    fc += f"[{n}]adelay={ms}|{ms}[v{n}];"; mix += f"[v{n}]"
m = len(voice) + 1
fc += f"{mix}amix=inputs={len(voice)}:normalize=0,apad=whole_dur={t:.2f}[vo];"
fc += f"[{m}]volume=0.22,apad=whole_dur={t:.2f},afade=t=in:d=1,afade=t=out:st={t-2.5:.2f}:d=2.5[mu];"
fc += "[vo]asplit[vo1][vo2];[mu][vo1]sidechaincompress=threshold=0.05:ratio=4:attack=20:release=400[duck];"
fc += "[duck][vo2]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]"
run("-i", f"{W}/picture.mp4", *inputs, "-i", "music/baroque-long.mp3", "-filter_complex", fc,
    "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", f"{t:.2f}", args.out)
json.dump(timeline, open(os.path.splitext(args.out)[0] + ".timeline.json", "w"), indent=1)
print(f"{args.out}: {t:.1f}s")
