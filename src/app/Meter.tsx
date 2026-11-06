import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "../shared/db/api";

type Part = { role: "app" | "pagina" | "graficos"; cpu: number; mem: number };
export type MeterSample = {
  parts: Part[];
  cpu: number;
  mem: number;
  gpu: number | null;
  cores: number;
};

export const meterApi = {
  sample: async (): Promise<MeterSample> => {
    if (!isTauri) throw new Error("fora do app");
    return invoke<MeterSample>("meter_sample");
  },
};

const ROLE: Record<Part["role"], string> = {
  app: "Alfred",
  pagina: "Página",
  graficos: "Gráficos",
};
const N = 40;

const mb = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(b / 1024 ** 2)} MB`;
const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
const tone = (cpu: number) => (cpu >= 80 ? "hot" : cpu >= 25 ? "warm" : "calm");

function Spark({ data, max }: { data: number[]; max: number }) {
  if (data.length < 2)
    return <svg className="mt-spark" viewBox="0 0 100 24" aria-hidden="true" />;
  const top = Math.max(max, ...data, 1);
  const pts = data.map(
    (v, i) => `${(i / (N - 1)) * 100},${24 - (v / top) * 22 - 1}`,
  );
  const off = ((N - data.length) / (N - 1)) * 100;
  return (
    <svg
      className="mt-spark"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g transform={`translate(${off} 0)`}>
        <polygon
          points={`0,24 ${pts.join(" ")} ${((data.length - 1) / (N - 1)) * 100},24`}
        />
        <polyline points={pts.join(" ")} />
      </g>
    </svg>
  );
}

export function ResourceMeter({ compact }: { compact: boolean }) {
  const [s, setS] = useState<MeterSample | null>(null);
  const [hist, setHist] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let t = 0;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const x = await meterApi.sample();
          if (!alive) return;
          setS(x);
          setHist((h) => [...h.slice(-(N - 1)), x.cpu]);
        } catch {
          if (alive) setS(null);
        }
      }
      if (alive) t = window.setTimeout(tick, open ? 1500 : 3000);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const r = box.current?.getBoundingClientRect();
    if (r)
      setAt({
        left: r.right + 14,
        bottom: Math.max(12, window.innerHeight - r.bottom),
      });
    const out = (e: PointerEvent) =>
      !box.current?.contains(e.target as Node) &&
      !pop.current?.contains(e.target as Node) &&
      setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", out);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", out);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!s) return null;
  const level = Math.min(1, s.cpu / 100);

  return (
    <div className={`mt is-${tone(s.cpu)} ${open ? "is-open" : ""}`} ref={box}>
      {open &&
        at &&
        createPortal(
          <div
            className={`mt-pop is-${tone(s.cpu)}`}
            ref={pop}
            role="dialog"
            aria-label="Consumo do Alfred"
            style={{ left: at.left, bottom: at.bottom } as CSSProperties}
          >
            <div className="mt-pop-head">
              <span>Consumo do Alfred</span>
              <em>ao vivo</em>
            </div>
            <Spark data={hist} max={50} />
            <dl className="mt-big">
              <div>
                <dt>CPU</dt>
                <dd>{pct(s.cpu)}</dd>
              </div>
              <div>
                <dt>Memória</dt>
                <dd>{mb(s.mem)}</dd>
              </div>
              <div>
                <dt>GPU</dt>
                <dd>{s.gpu == null ? "—" : `${Math.round(s.gpu)}%`}</dd>
              </div>
            </dl>
            <ul className="mt-parts">
              {s.parts.map((p) => (
                <li key={p.role}>
                  <span>{ROLE[p.role]}</span>
                  <i
                    style={{ ["--w" as string]: `${Math.min(100, p.cpu)}%` }}
                    aria-hidden="true"
                  />
                  <b>{pct(p.cpu)}</b>
                  <em>{mb(p.mem)}</em>
                </li>
              ))}
            </ul>
            <p className="mt-help">
              100% = um núcleo inteiro, como no Monitor de Atividade. Este Mac
              tem {s.cores} núcleos.
            </p>
          </div>,
          document.body,
        )}
      <button
        className="mt-btn"
        onClick={() => setOpen((o) => !o)}
        title={`CPU ${pct(s.cpu)} · ${mb(s.mem)}${s.gpu != null ? ` · GPU ${Math.round(s.gpu)}%` : ""}`}
        aria-expanded={open}
      >
        <span
          className="mt-dial"
          style={{ ["--lv" as string]: level }}
          aria-hidden="true"
        >
          <i />
        </span>
        {!compact && (
          <span className="mt-read">
            <span>
              <b>CPU</b> {pct(s.cpu)}
            </span>
            <span>
              <b>MEM</b> {mb(s.mem)}
            </span>
            {s.gpu != null && (
              <span>
                <b>GPU</b> {Math.round(s.gpu)}%
              </span>
            )}
          </span>
        )}
      </button>
    </div>
  );
}
