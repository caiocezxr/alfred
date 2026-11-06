
CREATE TABLE feed_sources (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  url             TEXT NOT NULL UNIQUE CHECK ((url LIKE 'https://%' OR url LIKE 'http://%') AND length(url) <= 2048),
  category        TEXT NOT NULL CHECK (category IN ('ai_dev', 'ai_content', 'stack', 'auto')),
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  weight          REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0.2 AND 2),
  builtin         INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  last_status     TEXT CHECK (last_status IS NULL OR last_status IN ('ok', 'error')),
  last_error      TEXT CHECK (last_error IS NULL OR length(last_error) <= 400),
  last_fetched_at TEXT,
  last_ok_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE feed_items (
  id            TEXT PRIMARY KEY,
  source_id     TEXT REFERENCES feed_sources (id) ON DELETE SET NULL,
  source_name   TEXT NOT NULL,
  guid          TEXT CHECK (guid IS NULL OR length(guid) <= 500),
  url           TEXT NOT NULL CHECK (url LIKE 'https://%' OR url LIKE 'http://%'),
  canonical_url TEXT NOT NULL UNIQUE CHECK (canonical_url LIKE 'https://%'),
  title         TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  title_key     TEXT NOT NULL,
  excerpt       TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 600),
  category      TEXT NOT NULL CHECK (category IN ('ai_dev', 'ai_content', 'stack', 'other')),
  relevance     REAL NOT NULL DEFAULT 0,
  published_at  TEXT CHECK (published_at IS NULL OR published_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  fetched_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at       TEXT,
  saved_at      TEXT,
  dismissed_at  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX feed_items_recent ON feed_items (COALESCE(published_at, fetched_at) DESC);
CREATE INDEX feed_items_category ON feed_items (category, published_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX feed_items_saved ON feed_items (saved_at DESC) WHERE saved_at IS NOT NULL;
CREATE INDEX feed_items_unread ON feed_items (published_at DESC) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX feed_items_source_guid ON feed_items (source_id, guid);
CREATE INDEX feed_items_title_key ON feed_items (title_key);

CREATE TABLE feed_item_tombstones (
  canonical_url TEXT PRIMARY KEY,
  removed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) WITHOUT ROWID;

CREATE TABLE radar_keywords (
  id         TEXT PRIMARY KEY,
  term       TEXT NOT NULL UNIQUE CHECK (length(trim(term)) BETWEEN 1 AND 60 AND term = lower(term)),
  kind       TEXT NOT NULL CHECK (kind IN ('boost', 'mute')),
  category   TEXT CHECK (category IS NULL OR category IN ('ai_dev', 'ai_content', 'stack')),
  weight     REAL NOT NULL CHECK (weight > 0 AND weight <= 5),
  builtin    INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind = 'boost' OR category IS NULL)
);

INSERT INTO feed_sources (id, name, url, category, weight, builtin) VALUES
  ('seed-openai',         'OpenAI News',          'https://openai.com/news/rss.xml',                              'auto',       1,   1),
  ('seed-deepmind',       'Google DeepMind',      'https://deepmind.google/blog/rss.xml',                         'auto',       1,   1),
  ('seed-hn',             'Hacker News',          'https://hnrss.org/frontpage',                                  'auto',       0.8, 1),
  ('seed-simonw',         'Simon Willison',       'https://simonwillison.net/atom/everything/',                   'ai_dev',     1.1, 1),
  ('seed-hf',             'Hugging Face',         'https://huggingface.co/blog/feed.xml',                         'ai_dev',     0.9, 1),
  ('seed-gh-changelog',   'GitHub Changelog',     'https://github.blog/changelog/feed/',                          'stack',      0.9, 1),
  ('seed-claude-code',    'Claude Code',          'https://github.com/anthropics/claude-code/releases.atom',      'ai_dev',     1.2, 1),
  ('seed-codex',          'Codex CLI',            'https://github.com/openai/codex/releases.atom',                'ai_dev',     1,   1),
  ('seed-google-ai',      'Google AI',            'https://blog.google/technology/ai/rss/',                       'auto',       1,   1),
  ('seed-elevenlabs',     'ElevenLabs',           'https://elevenlabs.io/blog/rss.xml',                           'ai_content', 1,   1),
  ('seed-youtube',        'YouTube Blog',         'https://blog.youtube/rss/',                                    'ai_content', 0.8, 1),
  ('seed-decoder',        'The Decoder',          'https://the-decoder.com/feed/',                                'auto',       0.9, 1),
  ('seed-tauri',          'Tauri',                'https://github.com/tauri-apps/tauri/releases.atom',            'stack',      1,   1),
  ('seed-vite',           'Vite',                 'https://github.com/vitejs/vite/releases.atom',                 'stack',      1,   1),
  ('seed-react',          'React',                'https://github.com/facebook/react/releases.atom',              'stack',      1,   1),
  ('seed-typescript',     'TypeScript',           'https://github.com/microsoft/TypeScript/releases.atom',        'stack',      1,   1),
  ('seed-threejs',        'three.js',             'https://github.com/mrdoob/three.js/tags.atom',             'stack',      0.9, 1),
  ('seed-rust',           'Rust Blog',            'https://blog.rust-lang.org/feed.xml',                          'stack',      0.9, 1);

INSERT INTO radar_keywords (id, term, kind, category, weight, builtin)
SELECT lower(hex(randomblob(16))), term, kind, category, weight, 1
FROM (
  SELECT 'claude code' AS term, 'boost' AS kind, 'ai_dev' AS category, 3 AS weight
  UNION ALL SELECT 'coding agent*', 'boost', 'ai_dev', 3
  UNION ALL SELECT 'context engineering', 'boost', 'ai_dev', 2.5
  UNION ALL SELECT 'codex', 'boost', 'ai_dev', 2.5
  UNION ALL SELECT 'mcp', 'boost', 'ai_dev', 2.5
  UNION ALL SELECT 'model context protocol', 'boost', 'ai_dev', 2.5
  UNION ALL SELECT 'agent*', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'coding', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'code review', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'sdk', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'cli', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'copilot', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'eval*', 'boost', 'ai_dev', 2
  UNION ALL SELECT 'api', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'ide', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'cursor', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'vs code', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'vscode', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'llm*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'prompt engineering', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'prompting', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'system prompt*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'context window', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'rag', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'embedding*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'benchmark*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'fine-tun*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'tool use', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'function calling', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'structured output*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'open weight*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'developer*', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'claude', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'gpt', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'gemini', 'boost', 'ai_dev', 1.5
  UNION ALL SELECT 'reasoning', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'inference', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'llama', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'qwen', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'deepseek', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'mistral', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'ollama', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'pull request*', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'terminal', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'automation', 'boost', 'ai_dev', 1
  UNION ALL SELECT 'sora', 'boost', 'ai_content', 2.5
  UNION ALL SELECT 'veo', 'boost', 'ai_content', 2.5
  UNION ALL SELECT 'video*', 'boost', 'ai_content', 2
  UNION ALL SELECT 'voice*', 'boost', 'ai_content', 2
  UNION ALL SELECT 'text to speech', 'boost', 'ai_content', 2
  UNION ALL SELECT 'tts', 'boost', 'ai_content', 2
  UNION ALL SELECT 'dubbing', 'boost', 'ai_content', 2
  UNION ALL SELECT 'creator*', 'boost', 'ai_content', 2
  UNION ALL SELECT 'imagen', 'boost', 'ai_content', 2
  UNION ALL SELECT 'nano banana', 'boost', 'ai_content', 2
  UNION ALL SELECT 'midjourney', 'boost', 'ai_content', 2
  UNION ALL SELECT 'runway', 'boost', 'ai_content', 2
  UNION ALL SELECT 'kling', 'boost', 'ai_content', 2
  UNION ALL SELECT 'elevenlabs', 'boost', 'ai_content', 2
  UNION ALL SELECT 'lyria', 'boost', 'ai_content', 2
  UNION ALL SELECT 'suno', 'boost', 'ai_content', 2
  UNION ALL SELECT 'generative media', 'boost', 'ai_content', 2
  UNION ALL SELECT 'image*', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'audio', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'speech', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'music', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'editing', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'youtube', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'tiktok', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'instagram', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'shorts', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'reels', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'thumbnail*', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'roteiro*', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'monetiz*', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'heygen', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'descript', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'capcut', 'boost', 'ai_content', 1.5
  UNION ALL SELECT 'clip', 'boost', 'ai_content', 1
  UNION ALL SELECT 'podcast*', 'boost', 'ai_content', 1
  UNION ALL SELECT 'avatar*', 'boost', 'ai_content', 1
  UNION ALL SELECT 'animation', 'boost', 'ai_content', 1
  UNION ALL SELECT 'storytelling', 'boost', 'ai_content', 1
  UNION ALL SELECT 'tauri', 'boost', 'stack', 2.5
  UNION ALL SELECT 'react', 'boost', 'stack', 2
  UNION ALL SELECT 'vite', 'boost', 'stack', 2
  UNION ALL SELECT 'typescript', 'boost', 'stack', 2
  UNION ALL SELECT 'rust', 'boost', 'stack', 2
  UNION ALL SELECT 'sqlite', 'boost', 'stack', 2
  UNION ALL SELECT 'three.js', 'boost', 'stack', 2
  UNION ALL SELECT 'webgpu', 'boost', 'stack', 1.5
  UNION ALL SELECT 'webkit', 'boost', 'stack', 1.5
  UNION ALL SELECT 'macos', 'boost', 'stack', 1.5
  UNION ALL SELECT 'node.js', 'boost', 'stack', 1.5
  UNION ALL SELECT 'tiptap', 'boost', 'stack', 1.5
  UNION ALL SELECT 'rolldown', 'boost', 'stack', 1.5
  UNION ALL SELECT 'javascript', 'boost', 'stack', 1
  UNION ALL SELECT 'webgl', 'boost', 'stack', 1
  UNION ALL SELECT 'wasm', 'boost', 'stack', 1
  UNION ALL SELECT 'webassembly', 'boost', 'stack', 1
  UNION ALL SELECT 'css', 'boost', 'stack', 1
  UNION ALL SELECT 'swift', 'boost', 'stack', 1
  UNION ALL SELECT 'safari', 'boost', 'stack', 1
  UNION ALL SELECT 'deno', 'boost', 'stack', 1
  UNION ALL SELECT 'bun', 'boost', 'stack', 1
  UNION ALL SELECT 'postgres*', 'boost', 'stack', 1
  UNION ALL SELECT 'vitest', 'boost', 'stack', 1
  UNION ALL SELECT 'npm', 'boost', 'stack', 1
  UNION ALL SELECT 'breaking', 'boost', NULL, 2.5
  UNION ALL SELECT 'vulnerabilit*', 'boost', NULL, 2
  UNION ALL SELECT 'cve', 'boost', NULL, 2
  UNION ALL SELECT 'deprecat*', 'boost', NULL, 1.5
  UNION ALL SELECT 'security', 'boost', NULL, 1.5
  UNION ALL SELECT 'introducing', 'boost', NULL, 1.5
  UNION ALL SELECT 'now available', 'boost', NULL, 1.5
  UNION ALL SELECT 'general availability', 'boost', NULL, 1.5
  UNION ALL SELECT 'pricing', 'boost', NULL, 1.5
  UNION ALL SELECT 'rate limit*', 'boost', NULL, 1.5
  UNION ALL SELECT 'migration', 'boost', NULL, 1
  UNION ALL SELECT 'launch*', 'boost', NULL, 1
  UNION ALL SELECT 'open source*', 'boost', NULL, 1
  UNION ALL SELECT 'lancamento', 'boost', NULL, 1
  UNION ALL SELECT 'hiring', 'mute', NULL, 3
  UNION ALL SELECT 'careers', 'mute', NULL, 3
  UNION ALL SELECT 'job opening*', 'mute', NULL, 3
  UNION ALL SELECT 'vaga*', 'mute', NULL, 3
  UNION ALL SELECT 'sponsored', 'mute', NULL, 3
  UNION ALL SELECT 'giveaway', 'mute', NULL, 3
  UNION ALL SELECT 'coupon*', 'mute', NULL, 3
  UNION ALL SELECT 'black friday', 'mute', NULL, 3
  UNION ALL SELECT 'board of directors', 'mute', NULL, 3
  UNION ALL SELECT 'webinar*', 'mute', NULL, 2.5
  UNION ALL SELECT 'meetup*', 'mute', NULL, 2
  UNION ALL SELECT 'register now', 'mute', NULL, 2
  UNION ALL SELECT 'join us', 'mute', NULL, 2
  UNION ALL SELECT 'inscric*', 'mute', NULL, 2
  UNION ALL SELECT 'partnership*', 'mute', NULL, 2
  UNION ALL SELECT 'partners with', 'mute', NULL, 2
  UNION ALL SELECT 'appoint*', 'mute', NULL, 2
  UNION ALL SELECT 'funding', 'mute', NULL, 2
  UNION ALL SELECT 'valuation', 'mute', NULL, 2
  UNION ALL SELECT 'economic*', 'mute', NULL, 2
  UNION ALL SELECT 'economy', 'mute', NULL, 2
  UNION ALL SELECT 'election*', 'mute', NULL, 2
  UNION ALL SELECT 'public sector', 'mute', NULL, 2
  UNION ALL SELECT 'customer stor*', 'mute', NULL, 2
  UNION ALL SELECT 'case stud*', 'mute', NULL, 2
  UNION ALL SELECT 'discount*', 'mute', NULL, 2
  UNION ALL SELECT 'crypto*', 'mute', NULL, 2
  UNION ALL SELECT 'bitcoin', 'mute', NULL, 2
  UNION ALL SELECT 'nft*', 'mute', NULL, 2
  UNION ALL SELECT 'web3', 'mute', NULL, 2
  UNION ALL SELECT 'conference', 'mute', NULL, 1.5
  UNION ALL SELECT 'summit', 'mute', NULL, 1.5
  UNION ALL SELECT 'livestream*', 'mute', NULL, 1.5
  UNION ALL SELECT 'evento*', 'mute', NULL, 1.5
  UNION ALL SELECT 'raises', 'mute', NULL, 1.5
  UNION ALL SELECT 'acquisition', 'mute', NULL, 1.5
  UNION ALL SELECT 'acquires', 'mute', NULL, 1.5
  UNION ALL SELECT 'lawsuit', 'mute', NULL, 1.5
  UNION ALL SELECT 'policy', 'mute', NULL, 1.5
  UNION ALL SELECT 'policies', 'mute', NULL, 1.5
  UNION ALL SELECT 'blueprint', 'mute', NULL, 1.5
  UNION ALL SELECT 'government', 'mute', NULL, 1.5
  UNION ALL SELECT 'nonprofit*', 'mute', NULL, 1.5
  UNION ALL SELECT 'teachers', 'mute', NULL, 1.5
  UNION ALL SELECT 'healthcare', 'mute', NULL, 1.5
  UNION ALL SELECT 'builds with', 'mute', NULL, 1.5
  UNION ALL SELECT 'year in review', 'mute', NULL, 1.5
  UNION ALL SELECT 'blockchain', 'mute', NULL, 1.5
  UNION ALL SELECT 'newsletter', 'mute', NULL, 1.5
  UNION ALL SELECT 'keynote', 'mute', NULL, 1
  UNION ALL SELECT 'recap', 'mute', NULL, 1
  UNION ALL SELECT 'education', 'mute', NULL, 1
  UNION ALL SELECT 'students', 'mute', NULL, 1
);
