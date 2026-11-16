#!/bin/bash
# Builds a labelled MP4 of narration takes: tools/takes.sh <out.mp4> <file:Label> ...  (files in audio/, without -a/-b)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$1; shift
FONT=/System/Library/Fonts/Supplemental/Arial\ Unicode.ttf
W=$(mktemp -d); : > "$W/list.txt"; i=0
for n in "$@"; do f=${n%%:*}; printf '%s' "${n#*:}" > "$W/t.txt"
  for k in a b; do i=$((i+1)); printf 'Take %s' "$(echo $k | tr a-z A-Z)" > "$W/k$i.txt"
    d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "audio/$f-$k.mp3")
    ffmpeg -y -loglevel error -f lavfi -i "color=c=0xfbf8f3:s=1280x720:r=30" -i "audio/$f-$k.mp3" -filter_complex \
      "[1]apad=pad_dur=0.8[a];[0]drawtext=fontfile='$FONT':textfile=$W/t.txt:fontsize=56:fontcolor=0x141414:x=(w-tw)/2:y=h/2-80,drawtext=fontfile='$FONT':textfile=$W/k$i.txt:fontsize=72:fontcolor=0xff7a2e:x=(w-tw)/2:y=h/2+20[v]" \
      -map "[v]" -map "[a]" -t "$(echo "$d+0.8" | bc)" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 160k "$W/$(printf %02d $i).mp4"
    echo "file '$(printf %02d $i).mp4'" >> "$W/list.txt"; done; done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$W/list.txt" -c copy "$OUT"
echo "$OUT $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s"
