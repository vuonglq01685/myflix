import { ErrorCode, ERROR_HTTP_STATUS, MAX_PROFILES_PER_USER } from '@myflix/shared';
import { BusinessError } from './common/filters/all-exceptions.filter';
import { ProfilesService } from './profiles/profiles.service';
import { PlaybackService } from './playback/playback.service';
import { AdminContentService } from './admin/services/admin-content.service';

/** The business rules the database cannot enforce for us. */

describe('BR-002 / DI-06 — five profiles per account', () => {
  const service = (count: number) =>
    new ProfilesService({ profile: { count: async () => count } } as never);

  it('allows the fifth profile', async () => {
    await expect(
      service(MAX_PROFILES_PER_USER - 1).assertUnderProfileLimit('u1'),
    ).resolves.toBeUndefined();
  });

  it('refuses the sixth with PROFILE_LIMIT_REACHED', async () => {
    await expect(service(MAX_PROFILES_PER_USER).assertUnderProfileLimit('u1')).rejects.toMatchObject(
      { errorCode: ErrorCode.PROFILE_LIMIT_REACHED },
    );
  });
});

describe('DI-10 — only a READY asset is playable', () => {
  const service = (status: string | null) =>
    new PlaybackService(
      { mediaAsset: { findUnique: async () => (status ? { status } : null) } } as never,
      {} as never,
    );

  it('lets a READY asset through', async () => {
    await expect(service('READY').assertPlayable('a1')).resolves.toBeUndefined();
  });

  it.each(['UPLOADING', 'ENCODING', 'FAILED'])('rejects a %s asset', async (status) => {
    await expect(service(status).assertPlayable('a1')).rejects.toMatchObject({
      errorCode: ErrorCode.ASSET_NOT_READY,
    });
  });

  it('rejects an asset that does not exist', async () => {
    await expect(service(null).assertPlayable('a1')).rejects.toMatchObject({
      errorCode: ErrorCode.ASSET_NOT_READY,
    });
  });
});

describe('DI-07 — a title needs playable content before it can be published', () => {
  interface UpdateArgs {
    where: { id: string };
    data: { status: string; publishedAt?: Date };
  }

  const build = (readyAssets: number) => {
    const update = jest.fn((args: UpdateArgs) =>
      Promise.resolve({ id: args.where.id, status: args.data.status }),
    );
    const service = new AdminContentService(
      { mediaAsset: { count: async () => readyAssets }, title: { update } } as never,
      { invalidate: jest.fn() } as never,
    );
    return { service, update };
  };

  it('refuses with TITLE_NOT_PUBLISHABLE and leaves the row untouched', async () => {
    const { service, update } = build(0);
    await expect(service.publish('t1')).rejects.toMatchObject({
      errorCode: ErrorCode.TITLE_NOT_PUBLISHABLE,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('publishes and stamps published_at once one asset is READY', async () => {
    const { service, update } = build(1);
    await expect(service.publish('t1')).resolves.toEqual({ id: 't1', status: 'PUBLISHED' });
    // ck_published_needs_date would reject the row without this.
    expect(update.mock.calls[0]?.[0].data.publishedAt).toBeInstanceOf(Date);
  });
});

describe('error envelope', () => {
  it('maps every business error code to the documented HTTP status', () => {
    expect(new BusinessError(ErrorCode.SIGNED_URL_EXPIRED, 'x').getStatus()).toBe(410);
    expect(new BusinessError(ErrorCode.JOB_ALREADY_RUNNING, 'x').getStatus()).toBe(409);
    expect(new BusinessError(ErrorCode.STORAGE_QUOTA_EXCEEDED, 'x').getStatus()).toBe(507);
    expect(new BusinessError(ErrorCode.PROFILE_NOT_OWNED, 'x').getStatus()).toBe(403);

    for (const code of Object.values(ErrorCode)) {
      expect(new BusinessError(code, 'x').getStatus()).toBe(ERROR_HTTP_STATUS[code]);
    }
  });
});
