# Sons do livro (Bíblia)

O leitor encontra os arquivos desta pasta sozinho (`import.meta.glob` em `src/features/bible/sound.ts`), decodifica uma vez e guarda em memória.
Se um arquivo faltar ou não abrir, aquele som cai numa síntese suave de papel (ou fica em silêncio, no caso do pouso).

| Arquivo | Quando toca |
|---|---|
| `page-1.m4a`, `page-2.m4a`, `page-3.m4a` | virada de página; sorteia um (sem repetir o anterior), volume e velocidade seguem a força do gesto |
| `book-open.m4a` | início da abertura da capa |
| `book-place.m4a` | capa assentando no fim da abertura (e bem baixo no fim do fechamento) |
| `book-close.m4a` | capa encontrando as folhas ao fechar |

Formato: AAC (`.m4a`) mono, 44,1 ou 48 kHz, curto (até ~1 s), volumes já nivelados, com fade de entrada e saída. Também aceita `.mp3`, `.ogg`, `.wav` ou `.aac` com o mesmo nome.
Cada toque varia a velocidade em ±5% para não soar repetido. Liga/desliga e volume ficam em Ajustes de leitura (Aa).
Créditos das amostras em `CREDITOS.md` (não apagar).
