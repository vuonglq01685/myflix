# Phase 0 decision: switch to the CPU-fallback (libx264) encoder

- **Decision date:** %%TODO(PO)%%
- **Decision:** the shared 1-day NVENC budget (Q12, ticket `:379`) covering
  AC4 + AC5 + AC8 was exhausted without a working NVENC path. Per AC21
  (ticket `:78`), the Project Owner switches the transcoder to the CPU
  fallback: `docker-compose.cpu.yml` + `infra/ffmpeg/cpu-fallback.Dockerfile`,
  encoding with `libx264` instead of `h264_nvenc`.
- **Which AC(s) failed:** %%TODO(PO)%%

## Ladder cap

The CPU-branch ladder is shrunk to exactly `720p` and `480p` — not just
capped at the top end, `1080p` and `360p` are dropped entirely
(`buildLadder(probe, { limitTo: ['720p', '480p'] })` in
`apps/transcoder/src/ffmpeg/args.ts`). A CPU encode of the full four-rung
ladder is not viable in the same wall-clock budget NVENC was sized for.

## NFR-15

**NFR-15 không đạt** (`[myflix-center-kb:non-functional-requirements §3]`)
as a direct consequence of this switch: NFR-15's target assumed
hardware-accelerated (NVENC) encoding, and the libx264 CPU fallback does not
meet it.

## Consequence

Any later NVENC capacity change should revisit this decision — resuming the
NVENC path retires this fallback and restores the full 1080p/720p/480p/360p
ladder (the `useCuda` conditional in `args.ts` reverts automatically for any
`encoder` containing `nvenc`).
