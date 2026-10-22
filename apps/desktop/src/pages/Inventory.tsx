import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, type InventoryItem } from "@partspilot/shared";
import { api } from "../auth";
import { CatalogSearch } from "../components/CatalogSearch";
import { useJobs } from "../state/jobs";

export function Inventory({ onJobCreated }: { onJobCreated: (jobId: string) => void }) {
  const { refresh } = useJobs();
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.inventory()).items);
    } catch {
      setError("Couldn't load your inventory.");
    }
  }, []);
  useEffect(() => void load(), [load]);

  const setQty = async (partId: string, quantity: number) => {
    try {
      setItems((await api.putInventory(partId, quantity)).items);
    } catch {
      setError("Couldn't save that change.");
    }
  };

  const plan = async () => {
    setPlanning(true);
    setError(null);
    try {
      const { job_id } = await api.planFromInventory({ client_request_id: crypto.randomUUID(), goal: "" });
      await refresh();
      onJobCreated(job_id);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.code === "quota_exceeded" ? "Daily limit reached. Scans reset at midnight UTC." : "Couldn't start the plan.");
    } finally {
      setPlanning(false);
    }
  };

  return (
    <section className="page" aria-labelledby="inv-h">
      <header className="page-head">
        <h1 id="inv-h">My Inventory</h1>
        <button type="button" className="primary" disabled={planning || !items?.length} onClick={() => void plan()}>
          {planning ? "Starting…" : "What can I build with my inventory?"}
        </button>
      </header>
      <p className="muted">Every part you confirmed in a scan is added here. Edit quantities any time.</p>
      {error && <p className="notice error">{error}</p>}
      {items && items.length === 0 && <p className="muted">Nothing yet — confirm parts in a scan, or add them below.</p>}
      {items && items.length > 0 && (
        <table className="parts">
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">Qty</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.part_id}>
                <td>{it.name}</td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={999}
                    defaultValue={it.quantity}
                    aria-label={`Quantity of ${it.name}`}
                    onBlur={(e) => {
                      const q = Math.max(0, Math.min(999, Number(e.target.value) || 0));
                      if (q !== it.quantity) void setQty(it.part_id, q);
                    }}
                  />
                </td>
                <td>
                  <button type="button" className="icon" aria-label={`Remove ${it.name}`} onClick={() => void setQty(it.part_id, 0)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row gap">
        {adding ? (
          <CatalogSearch
            onPick={(it) => {
              setAdding(false);
              const current = items?.find((x) => x.part_id === it.part_id)?.quantity ?? 0;
              void setQty(it.part_id, current + 1);
            }}
          />
        ) : (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            + Add part
          </button>
        )}
      </div>
    </section>
  );
}
