"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { getJson, logsFetch, STATUS_LABELS, when, type CaseRecord, type CaseStatus } from "../../lib/logs";
import { guideFor } from "../../lib/rotation";
import { typeLabel } from "../../lib/scan";
import { Stat } from "../shared";

const STATUS_ORDER: CaseStatus[] = ["open", "owner_notified", "rotated", "closed", "false_alarm"];

export function Cases({ focus }: { focus: string }) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | CaseStatus>("all");
  const [openId, setOpenId] = useState(focus);
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState("");

  const load = useCallback(() => {
    getJson<CaseRecord[]>("/api/cases")
      .then((c) => {
        setCases(c);
        setError("");
      })
      .catch(() => setError("Could not reach the API on port 4100."));
  }, []);

  useEffect(load, [load]);
  useEffect(() => setOpenId(focus), [focus]);

  const current = cases.find((c) => c.id === openId);
  useEffect(() => setOwner(current?.owner ?? ""), [current?.id, current?.owner]);

  async function update(id: string, body: { status?: CaseStatus; note?: string; owner?: string }) {
    try {
      await logsFetch(`/api/cases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      setError("Could not save the change.");
      return;
    }
    setNote("");
    setError("");
    load();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of cases) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [cases]);
  const shown = cases.filter((c) => filter === "all" || c.status === filter);

  return (
    <>
      <p className="dash-note">One case per finding you track. Each case keeps a history of who did what and when. Only the masked preview is stored, never the secret. Saved in the database, or in memory when no database is set.</p>
      <div className="dash-stats">
        <Stat label="Cases" value={cases.length} />
        {STATUS_ORDER.map((s) => (
          <Stat key={s} label={STATUS_LABELS[s]} value={counts[s] ?? 0} tone={s === "open" ? "real" : s === "closed" ? "example" : s === "owner_notified" || s === "rotated" ? "possible" : undefined} />
        ))}
      </div>
      <div className="dash-bar">
        <div>
          <span className="lbl" id="status-l">Show</span>
          <Select
            labelledBy="status-l"
            value={filter}
            onChange={(v) => setFilter(v as "all" | CaseStatus)}
            options={[{ value: "all", label: "All cases" }, ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]}
          />
        </div>
        <button type="button" className="btn ghost" onClick={load}>
          Refresh now
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {!error && shown.length === 0 && <p className="empty">No cases yet. Open a finding on the home page, choose What to do next, then Track this finding.</p>}
      {shown.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Status</th>
                <th>What</th>
                <th>Where</th>
                <th>Owner</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={c.id === openId ? "on" : ""}>
                  <td>
                    <button type="button" className="dash-link" aria-expanded={c.id === openId} onClick={() => setOpenId(c.id === openId ? "" : c.id)}>
                      {c.id}
                    </button>
                  </td>
                  <td>
                    <span className={`verdict ${c.status === "closed" ? "example" : c.status === "open" ? "real" : c.status === "false_alarm" ? "off" : "possible"}`}>{STATUS_LABELS[c.status]}</span>
                  </td>
                  <td className="dash-what">
                    {typeLabel({ type: c.type } as never)} <span className="masked">{c.preview}</span>
                  </td>
                  <td className="dash-what">{c.scanLabel}</td>
                  <td>{c.owner || "-"}</td>
                  <td>{when(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && (
        <section className="case-open" aria-label={`Case ${current.id}`}>
          <h2 className="case-h">Case {current.id}</h2>
          <p className="dash-meta mono">
            {current.type}, {current.encoding}, confidence {current.confidence.level} ({Math.round(current.confidence.score * 100)}), judge {current.verdict}, opened {when(current.createdAt)}
          </p>
          <div className="case-grid">
            <div>
              <p className="next-title">Move the case</p>
              <div className="case-status">
                {STATUS_ORDER.map((s) => (
                  <button key={s} type="button" className={`chipbtn${current.status === s ? " on" : ""}`} aria-pressed={current.status === s} onClick={() => update(current.id, { status: s, note })}>
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
              <label className="lbl" htmlFor="case-owner">Owner</label>
              <input id="case-owner" className="case-input" value={owner} maxLength={100} onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== current.owner && update(current.id, { owner })} placeholder="Who owns this secret?" />
              <label className="lbl" htmlFor="case-note">Note for the history (optional)</label>
              <input id="case-note" className="case-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: key rotated in IAM" />
              <p className="next-title">Steps</p>
              <ol className="next-steps">
                {guideFor(current.type).steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="next-title">History</p>
              <ol className="case-history">
                {[...current.history].reverse().map((h, i) => (
                  <li key={i}>
                    <b>{STATUS_LABELS[h.status]}</b> <span className="mono">{when(h.at)}</span>
                    {h.note && <span>{h.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
