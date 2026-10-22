import { lazy, Suspense, useState } from "react";
import type { PlanResult } from "@partspilot/shared";
import { platform } from "../platform";
import { Markdown } from "./Markdown";

const WiringDiagram = lazy(() => import("../diagram/WiringDiagram").then((m) => ({ default: m.WiringDiagram })));

export function VerdictBanner({ plan }: { plan: PlanResult }) {
  const missing = plan.missing.reduce((n, m) => n + m.qty, 0);
  const text =
    plan.verdict === "yes"
      ? "Yes — you have everything you need"
      : plan.verdict === "yes_missing"
        ? `Yes — ${missing} part${missing === 1 ? "" : "s"} missing`
        : plan.verdict === "no_closest"
          ? "No — here's the closest build"
          : "We can't help with this build";
  return (
    <div className={`verdict verdict-${plan.verdict}`} role="status">
      <strong>{text}</strong>
      {plan.verdict === "no_closest" && plan.closest_reason && <p>{plan.closest_reason}</p>}
    </div>
  );
}

function MissingParts({ plan }: { plan: PlanResult }) {
  if (!plan.missing.length) return null;
  return (
    <section className="card" aria-labelledby="missing-h">
      <h2 id="missing-h">Missing parts</h2>
      <ul className="missing">
        {plan.missing.map((m) => (
          <li key={m.part_id}>
            <span className="qty">{m.qty}×</span>
            <span className="name">{m.name}</span>
            <span className="links">
              {m.buy_links.map((l) => (
                <button key={l.label} type="button" className="link" onClick={() => void platform().openExternal(l.url)}>
                  {l.label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Steps({ plan }: { plan: PlanResult }) {
  return (
    <section className="card" aria-labelledby="steps-h">
      <h2 id="steps-h">Build steps</h2>
      <ol className="steps">
        {plan.steps.map((s, i) => (
          <li key={i}>
            <Markdown text={s} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Connections({ plan }: { plan: PlanResult }) {
  const [open, setOpen] = useState(false);
  const wires = plan.diagram?.wires ?? [];
  return (
    <details className="connections" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>All {wires.length} connections</summary>
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Net</th>
          </tr>
        </thead>
        <tbody>
          {wires.map((w) => (
            <tr key={w.id}>
              <td>
                <i className="swatch" style={{ background: w.color }} /> {w.from.ref}.{w.from.pin}
              </td>
              <td>
                {w.to.ref}.{w.to.pin}
              </td>
              <td>{w.net}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function CodePanel({ plan }: { plan: PlanResult }) {
  const [copied, setCopied] = useState(false);
  if (!plan.code) return null;
  const copy = async () => {
    await platform().copyText(plan.code!.source);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <section className="card" aria-labelledby="code-h">
      <header className="card-head">
        <h2 id="code-h">
          Code <small className="muted">{plan.code.language === "micropython" ? "MicroPython" : "Arduino C++"} · {plan.code.filename}</small>
        </h2>
        <button type="button" className="primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </button>
      </header>
      {plan.libraries.length > 0 && (
        <div className="libraries">
          <strong>Libraries:</strong>
          <ul>
            {plan.libraries.map((l) => (
              <li key={l.name}>
                {l.name}
                {l.install_hint && <span className="muted"> — {l.install_hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <pre className="code" tabIndex={0}>
        <code>{plan.code.source}</code>
      </pre>
    </section>
  );
}

function Issues({ plan }: { plan: PlanResult }) {
  if (plan.validation.passed || !plan.validation.issues.length) return null;
  return (
    <section className="card issues" aria-labelledby="issues-h">
      <h2 id="issues-h">Why we can't show safe wiring yet</h2>
      <p className="muted">The electrical checker blocked this plan after {plan.validation.attempts} attempts. Changing a part above re-runs it.</p>
      <ul>
        {plan.validation.issues.map((i, k) => (
          <li key={k}>{i.message}</li>
        ))}
      </ul>
    </section>
  );
}

export function PlanView({ plan }: { plan: PlanResult }) {
  return (
    <div className="plan">
      <VerdictBanner plan={plan} />
      <header className="plan-title">
        <h1>{plan.title}</h1>
        <p>{plan.summary}</p>
      </header>
      <MissingParts plan={plan} />
      <Issues plan={plan} />
      {plan.diagram && (
        <section className="card" aria-labelledby="wiring-h">
          <h2 id="wiring-h">Wiring</h2>
          <Suspense fallback={<div className="muted">Drawing the diagram…</div>}>
            <WiringDiagram spec={plan.diagram} />
          </Suspense>
          <Connections plan={plan} />
        </section>
      )}
      {plan.steps.length > 0 && <Steps plan={plan} />}
      <CodePanel plan={plan} />
      {plan.safety_notes.length > 0 && (
        <section className="card safety" aria-labelledby="safety-h">
          <h2 id="safety-h">Safety</h2>
          <ul>
            {plan.safety_notes.map((s, i) => (
              <li key={i}>
                <Markdown text={s} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ProjectCards({ plans, onOpen }: { plans: PlanResult[]; onOpen: (id: string) => void }) {
  return (
    <div className="cards">
      {plans.map((p) => (
        <button key={p.id} type="button" className="project-card" onClick={() => onOpen(p.id)}>
          <span className={`pill verdict-${p.verdict}`}>
            {p.verdict === "yes" ? "Ready to build" : p.verdict === "yes_missing" ? `${p.missing.length} missing` : p.verdict === "no_closest" ? "Closest build" : "Not possible"}
          </span>
          <strong>{p.title}</strong>
          <span>{p.summary}</span>
        </button>
      ))}
    </div>
  );
}
