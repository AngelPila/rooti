-- Vecinos: what farmers nearby saw. Run on every start (idempotent).
-- A post never stores a phone number or coordinates: the author is a masked name, the place is a zone key.
CREATE TABLE IF NOT EXISTS vec_posts (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('asi_me_fue', 'aviso', 'pregunta')),
  zone        TEXT NOT NULL,                       -- pilot zone (daule, babahoyo, quevedo) or pt:<lat>,<lon> rounded to 0.1°
  crop        TEXT,                                -- crop id from app/data/crops.json
  sow_month   SMALLINT CHECK (sow_month BETWEEN 1 AND 12),
  sow_year    SMALLINT,
  result      TEXT CHECK (result IN ('bien', 'regular', 'perdio')),
  area        REAL,
  unit        TEXT,
  text        TEXT,                                -- what a farmer wrote, in their own language
  text_es     TEXT,                                -- example posts ship in both languages
  text_en     TEXT,
  author      TEXT NOT NULL,                       -- "Pedro R.": first name and last initial only
  role        TEXT CHECK (role IN ('tecnico')),    -- only set by seed or by hand, never from the web form
  source      TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'whatsapp', 'example')),
  example     BOOLEAN NOT NULL DEFAULT false,
  hidden      BOOLEAN NOT NULL DEFAULT false,      -- set by a moderator
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vec_posts_zone ON vec_posts (zone, created_at DESC);

CREATE TABLE IF NOT EXISTS vec_replies (
  id          BIGSERIAL PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES vec_posts (id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  role        TEXT CHECK (role IN ('tecnico')),
  text        TEXT,
  text_es     TEXT,
  text_en     TEXT,
  example     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vec_replies_post ON vec_replies (post_id, created_at);

-- One report per device and post. A post with 3 or more reports leaves the feed until a moderator looks at it.
CREATE TABLE IF NOT EXISTS vec_reports (
  post_id     TEXT NOT NULL REFERENCES vec_posts (id) ON DELETE CASCADE,
  reporter    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, reporter)
);
