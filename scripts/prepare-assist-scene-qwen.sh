#!/bin/sh
# Build local QA media only. Downloading the public source is a separate step.
set -eu
repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
qa="$repo/native/ios/.build-xcode/scene-qa"
assets="$qa/qwen-cases"
python="$qa/venv/bin/python"
source="$assets/shibuya.webm"
assert_sha1() {
  actual=$(shasum -a 1 "$1")
  [ "${actual%% *}" = "$2" ] || { echo "Unexpected clip digest" >&2; exit 1; }
}
assert_sha1 "$source" d6b663956b4ba8e2fe846359f2f6adc197e57ccf
node "$repo/scripts/download-assistive-object-model.mjs" --verify-only --fixtures
ff=$("$python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
cp "$repo/native/ios/.build-xcode/model-qa/person.jpg" "$assets/person.jpg"
cp "$repo/native/ios/.build-xcode/model-qa/gull.jpg" "$assets/gull.jpg"
# Red bus and frame composition are matched across the positive/frozen clips.
"$ff" -hide_banner -loglevel error -y -ss 2 -i "$source" -t 4 \
  -vf 'scale=768:-2,fps=24' -an -map_metadata -1 \
  -c:v libx264 -crf 17 -threads 1 -pix_fmt yuv420p "$assets/crossing.mp4"
"$ff" -hide_banner -loglevel error -y -i "$assets/crossing.mp4" -frames:v 1 \
  -q:v 2 "$assets/crossing-first.jpg"
"$ff" -hide_banner -loglevel error -y -loop 1 -framerate 24 -i "$assets/crossing-first.jpg" -t 4 \
  -an -map_metadata -1 -c:v libx264 -crf 17 -threads 1 -pix_fmt yuv420p "$assets/frozen.mp4"
for name in crossing frozen; do
  for second in 0 1 2 3; do
    "$ff" -hide_banner -loglevel error -y -ss "$second" -i "$assets/$name.mp4" \
      -frames:v 1 -q:v 2 "$assets/$name-$second.jpg"
  done
done
shasum -a 256 "$assets"/crossing-?.jpg "$assets"/frozen-?.jpg "$assets"/crossing.mp4 "$assets"/frozen.mp4
