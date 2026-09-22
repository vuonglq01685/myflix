import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Playback URL signing (ADR-006), byte-compatible with nginx's
 * ngx_http_secure_link_module configured as:
 *
 *   secure_link     $arg_md5,$arg_expires;
 *   secure_link_md5 "<secret>$asset_id$arg_expires";
 *
 * nginx base64-encodes the RAW md5 digest and then URL-safes it: '+' -> '-',
 * '/' -> '_', padding stripped. Getting any of those three wrong yields a
 * signature nginx rejects with 403 and no useful diagnostic.
 *
 * This protects against unauthenticated access. It does NOT stop an
 * authenticated viewer from downloading segments and stitching them back
 * together — that is DRM's job, and DRM is out of scope.
 */
export const DEFAULT_MEDIA_TTL_SEC = 4 * 60 * 60;

export interface SignedMediaUrl {
  url: string;
  expiresAt: Date;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function mediaSignature(secret: string, assetId: string, expires: number): string {
  return base64url(createHash('md5').update(`${secret}${assetId}${expires}`).digest());
}

export function signMediaPath(params: {
  secret: string;
  assetId: string;
  /** Path below the asset prefix, e.g. `master.m3u8` or `sprite.vtt`. */
  path: string;
  ttlSec?: number;
  now?: Date;
}): SignedMediaUrl {
  const { secret, assetId, path } = params;
  const now = params.now ?? new Date();
  const ttl = params.ttlSec ?? DEFAULT_MEDIA_TTL_SEC;
  const expires = Math.floor(now.getTime() / 1000) + ttl;
  const md5 = mediaSignature(secret, assetId, expires);
  const clean = path.replace(/^\/+/, '');
  return {
    url: `/media/${assetId}/${clean}?md5=${md5}&expires=${expires}`,
    expiresAt: new Date(expires * 1000),
  };
}

export type SignatureCheck = 'ok' | 'expired' | 'invalid';

/** Mirrors nginx's own verdicts so tests can assert 403 vs 410 behaviour. */
export function verifyMediaSignature(params: {
  secret: string;
  assetId: string;
  md5: string | undefined;
  expires: string | number | undefined;
  now?: Date;
}): SignatureCheck {
  const { secret, assetId, md5 } = params;
  if (!md5 || params.expires === undefined) return 'invalid';

  const expires = Number(params.expires);
  if (!Number.isInteger(expires)) return 'invalid';

  const expected = Buffer.from(mediaSignature(secret, assetId, expires));
  const actual = Buffer.from(md5);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return 'invalid';
  }

  const nowSec = Math.floor((params.now ?? new Date()).getTime() / 1000);
  return expires > nowSec ? 'ok' : 'expired';
}

/** Client renews once the remaining lifetime drops below this (HLD §3.2). */
export const RENEW_THRESHOLD_SEC = 30 * 60;

export function shouldRenew(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < RENEW_THRESHOLD_SEC * 1000;
}
