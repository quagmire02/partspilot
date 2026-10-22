import { useEffect, useMemo, useRef, useState } from "react";
import type { Job, JobPart } from "@partspilot/shared";
import { ApiRequestError } from "@partspilot/shared";
import { api } from "../auth";
import { CatalogSearch } from "./CatalogSearch";

interface Row {
  key: string;
  id?: string;
  part_id: string | null;
  name: string | null;
  quantity: number;
  confidence: number | null;
  options: { part_id: string; name: string; score: number }[];
  needsCheck: boolean;
  label: string;
}

const AUTO_SUBMIT_MS = 1200;

function rowsFrom(parts: JobPart[]): Row[] {
  return parts
    .filter((p) => !p.duplicate && p.status !== "removed")
    .map((p) => {
      const options = [...p.candidates];
      if (p.part_id && !options.some((o) => o.part_id === p.part_id)) options.unshift({ part_id: p.part_id, name: p.name ?? p.part_id, score: p.confidence });
      return {
        key: p.id,
        id: p.id,
        part_id: p.part_id,
        name: p.name,
        quantity: p.quantity,
        confidence: p.status === "added" ? null : p.confidence,
        options,
        needsCheck: p.status === "needs_check",
        label: p.label,
      };
    });
}

/**
 * Detected parts with exact names. While a job "Needs your check", edits are collected
 * and sent with "Confirm"; afterwards any change re-runs the plan automatically.
 */
export function PartsEditor({ job, parts, onHover, onSubmitted }: { job: Job; parts: JobPart[]; onHover: (id: string | null) => void; onSubmitted: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(parts));
  const [adding, setAdding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmMode = job.status === "needs_check";
  const busy = job.status === "processing";

  useEffect(() => {
    if (!dirty) {
      setRows(rowsFrom(parts));
    }
  }, [parts, dirty]);

  const incomplete = rows.some((r) => !r.part_id);

  const submit = async () => {
    if (incomplete) return setError("Pick a part for every row, or remove it.");
    setSaving(true);
    setError(null);
    try {
      await api.updateParts(job.id, {
        plan_version: job.plan_version,
        // The full desired list: rows left out are removed server-side.
        parts: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), part_id: r.part_id!, quantity: r.quantity })),
      });
      setDirty(false);
      onSubmitted();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.code === "conflict"
          ? "This result changed meanwhile — reloaded the latest version."
          : e instanceof ApiRequestError && e.code === "quota_exceeded"
            ? "Re-plan limit reached for this scan."
            : "Couldn't save your changes. Try again.",
      );
      setDirty(false);
      onSubmitted();
    } finally {
      setSaving(false);
    }
  };

  const change = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    if (!confirmMode) timer.current = setTimeout(() => void submitRef.current(), AUTO_SUBMIT_MS);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const update = (key: string, patch: Partial<Row>) => change(rows.map((r) => (r.key === key ? { ...r, ...patch, needsCheck: false } : r)));
  const remove = (row: Row) => change(rows.filter((r) => r.key !== row.key));

  const total = useMemo(() => rows.reduce((n, r) => n + r.quantity, 0), [rows]);

  return (
    <section className="card" aria-labelledby="parts-h">
      <header className="card-head">
        <h2 id="parts-h">Parts ({total})</h2>
        {!confirmMode && (saving || busy) && <span className="muted">Re-planning…</span>}
      </header>
      {confirmMode && <p className="notice warn">Some parts weren't recognised with confidence. Check the highlighted rows, then confirm.</p>}
      <table className="parts">
        <thead>
          <tr>
            <th>Part</th>
            <th className="num">Qty</th>
            <th className="num">Match</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.needsCheck || !r.part_id ? "needs" : undefined} onMouseEnter={() => onHover(r.id ?? null)} onMouseLeave={() => onHover(null)}>
              <td>
                <select
                  aria-label={`Part for “${r.label}”`}
                  value={r.part_id ?? ""}
                  disabled={busy}
                  onChange={(e) => {
                    const opt = r.options.find((o) => o.part_id === e.target.value);
                    update(r.key, { part_id: e.target.value, name: opt?.name ?? r.name, confidence: opt ? opt.score : r.confidence });
                  }}
                >
                  {!r.part_id && <option value="">Not sure — pick a part ({r.label})</option>}
                  {r.options.map((o) => (
                    <option key={o.part_id} value={o.part_id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={r.quantity}
                  disabled={busy}
                  aria-label={`Quantity of ${r.name ?? r.label}`}
                  onChange={(e) => update(r.key, { quantity: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })}
                />
              </td>
              <td className="num">{r.confidence === null ? "added" : `${Math.round(r.confidence * 100)}%`}</td>
              <td>
                <button type="button" className="icon" disabled={busy} aria-label={`Remove ${r.name ?? r.label}`} onClick={() => remove(r)}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap">
        {adding ? (
          <CatalogSearch
            onPick={(it) => {
              setAdding(false);
              change([...rows, { key: `new-${it.part_id}-${Date.now()}`, part_id: it.part_id, name: it.name, quantity: 1, confidence: null, options: [{ part_id: it.part_id, name: it.name, score: 1 }], needsCheck: false, label: it.name }]);
            }}
          />
        ) : (
          <button type="button" className="secondary" disabled={busy} onClick={() => setAdding(true)}>
            + Add part
          </button>
        )}
        {confirmMode && (
          <button type="button" className="primary" disabled={saving || incomplete || rows.length === 0} onClick={() => void submit()}>
            {saving ? "Planning…" : "Confirm parts & plan"}
          </button>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
    </section>
  );
}
