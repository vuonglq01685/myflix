# FFmpeg built with NVENC/NVDEC + the transcoder worker runtime.
# Docker Hub FFmpeg images ship WITHOUT NVENC — `-c:v h264_nvenc` fails with
# "Unknown encoder". This build exists solely to fix that (spec 09 §10).
#
# Licensing: --enable-nonfree together with --enable-gpl produces a binary
# that may not be redistributed. Fine for a private, non-distributed project.
# Drop --enable-nonfree and libfdk-aac if you ever need to ship it.

# ─── Stage 1: build FFmpeg ───────────────────────────────────────────────────
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS ffmpeg-builder

ARG NV_CODEC_HEADERS_TAG=n12.1.14.0
ARG FFMPEG_TAG=n6.1

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git pkg-config yasm nasm cmake ca-certificates \
      libx264-dev libx265-dev libnuma-dev libfdk-aac-dev libass-dev \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${NV_CODEC_HEADERS_TAG} \
      https://github.com/FFmpeg/nv-codec-headers.git /tmp/nv-codec-headers \
 && make -C /tmp/nv-codec-headers install

RUN git clone --depth 1 --branch ${FFMPEG_TAG} \
      https://github.com/FFmpeg/FFmpeg.git /tmp/ffmpeg \
 && cd /tmp/ffmpeg \
 && ./configure \
      --enable-nonfree \
      --enable-cuda-nvcc \
      --enable-libnpp \
      --enable-nvenc \
      --enable-nvdec \
      --enable-cuvid \
      --enable-gpl --enable-libx264 --enable-libx265 \
      --enable-libass --enable-libfdk-aac \
      --extra-cflags=-I/usr/local/cuda/include \
      --extra-ldflags=-L/usr/local/cuda/lib64 \
 && make -j"$(nproc)" \
 && make install

# ─── Stage 2: worker runtime ─────────────────────────────────────────────────
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

# `video` in NVIDIA_DRIVER_CAPABILITIES is mandatory. Without it nvidia-smi
# still works but NVENC is invisible — a notoriously hard failure to diagnose.

RUN apt-get update && apt-get install -y --no-install-recommends \
      libx264-163 libx265-199 libass9 libfdk-aac2 ca-certificates curl gnupg redis-tools \
 && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g pnpm@10 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ffmpeg-builder /usr/local/bin/ffmpeg  /usr/local/bin/ffmpeg
COPY --from=ffmpeg-builder /usr/local/bin/ffprobe /usr/local/bin/ffprobe
COPY --from=ffmpeg-builder /usr/local/lib         /usr/local/lib
RUN ldconfig

WORKDIR /app

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json     ./packages/db/
COPY apps/transcoder/package.json ./apps/transcoder/
RUN pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm --filter @myflix/db generate \
 && pnpm --filter @myflix/shared build \
 && pnpm --filter @myflix/db build \
 && pnpm --filter @myflix/transcoder build

CMD ["node", "apps/transcoder/dist/main.js"]
