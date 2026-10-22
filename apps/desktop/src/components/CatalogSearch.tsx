import { useEffect, useRef, useState } from "react";
import type { CatalogSearchItem } from "@partspilot/shared";
import { api } from "../auth";

/** Typeahead over the catalog; profiled parts (wireable) first. */
export function CatalogSearch({ onPick, placeholder = "Search parts (e.g. HC-SR04)" }: { onPick: (item: CatalogSearchItem) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<CatalogSearchItem[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setItems([]);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchCatalog(term, 8);
        if (mine === seq.current) setItems(res.items);
      } catch {
        if (mine === seq.current) setItems([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="catalog-search">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search catalog" />
      {items.length > 0 && (
        <ul role="listbox">
          {items.map((it) => (
            <li key={it.part_id}>
              <button
                type="button"
                onClick={() => {
                  onPick(it);
                  setQ("");
                  setItems([]);
                }}
              >
                {it.name}
                {!it.has_profile && <small> · not wireable yet</small>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
