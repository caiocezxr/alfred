
CREATE TABLE briefing_editions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'error')),
  judge TEXT CHECK (judge IS NULL OR judge IN ('codex', 'fallback')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  error TEXT CHECK (error IS NULL OR length(error) <= 600),
  payload TEXT CHECK (payload IS NULL OR json_valid(payload)),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (status <> 'ready' OR (payload IS NOT NULL AND finished_at IS NOT NULL AND judge IS NOT NULL)),
  CHECK (status <> 'error' OR error IS NOT NULL)
);
CREATE INDEX briefing_editions_status_date ON briefing_editions (status, date DESC);

CREATE TABLE briefing_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url TEXT NOT NULL UNIQUE CHECK (url LIKE 'https://%' AND length(url) <= 2048),
  area TEXT NOT NULL CHECK (area IN ('dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'mundo')),
  lang TEXT NOT NULL DEFAULT 'pt' CHECK (lang IN ('pt', 'en')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight BETWEEN 0.2 AND 2),
  builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
  last_status TEXT CHECK (last_status IS NULL OR last_status IN ('ok', 'error')),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 400),
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX briefing_sources_area ON briefing_sources (area, enabled);

CREATE TABLE briefing_feedback (
  id TEXT PRIMARY KEY,
  edition_date TEXT NOT NULL CHECK (edition_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 2048),
  signal TEXT NOT NULL CHECK (signal IN ('up', 'down', 'interest')),
  reason TEXT CHECK (reason IS NULL OR reason IN ('more', 'knew', 'shallow', 'not_mine')),
  origin TEXT NOT NULL CHECK (origin IN ('slide', 'triage', 'left_out')),
  area TEXT CHECK (area IS NULL OR area IN ('dinheiro', 'codigo', 'ia', 'potencializa', 'seguranca', 'mundo')),
  source_id TEXT,
  source_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 400),
  original_title TEXT NOT NULL DEFAULT '',
  kept INTEGER NOT NULL DEFAULT 0 CHECK (kept IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (edition_date, item_key),
  CHECK (reason IS NULL OR (signal = 'up' AND reason = 'more') OR (signal = 'down' AND reason IN ('knew', 'shallow', 'not_mine')))
);
CREATE INDEX briefing_feedback_recent ON briefing_feedback (updated_at DESC);
CREATE INDEX briefing_feedback_source ON briefing_feedback (source_id);

CREATE TABLE briefing_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL CHECK (json_valid(data)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO briefing_sources (id, name, url, area, lang, weight, builtin) VALUES
  ('brf-g1-mundo', 'g1 Mundo', 'https://g1.globo.com/rss/g1/mundo/', 'mundo', 'pt', 1, 1),
  ('brf-bbc-brasil', 'BBC News Brasil', 'https://feeds.bbci.co.uk/portuguese/rss.xml', 'mundo', 'pt', 1.1, 1),
  ('brf-folha-mundo', 'Folha Mundo', 'https://feeds.folha.uol.com.br/mundo/rss091.xml', 'mundo', 'pt', 1, 1),
  ('brf-folha-agora', 'Folha Em cima da hora', 'https://feeds.folha.uol.com.br/emcimadahora/rss091.xml', 'mundo', 'pt', 0.8, 1),
  ('brf-dw-brasil', 'DW Brasil', 'https://rss.dw.com/rdf/rss-br-all', 'mundo', 'pt', 0.9, 1),
  ('brf-agencia-brasil', 'Agência Brasil', 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml', 'mundo', 'pt', 0.8, 1),
  ('brf-cnn-brasil', 'CNN Brasil', 'https://www.cnnbrasil.com.br/feed/', 'mundo', 'pt', 0.8, 1),
  ('brf-thehackernews', 'The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', 'seguranca', 'en', 1, 1),
  ('brf-bleeping', 'BleepingComputer', 'https://www.bleepingcomputer.com/feed/', 'seguranca', 'en', 1, 1),
  ('brf-ciso-advisor', 'CISO Advisor', 'https://www.cisoadvisor.com.br/feed/', 'seguranca', 'pt', 1, 1),
  ('brf-the-record', 'The Record', 'https://therecord.media/feed', 'seguranca', 'en', 0.9, 1),
  ('brf-krebs', 'Krebs on Security', 'https://krebsonsecurity.com/feed/', 'seguranca', 'en', 0.9, 1),
  ('brf-infomoney', 'InfoMoney', 'https://www.infomoney.com.br/feed/', 'dinheiro', 'pt', 1, 1),
  ('brf-moneytimes', 'Money Times', 'https://www.moneytimes.com.br/feed/', 'dinheiro', 'pt', 0.9, 1),
  ('brf-g1-economia', 'g1 Economia', 'https://g1.globo.com/rss/g1/economia/', 'dinheiro', 'pt', 0.9, 1),
  ('brf-exame', 'Exame', 'https://exame.com/feed/', 'dinheiro', 'pt', 0.8, 1),
  ('brf-coindesk', 'CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/', 'dinheiro', 'en', 1, 1),
  ('brf-livecoins', 'Livecoins', 'https://livecoins.com.br/feed/', 'dinheiro', 'pt', 0.9, 1),
  ('brf-portal-bitcoin', 'Portal do Bitcoin', 'https://portaldobitcoin.uol.com.br/feed/', 'dinheiro', 'pt', 0.8, 1),
  ('brf-infoq', 'InfoQ', 'https://feed.infoq.com/', 'codigo', 'en', 1.1, 1),
  ('brf-fowler', 'Martin Fowler', 'https://martinfowler.com/feed.atom', 'codigo', 'en', 1.1, 1),
  ('brf-pragmatic', 'The Pragmatic Engineer', 'https://newsletter.pragmaticengineer.com/feed', 'codigo', 'en', 1, 1),
  ('brf-bytebytego', 'ByteByteGo', 'https://blog.bytebytego.com/feed', 'codigo', 'en', 1, 1),
  ('brf-cloudflare', 'Cloudflare Blog', 'https://blog.cloudflare.com/rss/', 'codigo', 'en', 0.9, 1),
  ('brf-github-blog', 'GitHub Blog', 'https://github.blog/feed/', 'codigo', 'en', 0.9, 1),
  ('brf-techcrunch-ai', 'TechCrunch IA', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'ia', 'en', 1, 1),
  ('brf-techcrunch', 'TechCrunch', 'https://techcrunch.com/feed/', 'potencializa', 'en', 0.8, 1),
  ('brf-producthunt', 'Product Hunt', 'https://www.producthunt.com/feed', 'potencializa', 'en', 0.8, 1),
  ('brf-show-hn', 'Show HN', 'https://hnrss.org/show', 'potencializa', 'en', 0.8, 1),
  ('brf-console', 'Console.dev', 'https://console.dev/rss.xml', 'potencializa', 'en', 1, 1),
  ('brf-tecnoblog', 'Tecnoblog', 'https://tecnoblog.net/feed/', 'potencializa', 'pt', 0.8, 1);
