-- MyFlix initial schema. Authoritative DDL (doc 04).
-- Everything Prisma cannot express — CHECK constraints, partial indexes, the
-- GENERATED search_vector, monthly partitioning — is spelled out here.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE user_role     AS ENUM ('VIEWER', 'ADMIN');
CREATE TYPE title_type    AS ENUM ('MOVIE', 'SERIES');
CREATE TYPE title_status  AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE asset_kind    AS ENUM ('MOVIE', 'EPISODE', 'TRAILER');
CREATE TYPE asset_status  AS ENUM ('UPLOADING','QUEUED','PROBING','ENCODING',
                                   'PACKAGING','COMMITTING','READY','FAILED');
CREATE TYPE subtitle_kind AS ENUM ('SUBTITLES', 'CAPTIONS', 'FORCED');
CREATE TYPE job_status    AS ENUM ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED');

-- ─── users ───────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'VIEWER',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── profiles ────────────────────────────────────────────────────────────────
CREATE TABLE profiles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              VARCHAR(50) NOT NULL,
    avatar_key        TEXT,
    is_kids           BOOLEAN NOT NULL DEFAULT FALSE,
    language          VARCHAR(10) NOT NULL DEFAULT 'vi',
    autoplay_next     BOOLEAN NOT NULL DEFAULT TRUE,
    autoplay_previews BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_profile_name_per_user UNIQUE (user_id, name)
);
CREATE INDEX idx_profiles_user ON profiles(user_id);
-- DI-06 (max 5 profiles per user) is application-enforced: Postgres has no
-- compact way to express it. See BR-002.

-- ─── titles ──────────────────────────────────────────────────────────────────
CREATE TABLE titles (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             title_type   NOT NULL,
    status           title_status NOT NULL DEFAULT 'DRAFT',
    name             VARCHAR(255) NOT NULL,
    original_name    VARCHAR(255),
    synopsis         TEXT,
    release_year     SMALLINT,
    maturity_rating  VARCHAR(10),
    poster_key       TEXT,
    backdrop_key     TEXT,
    logo_key         TEXT,
    trailer_asset_id UUID,
    cast_members     JSONB NOT NULL DEFAULT '[]'::jsonb,
    directors        JSONB NOT NULL DEFAULT '[]'::jsonb,
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 'simple', not 'english': stemming mangles proper nouns and Vietnamese.
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(name, '')),          'A') ||
        setweight(to_tsvector('simple', coalesce(original_name, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(synopsis, '')),      'C')
    ) STORED,

    CONSTRAINT ck_published_needs_date
        CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE INDEX idx_titles_status_published ON titles(status, published_at DESC);
CREATE INDEX idx_titles_search    ON titles USING GIN (search_vector);
CREATE INDEX idx_titles_name_trgm ON titles USING GIN (name gin_trgm_ops);
CREATE INDEX idx_titles_type      ON titles(type) WHERE status = 'PUBLISHED';

-- ─── seasons ─────────────────────────────────────────────────────────────────
CREATE TABLE seasons (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title_id   UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    number     SMALLINT NOT NULL,
    name       VARCHAR(100),
    synopsis   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_season_number        UNIQUE (title_id, number),
    CONSTRAINT ck_season_number_positive CHECK (number > 0)
);
CREATE INDEX idx_seasons_title ON seasons(title_id, number);

-- ─── episodes ────────────────────────────────────────────────────────────────
CREATE TABLE episodes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id         UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    number            SMALLINT NOT NULL,
    name              VARCHAR(255) NOT NULL,
    synopsis          TEXT,
    still_key         TEXT,
    intro_start_sec   INTEGER,
    intro_end_sec     INTEGER,
    credits_start_sec INTEGER,
    air_date          DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_episode_number          UNIQUE (season_id, number),
    CONSTRAINT ck_episode_number_positive CHECK (number > 0),
    CONSTRAINT ck_intro_range CHECK (
        intro_start_sec IS NULL OR intro_end_sec IS NULL
        OR intro_end_sec > intro_start_sec
    )
);
CREATE INDEX idx_episodes_season ON episodes(season_id, number);

-- ─── media_assets ────────────────────────────────────────────────────────────
CREATE TABLE media_assets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind              asset_kind   NOT NULL,
    status            asset_status NOT NULL DEFAULT 'UPLOADING',

    title_id          UUID REFERENCES titles(id)   ON DELETE CASCADE,
    episode_id        UUID REFERENCES episodes(id) ON DELETE CASCADE,

    source_key        TEXT,
    source_size_bytes BIGINT,
    source_codec      VARCHAR(30),
    duration_sec      INTEGER,
    width             SMALLINT,
    height            SMALLINT,
    frame_rate        NUMERIC(6,3),

    hls_master_key    TEXT,
    preview_clip_key  TEXT,
    sprite_key        TEXT,
    sprite_vtt_key    TEXT,

    output_size_bytes BIGINT,
    error_message     TEXT,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at          TIMESTAMPTZ,

    -- ADR-004: exactly one owner, enforced by the database.
    CONSTRAINT ck_asset_owner CHECK (
        (title_id IS NOT NULL AND episode_id IS NULL) OR
        (title_id IS NULL AND episode_id IS NOT NULL)
    ),
    CONSTRAINT ck_ready_needs_master CHECK (
        status <> 'READY' OR hls_master_key IS NOT NULL
    )
);
CREATE UNIQUE INDEX uq_asset_per_episode ON media_assets(episode_id)
    WHERE episode_id IS NOT NULL AND kind = 'EPISODE';
CREATE UNIQUE INDEX uq_movie_asset_per_title ON media_assets(title_id)
    WHERE title_id IS NOT NULL AND kind = 'MOVIE';
CREATE INDEX idx_assets_status ON media_assets(status) WHERE status <> 'READY';

-- ─── renditions ──────────────────────────────────────────────────────────────
CREATE TABLE renditions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id     UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    height       SMALLINT NOT NULL,
    width        SMALLINT NOT NULL,
    bitrate_kbps INTEGER NOT NULL,
    codec        VARCHAR(20) NOT NULL,
    playlist_key TEXT NOT NULL,
    size_bytes   BIGINT,

    CONSTRAINT uq_rendition UNIQUE (asset_id, height, codec)
);
CREATE INDEX idx_renditions_asset ON renditions(asset_id);

-- ─── subtitle_tracks ─────────────────────────────────────────────────────────
CREATE TABLE subtitle_tracks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id     UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    lang         VARCHAR(10) NOT NULL,
    label        VARCHAR(50) NOT NULL,
    kind         subtitle_kind NOT NULL DEFAULT 'SUBTITLES',
    is_default   BOOLEAN NOT NULL DEFAULT FALSE,
    source_key   TEXT,
    playlist_key TEXT NOT NULL,

    CONSTRAINT uq_subtitle_lang UNIQUE (asset_id, lang, kind)
);
CREATE UNIQUE INDEX uq_one_default_subtitle ON subtitle_tracks(asset_id)
    WHERE is_default = TRUE;
CREATE INDEX idx_subtitles_asset ON subtitle_tracks(asset_id);

-- ─── genres ──────────────────────────────────────────────────────────────────
CREATE TABLE genres (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug       VARCHAR(50) NOT NULL UNIQUE,
    name       VARCHAR(50) NOT NULL,
    sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE title_genres (
    title_id UUID NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
    genre_id UUID NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (title_id, genre_id)
);
CREATE INDEX idx_title_genres_genre ON title_genres(genre_id);

-- ─── watch_progress ──────────────────────────────────────────────────────────
CREATE TABLE watch_progress (
    profile_id   UUID NOT NULL REFERENCES profiles(id)     ON DELETE CASCADE,
    asset_id     UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    position_sec INTEGER NOT NULL DEFAULT 0,
    completed    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (profile_id, asset_id),
    CONSTRAINT ck_position_non_negative CHECK (position_sec >= 0)
);
-- Serves the Continue Watching query, the hottest read on the home page.
CREATE INDEX idx_progress_continue ON watch_progress(profile_id, updated_at DESC)
    WHERE completed = FALSE;

-- ─── my_list ─────────────────────────────────────────────────────────────────
CREATE TABLE my_list (
    profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title_id   UUID NOT NULL REFERENCES titles(id)   ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (profile_id, title_id)
);
CREATE INDEX idx_mylist_profile ON my_list(profile_id, created_at DESC);

-- ─── transcode_jobs ──────────────────────────────────────────────────────────
CREATE TABLE transcode_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id      UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    bull_job_id   VARCHAR(100),
    status        job_status NOT NULL DEFAULT 'QUEUED',
    stage         VARCHAR(30),
    percent       SMALLINT NOT NULL DEFAULT 0,
    attempt       SMALLINT NOT NULL DEFAULT 1,
    encoder       VARCHAR(30),
    avg_speed     NUMERIC(6,2),
    log_text      TEXT,
    error_message TEXT,
    queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at    TIMESTAMPTZ,
    finished_at   TIMESTAMPTZ,

    CONSTRAINT ck_percent_range CHECK (percent BETWEEN 0 AND 100)
);
CREATE INDEX idx_jobs_asset  ON transcode_jobs(asset_id, queued_at DESC);
CREATE INDEX idx_jobs_active ON transcode_jobs(status)
    WHERE status IN ('QUEUED', 'RUNNING');

-- ─── playback_events (partitioned monthly) ───────────────────────────────────
CREATE TABLE playback_events (
    id                   BIGSERIAL,
    profile_id           UUID NOT NULL,
    asset_id             UUID NOT NULL,
    session_id           UUID NOT NULL,
    startup_time_ms      INTEGER,
    rebuffer_count       SMALLINT NOT NULL DEFAULT 0,
    rebuffer_duration_ms INTEGER NOT NULL DEFAULT 0,
    bitrate_switches     SMALLINT NOT NULL DEFAULT 0,
    avg_bitrate_kbps     INTEGER,
    watched_sec          INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Bootstrap partitions. A background job rolls the next month and drops
-- anything older than six months.
CREATE TABLE playback_events_2026_09 PARTITION OF playback_events
    FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE playback_events_2026_10 PARTITION OF playback_events
    FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE playback_events_default PARTITION OF playback_events DEFAULT;

-- ─── deletion_queue ──────────────────────────────────────────────────────────
CREATE TABLE deletion_queue (
    id         BIGSERIAL PRIMARY KEY,
    bucket     VARCHAR(64) NOT NULL,
    object_key TEXT NOT NULL,
    is_prefix  BOOLEAN NOT NULL DEFAULT FALSE,
    attempts   SMALLINT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_deletion_pending ON deletion_queue(deleted_at, created_at);
