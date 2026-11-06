ALTER TABLE feed_items ADD COLUMN title_pt TEXT CHECK (title_pt IS NULL OR length(title_pt) BETWEEN 1 AND 300);
ALTER TABLE feed_items ADD COLUMN excerpt_pt TEXT CHECK (excerpt_pt IS NULL OR length(excerpt_pt) <= 600);
