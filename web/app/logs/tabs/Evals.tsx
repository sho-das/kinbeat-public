"use client";

import { useEffect, useState } from "react";
import { Select } from "../../components/Select";
import { getJson, when, type EvalRow, type EvalRun } from "../../lib/logs";

export function Evals() {
  const [runs, setRuns] = useState<EvalRow[]>([]);
  const [file, setFile] = useState("");
  const [run, setRun] = useState<EvalRun | null>(null);
  const [error, setError] = useState("");
  const [onlyFail, setOnlyFail] = useState(false);
  const [category, setCategory] = useState("all");

  useEffect(() => {
    getJson<EvalRow[]>("/api/logs/evals")
      .then((r) => {
        setRuns(r);
        if (r.length) setFile(r[0].file);
      })
      .catch(() => setError("Could not reach the API on port 4100."));
  }, []);

  useEffect(() => {
    if (!file) return;
    getJson<EvalRun>(`/api/logs/evals/${file}`).then(setRun).catch(() => setError("Could not read that eval run."));
  }, [file]);

  const current = runs.find((r) => r.file === file);
  const cases = (run?.cases ?? []).filter((c) => (!onlyFail || !c.pass) && (category === "all" || c.category === category));

  return (
    <>
      <p className="dash-note">Local test runs from `npm run eval`, read from the `api/evals/results` folder. Mock runs test the scanner pipeline only, not Muse.</p>
      {error && <p className="err">{error}</p>}
      {runs.length === 0 && !error && <p className="empty">No eval runs yet. Run `npm run eval`.</p>}
      {runs.length > 0 && (
        <>
          <div className="dash-bar">
            <div>
              <span className="lbl" id="run-l">Run</span>
              <Select labelledBy="run-l" value={file} onChange={setFile} options={runs.map((r) => ({ value: r.file, label: `${when(r.timestamp)} - ${r.mode}` }))} />
            </div>
            {current && (
              <p className="mono dash-meta">
                mode {current.mode}, model {current.model}, {current.cases} cases{current.gitHash ? `, commit ${current.gitHash}` : ""}
              </p>
            )}
          </div>
          {current && (
            <div className="dash-cats">
              {current.summary.categories.map((c) => (
                <button
                  type="button"
                  key={c.category}
                  className={`dash-cat ${c.status === "below line" ? "bad" : c.status === "meets line" ? "good" : "none"}${category === c.category ? " on" : ""}`}
                  onClick={() => setCategory(category === c.category ? "all" : c.category)}
                  aria-pressed={category === c.category}
                >
                  <span className="dash-cat-name">{c.category}</span>
                  <span className="dash-cat-num">{c.recall}%</span>
                  <span className="dash-bar-track" aria-hidden="true">
                    <span className="dash-bar-fill" style={{ width: `${c.recall}%` }} />
                    {c.passLine !== null && <span className="dash-bar-line" style={{ left: `${c.passLine}%` }} />}
                  </span>
                  <span className="dash-cat-sub">
                    {c.matched} of {c.expected} found
                    {c.passLine !== null ? `, line ${c.passLine}%` : ", no line"}
                  </span>
                  <span className="dash-cat-sub">
                    {c.status}. False alarms: {c.falseAlarms.falseAlarmCases} of {c.falseAlarms.cleanCases} clean cases
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="dash-bar">
            <label className="dash-live">
              <input type="checkbox" checked={onlyFail} onChange={(e) => setOnlyFail(e.target.checked)} /> Only failed cases
            </label>
            {category !== "all" && (
              <button type="button" className="btn ghost" onClick={() => setCategory("all")}>
                Clear filter: {category}
              </button>
            )}
            <span className="mono dash-meta">{cases.length} cases shown</span>
          </div>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Case</th>
                  <th>Category</th>
                  <th>Found / expected</th>
                  <th>Extra</th>
                  <th>Verdicts</th>
                  <th>Why it failed</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className={c.pass ? "" : "fail"}>
                    <td>
                      <span className={`verdict ${c.pass ? "example" : "real"}`}>{c.pass ? "Pass" : "Fail"}</span>
                    </td>
                    <td className="dash-what">{c.id}</td>
                    <td>{c.category}</td>
                    <td>
                      {c.matched} / {c.expected}
                    </td>
                    <td>{c.extra}</td>
                    <td className="mono">{c.verdicts.join(", ") || "-"}</td>
                    <td>{c.reasons.join("; ") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
