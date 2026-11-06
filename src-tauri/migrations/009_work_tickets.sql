ALTER TABLE work_companies ADD COLUMN ticket_url TEXT CHECK (ticket_url IS NULL OR ((ticket_url LIKE 'http://%' OR ticket_url LIKE 'https://%') AND instr(ticket_url, '{id}') > 0 AND length(ticket_url) <= 500));
ALTER TABLE work_companies ADD COLUMN sla_response_min INTEGER CHECK (sla_response_min IS NULL OR sla_response_min BETWEEN 1 AND 525600);
ALTER TABLE work_companies ADD COLUMN sla_resolution_min INTEGER CHECK (sla_resolution_min IS NULL OR sla_resolution_min BETWEEN 1 AND 525600);

CREATE TABLE work_snippets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES work_companies (id) ON UPDATE CASCADE ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX work_snippets_company ON work_snippets (company_id, sort);
CREATE UNIQUE INDEX work_snippets_default ON work_snippets (company_id) WHERE is_default = 1;

INSERT INTO work_snippets (id, company_id, title, body, is_default, sort)
SELECT 'statix-recebido', id, 'Recebido', 'Olá! Recebi o chamado {chamado} ({titulo}) e já estou analisando. Retorno com uma posição até {prazo}.', 1, 1 FROM work_companies WHERE id = 'statix'
UNION ALL
SELECT 'statix-entregue', id, 'Entregue para validação', 'O ajuste do chamado {chamado} foi entregue. Pode validar, por favor? Qualquer divergência me avise por aqui.', 0, 2 FROM work_companies WHERE id = 'statix'
UNION ALL
SELECT 'livelo-recebido', id, 'Recebido', 'Oi! Peguei o {chamado} ({titulo}). Sigo com a análise e atualizo o ticket até {prazo}.', 1, 1 FROM work_companies WHERE id = 'livelo'
UNION ALL
SELECT 'livelo-hml', id, 'Disponível em HML', 'O {chamado} está disponível em homologação com as evidências anexadas. Podem testar?', 0, 2 FROM work_companies WHERE id = 'livelo';
