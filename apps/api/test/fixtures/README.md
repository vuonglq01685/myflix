# Test fixtures (doc 13 §5, §14)

Not committed — each file is 30–60 s, self-made or public domain (NFR-66).
Generate with `ffmpeg -f lavfi -i testsrc2=...` or drop real clips here.

| File | Purpose |
|---|---|
| sample-1080p-24fps.mkv | standard case, GOP 96 |
| sample-720p-2997fps.mp4 | odd GOP (120), AC3 → AAC |
| sample-4k-hevc.mkv | must cap at 1080p, NVDEC HEVC |
| sample-vfr.mkv | must normalise to CFR |
| sample-vertical.mp4 | 1080×1920, scale by width |
| sample-no-audio.mkv | master playlist without audio |
| sample-corrupt.mkv | FAILED, no retry, attempt stays 1 |
| sample-multi-sub.mkv | 3 embedded subtitle tracks |
| subs/*.srt | UTF-8 BOM, UTF-8, UTF-16LE, Windows-1258 × vi/en |
