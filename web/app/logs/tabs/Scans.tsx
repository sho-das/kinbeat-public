"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FindingCard } from "../../components/Findings";
import { Select } from "../../components/Select";
import { getJson, when, type ScanDetail, type ScanRow } from "../../lib/logs";
import { Stat } from "../shared";

export function Scans() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [error, setError] = useState("");
  const [live, setLive] = useState(true);
  const [open, setOpen] = useState<ScanDetail | null>(null);
  const [kind, setKind] = useState("all");

  const load = useCallback(() => {
    getJson<ScanRow[]>("/api/logs/scans")
      .then((r) => {
        setRows(r);
        setError("");
      })
      .catch(() => setError("Could not reach the API on port 4100."));
  }, []);

  useEffect(() => {
    load();
    if (!live) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load, live]);

  async function show(id: string) {
    if (open?.id === id) return setOpen(null);
    setOpen(await getJson<ScanDetail>(`/api/logs/scans/${id}`));
  }

  const shown = useMemo(() => rows.filter((r) => kind === "all" || r.kind === kind), [rows, kind]);
  const totals = useMemo(() => {
    const t = { findings: 0, real: 0, unsure: 0, example: 0, ms: 0 };
    for (const r of shown) {
      t.findings += r.summary.findings;
      t.real += r.verdicts.real;
      t.unsure += r.verdicts.unsure;
      t.example += r.verdicts.example;
      t.ms += r.durationMs;
    }
    return t;
  }, [shown]);

  return (
    <>
      <p className="dash-note">Newest first. Saved for 30 days when a database is set, otherwise the last 200 are kept in memory. Only masked data is stored, never the secret.</p>
      <div className="dash-stats">
        <Stat label="Scans" value={shown.length} />
        <Stat label="Findings" value={totals.findings} />
        <Stat label="Judged real" value={totals.real} tone="real" />
        <Stat label="Judged possible" value={totals.unsure} tone="possible" />
        <Stat label="Judged example" value={totals.example} tone="example" />
        <Stat label="Average time" value={shown.length ? `${(totals.ms / shown.length / 1000).toFixed(1)} s` : "-"} />
      </div>
      <div className="dash-bar">
        <div>
          <span className="lbl" id="kind-l">Source</span>
          <Select
            labelledBy="kind-l"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: "All" },
              { value: "text", label: "Pasted text" },
              { value: "template", label: "Sample" },
              { value: "files", label: "Files" },
            ]}
          />
        </div>
        <label className="dash-live">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Refresh every 5 s
        </label>
        <button type="button" className="btn ghost" onClick={load}>
          Refresh now
        </button>
      </div>
      {error && <p className="err">{error}</p>}
      {!error && shown.length === 0 && <p className="empty">No scans yet. Run one on the home page.</p>}
      {shown.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>What</th>
                <th>Findings</th>
                <th>Real / possible / example</th>
                <th>Judge</th>
                <th>Took</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <FragmentRow key={r.id} row={r} open={open} onToggle={() => show(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function FragmentRow({ row, open, onToggle }: { row: ScanRow; open: ScanDetail | null; onToggle: () => void }) {
  const expanded = open?.id === row.id;
  return (
    <>
      <tr className={expanded ? "on" : ""}>
        <td>
          <button type="button" className="dash-link" aria-expanded={expanded} onClick={onToggle}>
            {when(row.at)}
          </button>
        </td>
        <td>{row.kind === "files" ? `${row.files} file${row.files === 1 ? "" : "s"}` : row.kind === "template" ? "Sample" : "Pasted text"}</td>
        <td className="dash-what">{row.label}</td>
        <td>{row.summary.findings}</td>
        <td className="mono">
          {row.verdicts.real} / {row.verdicts.unsure} / {row.verdicts.example}
        </td>
        <td className="mono">
          {row.mode}, {row.model}
        </td>
        <td>{(row.durationMs / 1000).toFixed(1)} s</td>
      </tr>
      {expanded && open && (
        <tr className="dash-open">
          <td colSpan={7}>
            <p className="dash-meta mono">
              id {open.id}
              {open.chars !== undefined ? ` - ${open.chars} characters` : ""}
              {` - blocked ${open.summary.blocked}, errors ${open.summary.errors}`}
            </p>
            {open.result.files && open.result.files.length > 0 && (
              <ul className="notes">
                {open.result.files.map((f) => (
                  <li key={f.file}>
                    {f.file}: {f.type}
                    {f.pages ? `, ${f.pages} pages` : ""}
                    {f.imagePages ? `, ${f.imagePages} read as pictures` : ""}
                    {f.note ? `. ${f.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <div className="findings">
              {open.result.findings.length === 0 && <p className="empty">No findings in this scan.</p>}
              {open.result.findings.map((f, i) => (
                <FindingCard key={f.id} finding={f} index={i} />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
