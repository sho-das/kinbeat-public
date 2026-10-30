"use client";

import { useEffect, useMemo, useState } from "react";
import { Select } from "../../components/Select";
import { getJson, when, type CheckResult, type CheckRow, type CheckRun } from "../../lib/logs";
import { Stat } from "../shared";

export function Checks() {
  const [runs, setRuns] = useState<CheckRow[]>([]);
  const [file, setFile] = useState("");
  const [against, setAgainst] = useState("none");
  const [run, setRun] = useState<CheckRun | null>(null);
  const [other, setOther] = useState<CheckRun | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState("all");
  const [only, setOnly] = useState<"all" | "fail" | "changed">("all");

  useEffect(() => {
    getJson<CheckRow[]>("/api/logs/checks")
      .then((r) => {
        setRuns(r);
        if (r.length) setFile(r[0].file);
        if (r.length > 1) setAgainst(r[1].file);
      })
      .catch(() => setError("Could not reach the API on port 4100."));
  }, []);

  useEffect(() => {
    if (file) getJson<CheckRun>(`/api/logs/checks/${file}`).then(setRun).catch(() => setError("Could not read that run."));
  }, [file]);

  useEffect(() => {
    if (against === "none") return setOther(null);
    getJson<CheckRun>(`/api/logs/checks/${against}`).then(setOther).catch(() => setOther(null));
  }, [against]);

  const before = useMemo(() => new Map((other?.checks ?? []).map((c) => [c.id, c])), [other]);
  const rows = (run?.checks ?? []).filter((c) => {
    const prev = before.get(c.id);
    const changed = !!other && (!prev || prev.pass !== c.pass);
    return (group === "all" || c.group === group) && (only === "all" || (only === "fail" && !c.pass) || (only === "changed" && changed));
  });
  const opts = runs.map((r) => ({ value: r.file, label: `${when(r.timestamp)} - ${r.summary.passed}/${r.summary.total} passed` }));
  const expText = (c: CheckResult) =>
    [`status ${c.expected.status.join(" or ")}`, c.expected.findings !== undefined ? `${c.expected.findings} findings` : "", c.expected.atLeast !== undefined ? `at least ${c.expected.atLeast} findings` : "", c.expected.types?.length ? c.expected.types.join(", ") : ""].filter(Boolean).join(", ");
  const actText = (c: CheckResult) =>
    [`status ${c.actual.status}`, c.actual.findings !== undefined ? `${c.actual.findings} findings` : "", c.actual.types.length ? c.actual.types.join(", ") : "", c.actual.message ?? ""].filter(Boolean).join(", ");

  return (
    <>
      <p className="dash-note">
        Automatic tests that send correct and wrong input to the API and compare what came back with what we expected. Run them with `npm run checks` in the `api` folder. Results are saved as files, so you can compare one run with an earlier one.
      </p>
      {error && <p className="err">{error}</p>}
      {runs.length === 0 && !error && <p className="empty">No check runs yet. Run `npm run checks` in the `api` folder.</p>}
      {run && (
        <>
          <div className="dash-stats">
            <Stat label="Checks" value={run.summary.total} />
            <Stat label="Passed" value={run.summary.passed} tone="example" />
            <Stat label="Failed" value={run.summary.failed} tone={run.summary.failed ? "real" : undefined} />
            <Stat label="Correct input" value={`${run.summary.correct.passed}/${run.summary.correct.total}`} />
            <Stat label="Wrong input" value={`${run.summary.incorrect.passed}/${run.summary.incorrect.total}`} />
          </div>
          <div className="dash-bar">
            <div>
              <span className="lbl" id="chk-run-l">Run</span>
              <Select labelledBy="chk-run-l" value={file} onChange={setFile} options={opts} />
            </div>
            <div>
              <span className="lbl" id="chk-cmp-l">Compare with</span>
              <Select labelledBy="chk-cmp-l" value={against} onChange={setAgainst} options={[{ value: "none", label: "No comparison" }, ...opts.filter((o) => o.value !== file)]} />
            </div>
            <div>
              <span className="lbl" id="chk-grp-l">Input</span>
              <Select labelledBy="chk-grp-l" value={group} onChange={setGroup} options={[{ value: "all", label: "All" }, { value: "correct", label: "Correct input" }, { value: "incorrect", label: "Wrong input" }]} />
            </div>
            <div>
              <span className="lbl" id="chk-only-l">Show</span>
              <Select
                labelledBy="chk-only-l"
                value={only}
                onChange={(v) => setOnly(v as "all" | "fail" | "changed")}
                options={[{ value: "all", label: "All checks" }, { value: "fail", label: "Only failed" }, ...(other ? [{ value: "changed", label: "Only changed since the other run" }] : [])]}
              />
            </div>
          </div>
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Check</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  {other && <th>Other run</th>}
                  <th>Problem</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const prev = before.get(c.id);
                  const changed = !!other && prev && prev.pass !== c.pass;
                  return (
                    <tr key={c.id} className={c.pass ? (changed ? "changed" : "") : "fail"}>
                      <td>
                        <span className={`verdict ${c.pass ? "example" : "real"}`}>{c.pass ? "Pass" : "Fail"}</span>
                      </td>
                      <td className="dash-what">
                        {c.name}
                        <br />
                        <span className="dash-meta">{c.group === "correct" ? "Correct input" : "Wrong input"}</span>
                      </td>
                      <td>{expText(c)}</td>
                      <td>{actText(c)}</td>
                      {other && <td>{prev ? (prev.pass ? "Passed" : "Failed") : "New check"}{changed ? " - changed" : ""}</td>}
                      <td>{c.problems.join("; ") || "-"}</td>
                      <td>{c.durationMs} ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && <p className="empty">Nothing matches this view.</p>}
        </>
      )}
    </>
  );
}
