"use client";

import { useEffect, useRef, useState } from "react";
import { content } from "../content";
import { browserStore, inputKey, readSaved, save, cacheable } from "../lib/cache";
import { fileProblem, repoProblem, verdictKind, type ScanResult, type Template } from "../lib/scan";
import { FindingCard } from "./Findings";
import { Select } from "./Select";

const L = content.left;

// Counts findings by what KinBeat said, in a fixed order, skipping empty groups.
function tally(findings: ScanResult["findings"]): Array<[keyof typeof content.right.tallyNames, number]> {
  const groups: Record<string, number> = {};
  for (const f of findings) {
    const kind = verdictKind(f);
    const group = kind === "real" || kind === "possible" || kind === "example" ? kind : "other";
    groups[group] = (groups[group] ?? 0) + 1;
  }
  return (["real", "possible", "example", "other"] as const).filter((k) => groups[k]).map((k) => [k, groups[k]] as [typeof k, number]);
}
const R = content.right;
const NO_API = "The scanner is not reachable right now. Try again in a moment.";

type Mode = "sample" | "paste" | "files" | "repo";

export function Scanner() {
  const [mode, setMode] = useState<Mode>("sample");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [repo, setRepo] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const countRef = useRef<HTMLHeadingElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Template[]) => {
        setTemplates(list);
        if (list.length) setSelected(list[0].id);
      })
      .catch(() => setError(NO_API));
  }, []);

  useEffect(() => {
    if (result) countRef.current?.focus();
  }, [result]);

  // Once the input changes, the button says Scan again no more.
  useEffect(() => {
    setDirty(true);
  }, [mode, selected, text, file, repo]);

  const template = templates.find((t) => t.id === selected);
  const ready = mode === "sample" ? !!template : mode === "paste" ? !!text.trim() : mode === "repo" ? !!repo.trim() && !repoProblem(repo) : !!file;

  function changeMode(next: Mode) {
    setMode(next);
    setError(next === "files" ? fileProblem(file) : next === "repo" ? repoProblem(repo) : "");
  }

  // One file at a time: the latest file replaces the one before, also when several are dropped together.
  function addFile(list: ArrayLike<File> | null) {
    const next = list?.[list.length - 1];
    if (!next) return;
    setFile(next);
    setError(fileProblem(next));
  }

  function removeFile() {
    setFile(null);
    setError("");
  }

  async function run() {
    setError("");
    // The old result goes the moment a new scan starts, so a failed scan never shows the one before it.
    setResult(null);
    if (mode === "repo") {
      const problem = repoProblem(repo);
      if (problem) {
        setError(problem);
        return;
      }
    }
    // The card freezes at the first instant. Reading a large file to find out whether it was scanned before takes a moment.
    setBusy(true);
    try {
      // A repository result is saved on the server and checked against the latest commit, so the browser keeps no copy of it.
      const key = mode === "repo" ? "" : await inputKey(mode === "sample" && template ? { sample: template.id } : mode === "paste" ? { text } : { file });
      const store = mode === "repo" ? null : browserStore();
      const saved = store ? readSaved(store, key, Date.now()) : null;
      if (saved) {
        setSource(mode === "sample" && template ? template.title : mode === "paste" ? "Pasted text" : file?.name ?? "");
        setResult(saved.result);
        setDirty(false);
        return;
      }
      const sweep = new Promise((done) => setTimeout(done, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1150));
      let response: Response;
      let label: string;
      if (mode === "sample" && template) {
        label = template.title;
        response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId: template.id, useModel: true }),
        });
      } else if (mode === "paste") {
        label = "Pasted text";
        response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, useModel: true }),
        });
      } else if (mode === "repo") {
        const link = repo.trim();
        label = link.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
        response = await fetch("/api/scan/repo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: link, useModel: true }),
        });
      } else if (file) {
        const problem = fileProblem(file);
        if (problem) throw new Error(problem);
        const form = new FormData();
        form.append("file", file);
        form.append("useModel", "true");
        label = file.name;
        response = await fetch("/api/scan/file", { method: "POST", body: form });
      } else {
        throw new Error("Choose a file first.");
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ? String(data.message) : `Scan failed (${response.status}).`);
      await sweep;
      setSource(label);
      setResult(data as ScanResult);
      setDirty(false);
      if (store && cacheable(data as ScanResult)) save(store, key, data as ScanResult, Date.now());
    } catch (e) {
      setError(e instanceof TypeError ? NO_API : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const count = result?.findings.length ?? 0;

  return (
    <div className="consolewrap">
      <div className="foldtabs" role="tablist" aria-label={L.title}>
        {L.modes.map((m) => (
          <button key={m.id} type="button" role="tab" id={`tab-${m.id}`} aria-selected={mode === m.id} aria-controls="srcpanel" disabled={busy} onClick={() => changeMode(m.id as Mode)}>
            {m.label}
          </button>
        ))}
      </div>
    <section className="console" aria-label="Scan and results">
      <div className="pane">
        <h3 className="ph">{L.title}</h3>
        <div className="srcpanel" id="srcpanel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
          {mode === "sample" && (
            <>
              <div className="field">
                <span className="lbl" id="sample-l">
                  {L.selectLabel}
                </span>
                <Select labelledBy="sample-l" value={selected} disabled={busy} onChange={setSelected} options={templates.map((t) => ({ value: t.id, label: t.title }))} />
              </div>
              <div className="field">
                <span className="lbl" id="sampletext-l">
                  {L.sampleText}
                </span>
                <div className={`samplebox${busy ? " scanning" : ""}`}>
                  <pre className="sample ro" aria-labelledby="sampletext-l" tabIndex={0}>
                    {template?.text ?? ""}
                  </pre>
                </div>
              </div>
            </>
          )}

          {mode === "paste" && (
            <div className="field">
              <label className="lbl" htmlFor="pastetext">
                {L.pasteLabel}
              </label>
              <div className={`samplebox${busy ? " scanning" : ""}`}>
                <textarea id="pastetext" className="sample" value={text} placeholder={L.pastePlaceholder} spellCheck={false} readOnly={busy} onChange={(e) => setText(e.target.value)} />
              </div>
            </div>
          )}

          {mode === "repo" && (
            <div className="field">
              <label className="lbl" htmlFor="repolink">
                {L.repoLabel}
              </label>
              <input
                id="repolink"
                className="repoinput"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={repo}
                placeholder={L.repoPlaceholder}
                readOnly={busy}
                aria-describedby="repohint"
                onChange={(e) => {
                  setRepo(e.target.value);
                  setError(repoProblem(e.target.value));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && !busy) run();
                }}
              />
              <p className="dz-hint repohint" id="repohint">
                {L.repoHint}
              </p>
            </div>
          )}

          {mode === "files" && (
            <div className="field">
              <div
                className={`dropzone${over ? " over" : ""}${busy ? " frozen" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy) setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  if (!busy) addFile(e.dataTransfer.files);
                }}
              >
                <input ref={picker} className="file-input" type="file" disabled={busy} aria-label={L.choose} onChange={(e) => addFile(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
                <p className="dz-title">{L.drop}</p>
                <p className="dz-or">{L.dropOr}</p>
                <div className="dz-buttons">
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => picker.current?.click()}>
                    {L.choose}
                  </button>
                </div>
                <p className="dz-hint">{L.filesHint}</p>
              </div>
              {file && (
                <ul className="picked">
                  <li>
                    <span className="pn">{file.name}</span>
                    <span>{Math.max(1, Math.round(file.size / 1024))} KB</span>
                    <button type="button" className="rm" disabled={busy} aria-label={`${L.remove} ${file.name}`} onClick={removeFile}>
                      {L.remove}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="ctrl bigscan">
          <button className="btn" type="button" disabled={busy || !ready} onClick={() => run()}>
            {busy ? L.scanning : result && !dirty ? L.scanAgain : L.scan}
          </button>
        </div>
      </div>

      <div className="pane">
        <h3 className="ph">{R.title}</h3>
        <div aria-live="polite" aria-atomic="false">
          {error && <p className="err">{error}</p>}
          {busy && (
            <p className="note working" role="status">
              {R.working}
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </p>
          )}
          {!result && !error && !busy && (
            <div className="empty preview">
              <p className="preview-title">{R.empty}</p>
              <div className="findghost" aria-hidden="true">
                <b>{R.exampleType}</b>
                <span className="masked">AK****************01</span>
                <em>{R.exampleVerdict}</em>
              </div>
              <p className="preview-hint">{R.emptyHint}</p>
            </div>
          )}
          {busy && (
            <div className="skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          {result && !busy && (
            <>
              <h4 className="count" tabIndex={-1} ref={countRef}>
                {count === 0 ? (result.summary.unread ? R.noneUnread : R.none) : count === 1 ? R.one : `${count} ${R.many}`}
              </h4>
              <p className="source">
                {R.inLabel}
                {source}
              </p>
              {count > 0 && (
                <ul className="tally" aria-label={R.tallyLabel}>
                  {tally(result.findings).map(([kind, n]) => (
                    <li key={kind} className={`tally-${kind}`}>
                      <b>{n}</b> {R.tallyNames[kind]}
                    </li>
                  ))}
                </ul>
              )}
              {result.repo && (
                <ul className="notes">
                  <li>
                    {R.repoCommit} {result.repo.sha.slice(0, 7)}, {R.repoScanned} {new Date(result.repo.scannedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. {result.repo.files} files read. {result.repo.cached ? R.repoSaved : ""}
                  </li>
                  <li>{result.repo.note}</li>
                  {Object.keys(result.repo.skipped).length > 0 && (
                    <li>
                      {R.repoSkipped} {Object.entries(result.repo.skipped).map(([reason, n]) => `${n} ${reason}`).join(", ")}.
                    </li>
                  )}
                </ul>
              )}
              {result.files && result.files.length > 0 && (
                <ul className="notes">
                  {result.files.map((f) => (
                    <li key={f.file}>
                      {f.file}: {f.type}
                      {f.pages ? `, ${f.pages} pages` : ""}
                      {f.imagePages ? `, ${f.imagePages} read as pictures` : ""}
                      {f.note ? `. ${f.note}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {!!result.summary.unread && result.summary.unread > 0 && (
                <p className="note" role="status">
                  {result.summary.unread} {result.summary.unread === 1 ? "picture or page" : "pictures or pages"} {R.unread}
                </p>
              )}
              {result.summary.blocked > 0 && (
                <p className="note" role="status">
                  {result.summary.blocked} {result.summary.blocked === 1 ? "finding was" : "findings were"} not judged: hidden for safety, because the value also appears in normal text.
                </p>
              )}
              <div className="findings">
                {result.findings.map((f, i) => (
                  <FindingCard key={f.id} finding={f} index={i} scanId={result.scanId} scanLabel={source} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
    </div>
  );
}
