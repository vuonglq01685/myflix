# Phase 0 decision: accept GPL and nonfree FFmpeg build

- **Decision date:** 2026-09-22 (Q5, ticket `:372`, decided by BA)
- **Decision:** GPL and nonfree are both accepted for the FFmpeg build used
  by the transcoder. `infra/ffmpeg/Dockerfile` keeps `--enable-gpl` and
  `--enable-nonfree` (plus `--enable-libfdk-aac`, which requires
  `--enable-nonfree`).

## Rationale

NFR-68 (`[myflix-center-kb:non-functional-requirements §11]`) requires
compatible open-source licenses by default but names its own exception:

> Thư viện mã nguồn mở sử dụng phải có giấy phép tương thích (MIT, Apache-2.0, BSD). FFmpeg build ở chế độ LGPL trừ khi chấp nhận ràng buộc GPL

This decision is the "chấp nhận ràng buộc GPL" exception NFR-68 itself
names.

The project's non-commercial, non-distributed posture is what makes
accepting the GPL/nonfree constraint acceptable. `[myflix-center-kb:project-charter §1]`:

> Dự án tái dựng local nắm pipeline, làm nền tảng cá nhân và codebase tham chiếu. Không thương mại, không phân phối, không lưu nội dung bản quyền.

## Consequence

If this project is ever distributed, `--enable-nonfree` and
`--enable-libfdk-aac` must be dropped from `infra/ffmpeg/Dockerfile` (see
its own header comment, lines 5-7) before that build can ship.
