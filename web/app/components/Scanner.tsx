"use client";

import { useEffect, useRef, useState } from "react";
import { content } from "../content";
import { browserStore, inputKey, readSaved, save, cacheable } from "../lib/cache";
import { driveFile, driveReady, pickDriveFile, revokeDrive } from "../lib/drive";
import type { DriveDoc } from "../lib/drive-files";
import { fileProblem, hiddenFromPage, notChecked, placeLabel, repoProblem, verdictKind, type ScanResult, type Template } from "../lib/scan";
import { ConfirmDialog } from "./ConfirmDialog";
import { FindingCard } from "./Findings";
import { Select } from "./Select";

const L = content.left;

type Group = "real" | "possible" | "example" | "other";
function groupOf(f: ScanResult["findings"][number]): Group {
  const kind = verdictKind(f);
  return kind === "real" || kind === "possible" || kind === "example" ? kind : "other";
}

// Counts findings by what KinBeat said, in a fixed order, skipping empty groups.
function tally(findings: ScanResult["findings"]): Array<[keyof typeof content.right.tallyNames, number]> {
  const groups: Record<string, number> = {};
  for (const f of findings) {
    const group = groupOf(f);
    groups[group] = (groups[group] ?? 0) + 1;
  }
  return (["real", "possible", "example", "other"] as const).filter((k) => groups[k]).map((k) => [k, groups[k]] as [typeof k, number]);
}
const R = content.right;

// A link that opens a popup with a plain list, such as the files read or the findings the AI did not check.
function ListDialog({ link, title, items }: { link: string; title: string; items: string[] }) {
  const box = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="linkbtn" onClick={() => box.current?.showModal()}>
        {link}
      </button>
      <dialog ref={box} className="filebox" aria-label={title} onClick={(e) => e.target === box.current && box.current?.close()}>
        <div className="filebox__head">
          <b>{title}</b>
          <button type="button" className="linkbtn" onClick={() => box.current?.close()}>
            {R.close}
          </button>
        </div>
        <ol className="filebox__list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      </dialog>
    </>
  );
}
// Puts numbers into a text such as "Messages {from} to {to}", written with thousands separators.
const fill = (text: string, values: Record<string, number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k].toLocaleString("en-US"));
// A pause, for the PR history scan's polling and retries.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// A GitHub link shown as owner/repository.
const repoLabel = (link: string) => link.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");

const NO_API = "The scanner is not reachable right now. Try again in a moment.";

type Mode = "sample" | "paste" | "files" | "drive" | "slack" | "site" | "repo" | "history";
type SlackChat = { id: string; name: string; kind: keyof typeof L.slackGroups };

export function Scanner() {
  const [mode, setMode] = useState<Mode>("sample");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // The Google Drive file picked for one scan, and Google's short-lived token to download it. Both are cleared when the scan ends or the tab changes.
  const [driveDoc, setDriveDoc] = useState<DriveDoc | null>(null);
  const driveToken = useRef("");
  // The Slack chats the visitor can read, once Slack is connected. The token itself stays on the server, never on this page.
  const [slack, setSlack] = useState<{ team: string; chats: SlackChat[] } | null>(null);
  const [slackChat, setSlackChat] = useState("");
  // The first message number of the last Slack scan: 1, then 10,001, and so on.
  const [slackFrom, setSlackFrom] = useState(1);
  const [repo, setRepo] = useState("");
  // A public web address for the Website tab.
  const [site, setSite] = useState("");
  // A private repository's token lives only in this state, for one scan. It is cleared when the scan ends or the tab changes.
  const [token, setToken] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenSteps, setTokenSteps] = useState(false);
  // The PR history scan's progress: how many pull requests are read so far, out of how many.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Every other scan's step, such as reading files 3 of 10, asked from the server while the scan runs.
  const [step, setStep] = useState<{ step: keyof typeof R.steps; done?: number; total?: number } | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The visitor pressed Cancel: the results side says so until the next scan or tab.
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const countRef = useRef<HTMLHeadingElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stop = useRef<AbortController | null>(null);
  // The id of a PR history or Slack scan running on the server, so Cancel can stop it there too.
  const serverJob = useRef<string | null>(null);
  // A tab clicked while a scan runs. The popup asks first. The switch happens only after the scan has fully stopped.
  const [askMode, setAskMode] = useState<Mode | null>(null);
  const switchTo = useRef<Mode | null>(null);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Template[]) => {
        // Only the chosen samples, in the page's order, some with a shorter title.
        const chosen = L.samples.flatMap((s) => list.filter((t) => t.id === s.id).map((t) => ({ ...t, title: "title" in s && s.title ? s.title : t.title })));
        setTemplates(chosen);
        if (chosen.length) setSelected(chosen[0].id);
      })
      .catch(() => setError(NO_API));
  }, []);

  // Slack sends the visitor back to the page with ?slack=connected, denied or failed. The tab opens, and the address is cleaned.
  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("slack");
    if (!back) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    setMode("slack");
    if (back === "denied") setError(L.slackDenied);
    else if (back !== "connected") setError(L.slackFailed);
  }, []);

  // The chat list loads when the Slack tab opens. No connection yet means the Connect button shows.
  useEffect(() => {
    if (mode !== "slack" || slack) return;
    fetch("/api/slack/chats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setSlack(data);
        if (data.chats.length) setSlackChat(data.chats[0].id);
      })
      .catch(() => {});
  }, [mode, slack]);

  async function disconnectSlack() {
    await fetch("/api/slack/session", { method: "DELETE" }).catch(() => {});
    setSlack(null);
    setSlackChat("");
  }

  useEffect(() => {
    if (result) countRef.current?.focus();
  }, [result]);

  // Once the input changes, the button says Scan again no more.
  useEffect(() => {
    setDirty(true);
  }, [mode, selected, text, file, repo, site, driveDoc, slackChat]);

  const template = templates.find((t) => t.id === selected);
  const ready = mode === "sample" ? !!template : mode === "paste" ? !!text.trim() : mode === "repo" ? !!repo.trim() : mode === "site" ? !!site.trim() : mode === "history" ? !!repo.trim() && !!token.trim() : mode === "drive" ? !!driveDoc : mode === "slack" ? !!slackChat : !!file;

  function changeMode(next: Mode) {
    setMode(next);
    setCancelled(false);
    setToken("");
    clearDrive();
    // A new tab starts empty, so it never shows the result of a scan made in another tab.
    setResult(null);
    setGroup(null);
    setSource("");
    setError(next === "files" ? fileProblem(file) : "");
  }

  function clearDrive() {
    revokeDrive(driveToken.current);
    driveToken.current = "";
    setDriveDoc(null);
  }

  async function chooseDrive() {
    setError("");
    try {
      const { token: access, doc } = await pickDriveFile();
      if (!doc) return;
      driveToken.current = access;
      setDriveDoc(doc);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // One file at a time. The box is locked until Remove; when several are dropped together, the last one is kept.
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

  // Cancel stops the scan on the server too, then stops the page from waiting for it.
  function cancelScan() {
    if (serverJob.current) fetch(`/api/scan/repo/history/${serverJob.current}`, { method: "DELETE", cache: "no-store" }).catch(() => {});
    stop.current?.abort();
    setCancelled(true);
  }

  // Runs after each scan ends. A chosen tab is switched to only now, when the scan's own clean-up is done.
  // If the scan ended by itself while the popup was open, the popup closes and the old choice is dropped.
  useEffect(() => {
    if (busy) return;
    if (switchTo.current) {
      const next = switchTo.current;
      switchTo.current = null;
      changeMode(next);
    }
    setAskMode(null);
  }, [busy]);

  // The PR history scan starts a background job on the server, then asks for its progress until it is done.
  // The token is sent once, and cleared from the page as soon as the job has started.
  async function runHistory() {
    const problem = repoProblem(repo);
    if (problem) {
      setError(problem);
      return;
    }
    const link = repo.trim();
    await runJob("/api/scan/repo/history", { url: link, token: token.trim(), useModel: true }, repoLabel(link));
  }

  // A Slack scan runs the same way: a background job on the server. With a cursor it carries on after the last scan.
  async function runSlack(cursor?: string) {
    const chat = slack?.chats.find((c) => c.id === slackChat);
    if (!chat) return;
    // Scan next starts right after the last message the previous scan read.
    const from = cursor && result?.slack ? slackFrom + result.slack.read : 1;
    setSlackFrom(from);
    await runJob("/api/slack/scan", { chat: chat.id, cursor, useModel: true }, chat.name, (r) => {
      const read = (r as ScanResult).slack?.read ?? 0;
      return `${chat.name}, ${fill(L.slackMessages, { from, to: from + Math.max(read, 1) - 1 })}`;
    });
  }

  async function runJob(url: string, body: Record<string, unknown>, label: string, labelOf?: (result: unknown) => string) {
    setError("");
    setCancelled(false);
    setResult(null);
    setGroup(null);
    setBusy(true);
    setProgress(null);
    const controller = new AbortController();
    stop.current = controller;
    const { signal } = controller;
    try {
      const started = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      setToken("");
      const startData = await started.json().catch(() => {
        throw new Error(L.badAnswer);
      });
      // An ended Slack connection shows the Connect button again.
      if (started.status === 401 && url.startsWith("/api/slack/")) setSlack(null);
      if (!started.ok) throw new Error(startData.message ? String(startData.message) : `Scan failed (${started.status}).`);
      serverJob.current = String(startData.id);
      for (;;) {
        await sleep(3000);
        signal.throwIfAborted();
        // One failed check, such as a dropped connection, is retried. The scan keeps running on the server either way.
        let response: Response | null = null;
        let job: { message?: string; done: number; total: number; state: string; error?: string; result?: unknown } | null = null;
        for (let attempt = 1; attempt <= 3 && !job; attempt++) {
          try {
            const res = await fetch(`/api/scan/repo/history/${startData.id}`, { cache: "no-store", signal });
            if (res.status >= 500 && attempt < 3) {
              await sleep(2000);
              continue;
            }
            response = res;
            job = await res.json().catch(() => {
              throw new Error(L.badAnswer);
            });
          } catch (error) {
            if ((error as Error).name === "AbortError" || attempt === 3) throw error;
            await sleep(2000);
          }
        }
        if (!response || !job) throw new Error(L.badAnswer);
        if (!response.ok) throw new Error(job.message ? String(job.message) : `Scan failed (${response.status}).`);
        setProgress({ done: job.done, total: job.total });
        if (job.state === "failed") throw new Error(job.error ? String(job.error) : L.badAnswer);
        if (job.state === "done") {
          setSource(labelOf ? labelOf(job.result) : label);
          setResult(job.result as ScanResult);
          setDirty(false);
          break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof TypeError ? NO_API : (e as Error).message);
    } finally {
      stop.current = null;
      serverJob.current = null;
      setToken("");
      setProgress(null);
      setBusy(false);
    }
  }

  async function run() {
    if (mode === "history") {
      await runHistory();
      return;
    }
    if (mode === "slack") {
      // Scan again on the same chat carries on after the last scan, when Slack said there are more messages.
      await runSlack(result?.slack?.next && !dirty ? result.slack.next : undefined);
      return;
    }
    setError("");
    setCancelled(false);
    // The old result goes the moment a new scan starts, so a failed scan never shows the one before it.
    setResult(null);
    setGroup(null);
    if (mode === "repo") {
      const problem = repoProblem(repo);
      if (problem) {
        setError(problem);
        return;
      }
    }
    // The card freezes at the first instant. Reading a large file to find out whether it was scanned before takes a moment.
    setBusy(true);
    const controller = new AbortController();
    stop.current = controller;
    const { signal } = controller;
    // The page picks the id and sends it with the scan, then asks for the step until the scan ends. A failed ask is ignored.
    const progressId = crypto.randomUUID();
    const progressHeader = { "x-progress-id": progressId };
    const asking = setInterval(() => {
      fetch(`/api/scan/progress/${progressId}`, { cache: "no-store", signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((state) => {
          if (state && state.step in R.steps && !signal.aborted) setStep(state);
        })
        .catch(() => {});
    }, 1500);
    try {
      // A repository result is saved on the server and checked against the latest commit, so the browser keeps no copy of it.
      // Only pasted text and uploaded files are kept in this browser. Samples always scan fresh, so visitors see the real calls.
      const kept = mode === "paste" || mode === "files";
      const key = kept ? await inputKey(mode === "paste" ? { text } : { file }) : "";
      const store = kept ? browserStore() : null;
      const saved = store ? readSaved(store, key, Date.now()) : null;
      if (saved) {
        setSource(mode === "paste" ? "Pasted text" : file?.name ?? "");
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
          headers: { "content-type": "application/json", ...progressHeader },
          body: JSON.stringify({ templateId: template.id, useModel: true }),
          signal,
        });
      } else if (mode === "paste") {
        label = "Pasted text";
        response = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json", ...progressHeader },
          body: JSON.stringify({ text, useModel: true }),
          signal,
        });
      } else if (mode === "site") {
        const address = site.trim();
        label = address.replace(/^https?:\/\//i, "").replace(/\/$/, "");
        response = await fetch("/api/scan/site", {
          method: "POST",
          headers: { "content-type": "application/json", ...progressHeader },
          body: JSON.stringify({ url: address, useModel: true }),
          signal,
        });
      } else if (mode === "repo") {
        const link = repo.trim();
        label = repoLabel(link);
        response = await fetch("/api/scan/repo", {
          method: "POST",
          headers: { "content-type": "application/json", ...progressHeader },
          body: JSON.stringify({ url: link, useModel: true, ...(token.trim() ? { token: token.trim() } : {}) }),
          signal,
        });
      } else if (mode === "drive" && driveDoc) {
        const picked = await driveFile(driveToken.current, driveDoc, signal);
        const form = new FormData();
        form.append("file", picked);
        form.append("useModel", "true");
        label = picked.name;
        response = await fetch("/api/scan/file", { method: "POST", headers: progressHeader, body: form, signal });
      } else if (file) {
        const problem = fileProblem(file);
        if (problem) throw new Error(problem);
        const form = new FormData();
        form.append("file", file);
        form.append("useModel", "true");
        label = file.name;
        response = await fetch("/api/scan/file", { method: "POST", headers: progressHeader, body: form, signal });
      } else {
        throw new Error("Choose a file first.");
      }
      // A proxy or gateway can answer with a page that is not JSON. The visitor gets one plain sentence, not a parser message.
      const data = await response.json().catch(() => {
        throw new Error(L.badAnswer);
      });
      if (!response.ok) throw new Error(data.message ? String(data.message) : `Scan failed (${response.status}).`);
      await sweep;
      setSource(label);
      setResult(data as ScanResult);
      setDirty(false);
      if (store && cacheable(data as ScanResult)) save(store, key, data as ScanResult, Date.now());
    } catch (e) {
      // Cancel is the visitor's choice, so it shows no error.
      if ((e as Error).name !== "AbortError") setError(e instanceof TypeError ? NO_API : (e as Error).message);
    } finally {
      clearInterval(asking);
      setStep(null);
      stop.current = null;
      setToken("");
      if (mode === "drive") clearDrive();
      setBusy(false);
    }
  }

  const visible = result ? result.findings.filter((f) => !hiddenFromPage(f) && !notChecked(f)) : [];
  const unchecked = result ? result.findings.filter(notChecked) : [];
  // A picture, or a page read as a picture, that could not be read after 2 tries is listed by name under Not scanned.
  // A file that was not read at all leaves the list of files read.
  const unreadFiles = result?.files?.filter((f) => f.notRead || (f.notReadPages?.length ?? 0) > 0) ?? [];
  // A website's left-out scripts can be many, so they are counted here and listed behind See here.
  const unreadScripts = unreadFiles.filter((f) => f.type === "script");
  const unreadNames = unreadFiles.filter((f) => f.type !== "script").map((f) => (f.notReadPages?.length ? `${f.file} (page ${f.notReadPages.join(", ")})` : f.file));
  const readFiles = result?.files?.filter((f) => !f.notRead) ?? [];
  const count = visible.length;
  const groups = tally(visible);
  const shown = groups.find(([kind]) => kind === group)?.[0] ?? groups[0]?.[0];

  return (
    <div className="consolewrap">
      <div className="foldtabs" role="tablist" aria-label={L.title}>
        {L.modes.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            id={`tab-${m.id}`}
            aria-selected={mode === m.id}
            aria-controls="srcpanel"
            onClick={() => {
              if (m.id === mode) return;
              if (busy) setAskMode(m.id as Mode);
              else changeMode(m.id as Mode);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <ConfirmDialog
        open={askMode !== null}
        message={L.switchBody}
        confirmLabel={L.stopAndSwitch}
        cancelLabel={L.keepScanning}
        onConfirm={() => {
          switchTo.current = askMode;
          setAskMode(null);
          cancelScan();
        }}
        onCancel={() => setAskMode(null)}
      />
    <section className="console chat" aria-label="Scan and results">
      {/* A chat app's title bar: the scan window reads as a conversation with KinBeat. */}
      <div className="chat__bar" aria-hidden="true">
        <span className="chat__avatar" />
        <b>{content.name}</b>
        <span className={`chat__status${busy ? " busy" : ""}`} />
      </div>
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
                <textarea id="pastetext" className="sample" value={text} placeholder={L.pastePlaceholder} spellCheck={false} maxLength={L.pasteLimit} readOnly={busy} onChange={(e) => setText(e.target.value)} />
              </div>
              {text.length >= L.pasteLimit && <p className="err">{L.pasteTooLong}</p>}
            </div>
          )}

          {mode === "site" && (
            <div className="field">
              <label className="lbl" htmlFor="sitelink">
                {L.siteLabel}
              </label>
              <input
                id="sitelink"
                className="repoinput"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={site}
                placeholder={L.sitePlaceholder}
                readOnly={busy}
                aria-describedby="sitehint"
                onChange={(e) => {
                  setSite(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && !busy) run();
                }}
              />
              <p className="dz-hint repohint" id="sitehint">
                {L.siteHint}
              </p>
            </div>
          )}

          {(mode === "repo" || mode === "history") && (
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
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready && !busy) run();
                }}
              />
              {mode === "repo" && (
                <p className="dz-hint repohint" id="repohint">
                  {L.repoHint}
                </p>
              )}
              {mode === "repo" && !tokenOpen && !token && (
                <button type="button" className="linkbtn" aria-expanded={false} aria-controls="repotoken-box" disabled={busy} onClick={() => setTokenOpen(true)}>
                  {L.tokenToggle}
                </button>
              )}
              {(mode === "history" || tokenOpen || token) && (
                <div id="repotoken-box" className="tokenbox">
                  <label className="lbl" htmlFor="repotoken">
                    {L.tokenLabel}
                  </label>
                  <input
                    id="repotoken"
                    className="repoinput"
                    type="password"
                    autoComplete="new-password"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={token}
                    readOnly={busy}
                    aria-describedby="repotoken-hint"
                    onChange={(e) => {
                      setToken(e.target.value);
                      setError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && ready && !busy) run();
                    }}
                  />
                  <p className="dz-hint repohint" id="repotoken-hint">
                    {L.tokenHintStart}{" "}
                    <a href={L.tokenHelpUrl} target="_blank" rel="noopener noreferrer">
                      {L.tokenLink}
                    </a>{" "}
                    {L.tokenHintEnd}{" "}
                    <button type="button" className="linkbtn" aria-expanded={tokenSteps} aria-controls="token-steps" onClick={() => setTokenSteps(!tokenSteps)}>
                      {tokenSteps ? L.tokenLess : L.tokenMore}
                    </button>
                  </p>
                  {tokenSteps && (
                    <div id="token-steps" className="tokensteps">
                      <p className="tokensteps__title">{L.tokenStepsTitle}</p>
                      <ol>
                        {(mode === "history" ? L.prTokenSteps : L.tokenSteps).map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "drive" && (
            <div className="field">
              <div className={`dropzone${busy ? " frozen" : driveDoc ? " locked" : ""}`}>
                {driveReady ? (
                  <div className="dz-buttons">
                    <button className="btn outline" type="button" disabled={busy || !!driveDoc} onClick={chooseDrive}>
                      {L.driveChoose}
                    </button>
                  </div>
                ) : (
                  <p className="dz-title">{L.driveOff}</p>
                )}
                <p className="dz-hint wide">{L.driveHint}</p>
              </div>
              {driveDoc && (
                <ul className="picked">
                  <li>
                    <span className="pn">{driveDoc.name}</span>
                    <button type="button" className="rm" disabled={busy} aria-label={`${L.remove} ${driveDoc.name}`} onClick={clearDrive}>
                      {L.remove}
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}

          {mode === "slack" && (
            <div className="field">
              {slack ? (
                <>
                  <span className="lbl" id="slack-l">
                    {L.slackPick}
                  </span>
                  <Select labelledBy="slack-l" value={slackChat} disabled={busy} onChange={setSlackChat} options={slack.chats.map((c) => ({ value: c.id, label: `${c.name} (${L.slackGroups[c.kind]})` }))} />
                  <p className="dz-hint wide">
                    {result?.slack?.next && !dirty
                      ? fill(L.slackRange, { from: slackFrom, to: slackFrom + result.slack.read - 1, next: slackFrom + result.slack.read, last: slackFrom + result.slack.read + 9999 })
                      : L.slackLimit}
                  </p>
                </>
              ) : (
                <div className={`dropzone${busy ? " frozen" : ""}`}>
                  <div className="dz-buttons">
                    <a className="btn outline" href="/api/slack/start">
                      {L.slackConnect}
                    </a>
                  </div>
                  <p className="dz-hint wide">{L.slackHint}</p>
                </div>
              )}
            </div>
          )}

          {mode === "files" && (
            <div className="field">
              <div
                className={`dropzone${over ? " over" : ""}${busy ? " frozen" : file ? " locked" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!busy && !file) setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  if (!busy && !file) addFile(e.dataTransfer.files);
                }}
              >
                <input ref={picker} className="file-input" type="file" disabled={busy || !!file} aria-label={L.choose} onChange={(e) => addFile(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
                <p className="dz-title">{L.drop}</p>
                <p className="dz-or">{L.dropOr}</p>
                <div className="dz-buttons">
                  <button className="btn outline" type="button" disabled={busy || !!file} onClick={() => picker.current?.click()}>
                    {L.choose}
                  </button>
                </div>
                <p className="dz-hint wide">{L.filesHint}</p>
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

        {mode === "slack" && slack && (
          <div className="ctrl bigscan">
            <button className="btn outline" type="button" disabled={busy} onClick={disconnectSlack}>
              {L.slackDisconnect}
            </button>
          </div>
        )}
        <div className="ctrl bigscan">
          {busy ? (
            <button
              className="btn outline"
              type="button"
              onClick={cancelScan}
            >
              {L.cancel}
            </button>
          ) : (
            <button className="btn" type="button" disabled={!ready} onClick={() => run()}>
              {mode === "slack" && result?.slack?.next && !dirty ? L.slackScanNext : result && !dirty ? L.scanAgain : L.scan}
            </button>
          )}
        </div>
        {mode === "history" && <p className="dz-hint repohint">{L.prNote}</p>}
        {/* A PR history result names the repository only, with no commit or file count. */}
        {result && !busy && result.repo?.sha && (
          <ul className="notes scaninfo">
            <li>
              <b>{R.repoCommit}</b> {result.repo.sha.slice(0, 7)}
            </li>
            <li>
              <b>{R.filesRead}:</b> {result.repo.files}. {readFiles.length > 0 && <ListDialog link={R.seeFiles} title={R.filesTitle} items={readFiles.map((f) => (f.note ? `${f.file}. ${f.note}` : f.file))} />}
            </li>
          </ul>
        )}
        {/* Upload, Google Drive and Website: one file is named; several are counted, with the list behind See more. */}
        {result && !busy && !result.repo && !result.slack && readFiles.length > 0 && (
          <ul className="notes scaninfo">
            <li>
              {readFiles.length === 1 ? (
                <>
                  <b>{R.fileRead}:</b> {readFiles[0].file}
                </>
              ) : (
                <>
                  <b>{R.filesRead}:</b> {readFiles.length}. <ListDialog link={R.seeFiles} title={R.filesTitle} items={readFiles.map((f) => (f.note ? `${f.file}. ${f.note}` : f.file))} />
                </>
              )}
            </li>
          </ul>
        )}
        {result && !busy && (unchecked.length > 0 || unreadNames.length > 0 || unreadScripts.length > 0 || Object.keys(result.repo?.skipped ?? {}).length > 0) && (
          <ul className="notes scaninfo">
            <li>
              <b>{R.repoSkipped}:</b> {[...Object.entries(result.repo?.skipped ?? {}).map(([reason, n]) => `${n} ${reason}`), ...(unchecked.length > 0 ? [`${unchecked.length} ${R.notChecked}`] : []), ...(unreadScripts.length > 0 ? [`${unreadScripts.length} ${R.scriptsNotRead}`] : []), ...unreadNames].join(", ")}
              {unreadScripts.length > 0 && (
                <>
                  {". "}
                  <ListDialog link={R.seeHere} title={`${R.repoSkipped}: ${R.scriptsNotRead}`} items={unreadScripts.map((f) => `${f.file}. ${f.note ?? ""}`)} />
                </>
              )}
              {unchecked.length > 0 && (
                <>
                  {". "}
                  <ListDialog link={R.seeWhich} title={`${R.repoSkipped}: ${R.notChecked}`} items={unchecked.map((f) => placeLabel(f.place))} />
                </>
              )}
            </li>
          </ul>
        )}
        {result && !busy && result.summary.blocked > 0 && (
          <p className="note scaninfo" role="status">
            <b>Note:</b> {result.summary.blocked} {result.summary.blocked === 1 ? "finding was" : "findings were"} hidden for safety and counted as real, because the value also appears in normal text.
          </p>
        )}
      </div>

      <div className="pane">
        <h3 className="ph">{R.title}</h3>
        <div aria-live="polite" aria-atomic="false">
          {error && <p className="err">{error}</p>}
          {cancelled && !error && !busy && <p className="preview-title">{R.cancelled}</p>}
          {!result && !error && !cancelled && !busy && (
            <div className="empty preview">
              <p className="preview-title">{R.empty}</p>
              <div className="findghost" aria-hidden="true">
                <b>{R.exampleType}</b>
                <span className="masked">AK****************01</span>
              </div>
              <p className="preview-hint">{R.emptyHint}</p>
            </div>
          )}
          {busy && (
            <div className="skeleton">
              <div className="skel">
                <p className="note working" role="status">
                  {step
                    ? `${R.steps[step.step]}${step.total ? `: ${step.step === "ai" ? "step " : ""}${step.done} of ${step.total}` : ""}`
                    : progress?.total
                      ? `${mode === "slack" ? R.slackProgress : R.prProgress}: ${progress.done} of ${progress.total}`
                      : R.working}
                  <span className="dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </p>
              </div>
            </div>
          )}
          {result && !busy && (
            <>
              <h4 className="count" tabIndex={-1} ref={countRef}>
                {count === 0 ? (unchecked.length > 0 ? R.noneUnchecked : result.summary.unread ? R.noneUnread : R.none) : count === 1 ? R.one : `${count} ${R.many}`}
              </h4>
              <p className="source">
                {R.inLabel}
                {source}
              </p>
              {count > 0 && (
                <ul className="tally" aria-label={R.tallyLabel}>
                  {groups.map(([kind, n]) => (
                    <li key={kind}>
                      <button type="button" className={`tally-${kind}`} aria-pressed={kind === shown} onClick={() => setGroup(kind)}>
                        <b>{n}</b> {R.tallyNames[kind]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="findings">
                {visible.filter((f) => groupOf(f) === shown).map((f, i) => (
                  <FindingCard key={f.id} finding={f} index={i} repo={result.repo} />
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
