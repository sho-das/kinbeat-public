"use client";

import { DriveMark, SlackMark } from "./Marks";
import { useEffect, useRef, useState } from "react";
import { content } from "../content";
import { driveFile, driveReady, pickDriveFile, revokeDrive } from "../lib/drive";
import type { DriveDoc } from "../lib/drive-files";
import { fileProblem, hiddenFromPage, notChecked, placeLabel, repoProblem, typeLabel, verdictKind, type ScanResult, type Template } from "../lib/scan";
import { FindingDetail } from "./Findings";
import { Select } from "./Select";

const L = content.left;
const A = content.ask;

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
// Puts numbers into a text such as "Messages {from} to {to}", written with thousands separators.
const fill = (text: string, values: Record<string, number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k].toLocaleString("en-US"));
// A pause, for the PR history scan's polling and retries.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// A GitHub link shown as owner/repository.
const repoLabel = (link: string) => link.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const NO_API = "The scanner is not reachable right now. Try again in a moment.";

type Mode = "paste" | "files" | "drive" | "slack" | "site" | "repo" | "history";
// The + menu next to the box: a file from this computer, Google Drive, or Slack.
const PLUS: Mode[] = ["files", "drive", "slack"];
// The steps each kind of scan goes through, in the order the server reports them (R.steps).
const STEP_ORDER: Partial<Record<Mode, Array<keyof typeof content.right.steps>>> & { paste: Array<keyof typeof content.right.steps> } = {
  repo: ["download", "files", "pictures", "ai"],
  site: ["site", "files", "ai"],
  paste: ["files", "ai"],
};
const CHIP_ICONS: Partial<Record<Mode, React.ReactNode>> = {
  files: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
    </svg>
  ),
  drive: <DriveMark />,
  slack: <SlackMark />,
};
type SlackChat = { id: string; name: string; kind: keyof typeof L.slackGroups };

export function Scanner() {
  // The window opens with only the box: pasted text, a link or a question. The + menu opens the other scans.
  const [mode, setMode] = useState<Mode>("paste");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // The Google Drive file picked for one scan, and Google's short-lived token to download it. Both are cleared when the scan ends or the tab changes.
  const [driveDoc, setDriveDoc] = useState<DriveDoc | null>(null);
  const driveToken = useRef("");
  // The Slack chats the visitor can read, once Slack is connected. The token itself stays on the server, never on this page.
  const [slack, setSlack] = useState<{
    team: string;
    chats: SlackChat[];
  } | null>(null);
  const [slackChat, setSlackChat] = useState("");
  // The first message number of the last Slack scan: 1, then 10,001, and so on.
  const [slackFrom, setSlackFrom] = useState(1);
  const [repo, setRepo] = useState("");
  // A public web address for the Website tab.
  const [site, setSite] = useState("");
  // A private repository's token lives only in this state, for one scan. It is cleared when the scan ends or the tab changes.
  const [token, setToken] = useState("");
  const [tokenSteps, setTokenSteps] = useState(false);
  // The PR history scan's progress: how many pull requests are read so far, out of how many.
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    step?: "read" | "ai";
  } | null>(null);
  // Every other scan's step, such as reading files 3 of 10, asked from the server while the scan runs.
  const [step, setStep] = useState<{
    step: keyof typeof R.steps;
    done?: number;
    total?: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The visitor pressed Cancel: the results side says so until the next scan or tab.
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  // The finding open under its row, one at a time. A new result starts with every row closed.
  const [openId, setOpenId] = useState<string | null>(null);
  // The last finished result, kept for its chat bubble even while a new scan runs or fails.
  const [shown, setShown] = useState<ScanResult | null>(null);
  const shownResult = useRef<ScanResult | null>(null);
  // The open fold (real, possible, ...). Null means the first kind with findings; "none" means all folded.
  const [group, setGroup] = useState<Group | "none" | null>(null);
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const countRef = useRef<HTMLHeadingElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stop = useRef<AbortController | null>(null);
  // The id of a PR history or Slack scan running on the server, so Cancel can stop it there too.
  const serverJob = useRef<string | null>(null);
  // A tab clicked while a scan runs. The popup asks first. The switch happens only after the scan has fully stopped.
  // Ask AI: the conversation under the panes, the box's text, and a scan the box asked for, started once its tab is set.
  type Pick = "files" | "drive" | "slack";
  // ask: a question KinBeat AI puts with buttons (public or private?) or a token ask with the help links.
  // result: the place of the latest scan result in the chat. It is one entry, moved to the end when a new result comes.
  const [plusOpen, setPlusOpen] = useState(false);
  const [chat, setChat] = useState<Array<{ who: "you" | "ai"; text: string; action?: Pick; ask?: "repoKind" | "token" | "historyRepo"; tokenFor?: "repo" | "history"; result?: true }>>([{ who: "ai", text: A.welcome }]);
  // The repository that was not found, waiting for the visitor to say public or private, then for a token.
  const pendingRepo = useRef("");
  const [awaitToken, setAwaitToken] = useState(false);
  // Which scan the next token is for, and whether the next line should be the PR history link.
  const tokenFor = useRef<"repo" | "history">("repo");
  const [awaitHistoryRepo, setAwaitHistoryRepo] = useState(false);
  // An error, or a cancelled scan, is said in the chat by KinBeat AI, in order, like any other message.
  useEffect(() => {
    if (error) setChat((c) => [...c, { who: "ai", text: error }]);
  }, [error]);
  useEffect(() => {
    if (cancelled) setChat((c) => [...c, { who: "ai", text: R.cancelled }]);
  }, [cancelled]);
  const [question, setQuestion] = useState("");
  // The scan box: a link or pasted text. Questions go in the Ask KinBeat AI box under it.
  const [asking, setAsking] = useState(false);
  const [autoRun, setAutoRun] = useState(0);
  // Seconds since the question was sent, for the answer's progress steps.
  const [thinking, setThinking] = useState(0);
  useEffect(() => {
    if (!asking) return;
    setThinking(0);
    const start = Date.now();
    const t = window.setInterval(() => setThinking((Date.now() - start) / 1000), 200);
    return () => window.clearInterval(t);
  }, [asking]);
  // Most answers take a few seconds: the steps move at 1.5 and 4 seconds, and the bar slows as it nears the end.
  const thinkAt = thinking < 1.5 ? 0 : thinking < 4 ? 1 : 2;
  const thinkPercent = Math.min(95, Math.round(100 * (1 - Math.exp(-thinking / 4))));
  const [helpOpen, setHelpOpen] = useState(false);
  // True once the server says KinBeat AI is out of budget for today: the box scans only, with no AI call.
  const [capped, setCapped] = useState(false);
  useEffect(() => {
    fetch("/api/ask/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.ok === false) setCapped(true);
      })
      .catch(() => {});
  }, []);
  const [copied, setCopied] = useState("");
  const askBox = useRef<HTMLTextAreaElement>(null);
  const chatLog = useRef<HTMLOListElement>(null);
  // Answers already given in this scan, by the question as typed (case and spaces aside). The same question again gets the same answer with no AI call.
  const answered = useRef(new Map<string, { text: string; action?: Pick }>());

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((list: Template[]) => {
        // Only the chosen samples, in the page's order, some with a shorter title.
        const chosen = L.samples.flatMap((s) =>
          list
            .filter((t) => t.id === s.id)
            .map((t) => ({
              ...t,
              title: "title" in s && s.title ? s.title : t.title,
            })),
        );
        setTemplates(chosen);
      })
      .catch(() => setError(NO_API));
  }, []);

  // Slack sends the visitor back to the page with ?slack=connected, denied or failed. The tab opens, and the address is cleaned.
  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get("slack");
    if (!back) return;
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    setMode("slack");
    // A denied or failed connect is said in the chat with the Connect button under it, so the visitor can try again.
    if (back !== "connected") setChat((c) => [...c, { who: "ai", text: back === "denied" ? L.slackDenied : L.slackFailed, action: "slack" }]);
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
    if (result) countRef.current?.focus({ preventScroll: true });
    setOpenId(null);
    setGroup(null);
    if (result) {
      setShown(result);
      setChat((c) => [...c.filter((m) => !m.result), { who: "ai", text: "", result: true }]);
    }
    answered.current.clear();
  }, [result]);

  // Once the input changes, the button says Scan again no more.
  useEffect(() => {
    setDirty(true);
  }, [mode, text, file, repo, site, driveDoc, slackChat]);

  const ready = mode === "paste" ? !!text.trim() : mode === "repo" ? !!repo.trim() : mode === "site" ? !!site.trim() : mode === "history" ? !!repo.trim() && !!token.trim() : mode === "drive" ? !!driveDoc : mode === "slack" ? !!slackChat : !!file;

  function changeMode(next: Mode) {
    setMode(next);
    setCancelled(false);
    setToken("");
    clearDrive();
    // A new tab starts empty, so it never shows the result of a scan made in another tab.
    setResult(null);
    setSource("");
    setError(next === "files" ? fileProblem(file) : "");
  }

  function clearDrive() {
    revokeDrive(driveToken.current);
    driveToken.current = "";
    setDriveDoc(null);
  }

  // Google's picker opens straight away, and the picked file scans at once.
  // A help pick for Drive or Slack goes through the chat: the question, then KinBeat AI's line with the Connect button under it.
  function askPick(action: Pick, label: string) {
    setHelpOpen(false);
    setChat((c) => [...c, { who: "you", text: label }, { who: "ai", text: A.pickLines[action], action }]);
  }

  async function chooseDrive() {
    if (!driveReady) {
      setError(L.driveOff);
      return;
    }
    setError("");
    try {
      const { token: access, doc } = await pickDriveFile();
      if (!doc) return;
      // The file is chosen, so the Connect buttons above are done with.
      setChat((c) => c.map((m) => (m.action === "drive" ? { ...m, action: undefined } : m)));
      changeMode("drive");
      driveToken.current = access;
      setDriveDoc(doc);
      setAutoRun((n) => n + 1);
    } catch (e) {
      // The sign-in or the picker failed: the error carries the button, so the visitor can try again.
      setChat((c) => [...c.map((m) => (m.action === "drive" ? { ...m, action: undefined } : m)), { who: "ai", text: (e as Error).message, action: "drive" }]);
    }
  }

  // A picked file scans at once. One file at a time; when several are chosen together, the last one is kept.
  function pickFile(list: ArrayLike<File> | null) {
    const next = list?.[list.length - 1];
    if (!next || busy) return;
    changeMode("files");
    setFile(next);
    const problem = fileProblem(next);
    setError(problem);
    if (!problem) setAutoRun((n) => n + 1);
  }

  // Slack's permission page opens straight away. Once connected, the chat list shows above the box.
  function openSlack() {
    if (slack) changeMode("slack");
    else window.location.assign("/api/slack/start");
  }

  // Cancel stops the scan on the server too, then stops the page from waiting for it.
  function cancelScan() {
    if (serverJob.current)
      fetch(`/api/scan/repo/history/${serverJob.current}`, {
        method: "DELETE",
        cache: "no-store",
      }).catch(() => {});
    stop.current?.abort();
    setCancelled(true);
  }

  // A scan the Ask box routed: the tab and its input are set in the same render, so run() sees them here.
  useEffect(() => {
    if (autoRun) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  // "Public": the link is wrong. "Private": a read-only token is asked for in the chat; the next message is that token.
  function answerRepoKind(kind: "public" | "private") {
    setChat((c) => [...c.map((m) => (m.ask === "repoKind" ? { ...m, ask: undefined } : m)), { who: "you", text: kind === "public" ? A.repoPublic : A.repoPrivate }]);
    if (kind === "public") {
      setChat((c) => [...c, { who: "ai", text: A.repoNotFound }]);
      return;
    }
    setChat((c) => [...c, { who: "ai", text: A.repoToken, ask: "token", tokenFor: "repo" }]);
    tokenFor.current = "repo";
  }

  // Share a read access token: the box gets the token line, the visitor pastes the token after it and presses Scan.
  // Under a counts-only result the same repository scans again with the token; under a token ask it is the pending one.
  function shareToken(kind: "repo" | "history") {
    if (kind === "repo" && !pendingRepo.current) pendingRepo.current = repo;
    tokenFor.current = kind;
    setAwaitToken(true);
    setQuestion(A.tokenPrefix);
    askBox.current?.focus();
  }

  // The token never shows in the chat: the bubble says only that it was pasted. The scan runs with it, then forgets it.
  function scanWithToken(value: string) {
    // Without the token line the visitor changed their mind: the text is an ordinary message, not a token.
    if (!value.toLowerCase().startsWith(A.tokenPrefix.trim().toLowerCase())) {
      setAwaitToken(false);
      return false;
    }
    const pasted = value.slice(A.tokenPrefix.trim().length).trim();
    if (!pasted) return true;
    setAwaitToken(false);
    setQuestion("");
    setChat((c) => [...c.map((m) => (m.ask === "token" ? { ...m, ask: undefined } : m)), { who: "you", text: A.tokenPasted }]);
    changeMode(tokenFor.current);
    setRepo(pendingRepo.current);
    setToken(pasted);
    setAutoRun((n) => n + 1);
    return true;
  }

  // The PR history scan from the chat: the link comes as the next line, then the token.
  function takeHistoryRepo(value: string) {
    setQuestion("");
    setChat((c) => [...c, { who: "you", text: value }]);
    if (!/github\.com\/[^/\s]+\/[^/\s]+/i.test(value)) {
      setChat((c) => [...c, { who: "ai", text: A.historyBadLink }]);
      return;
    }
    setAwaitHistoryRepo(false);
    setChat((c) => [...c.map((m) => (m.ask === "historyRepo" ? { ...m, ask: undefined } : m)), { who: "ai", text: A.historyToken, ask: "token", tokenFor: "history" }]);
    pendingRepo.current = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    tokenFor.current = "history";
  }

  // With KinBeat AI out of budget, the box scans on its own: a GitHub repository link, another web page, or the text as pasted.
  function scanLocal(value: string) {
    const link = value.length <= 300 && !/\s/.test(value) && /^(https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(\/|$)/i.test(value) ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null;
    const next: Mode = !link ? "paste" : /github\.com\/[^/\s]+\/[^/\s]+/i.test(link) ? "repo" : "site";
    changeMode(next);
    if (next === "paste") setText(value);
    else if (next === "site") setSite(link!);
    else setRepo(link!);
    setQuestion("");
    setAutoRun((n) => n + 1);
  }

  // Sends the box's text. A link or pasted text comes back as a scan to start in its tab; a question gets the AI's answer.
  // The AI sees only this scan's numbered findings, their types, labels and reasons, never a value.
  async function sendQuestion() {
    const message = question.trim();
    if (!message || asking) return;
    // The help folds away so the chat window gets the room.
    setHelpOpen(false);
    if (awaitToken) {
      if (busy || scanWithToken(message)) return;
    }
    if (awaitHistoryRepo) {
      takeHistoryRepo(message);
      return;
    }
    if (message.toLowerCase() === A.historyPick.toLowerCase()) {
      setQuestion("");
      setChat((c) => [...c, { who: "you", text: message }, { who: "ai", text: A.historyLink, ask: "historyRepo" }]);
      setAwaitHistoryRepo(true);
      return;
    }
    if (capped) {
      if (!busy) scanLocal(message);
      return;
    }
    // "Scan a Google Drive file" or "Scan my Slack chats", typed or picked from the help panel, goes to the Connect step, not the AI.
    const pick = A.help.picks.find((p) => p.label.toLowerCase() === message.toLowerCase());
    if (pick) {
      setQuestion("");
      askPick(pick.action as Pick, pick.label);
      return;
    }
    if (busy) {
      setChat((c) => [...c, { who: "ai", text: A.running }]);
      return;
    }
    const key = message.toLowerCase().replace(/\s+/g, " ");
    const before = answered.current.get(key);
    if (before) {
      setQuestion("");
      setChat((c) => [...c, { who: "you", text: message }, { who: "ai", ...before }]);
      return;
    }
    setQuestion("");
    setChat((c) => [...c, { who: "you", text: message }]);
    setAsking(true);
    const summary = result
      ? {
          source,
          complete: !result.summary.unread,
          findings: visible.map((f, i) => ({
            n: i + 1,
            type: typeLabel(f),
            verdict: verdictKind(f),
            reason: f.judge.reason ?? "",
          })),
        }
      : undefined;
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, summary }),
      });
      const reply = response.ok ? await response.json() : null;
      if (reply?.kind === "scan") {
        changeMode(reply.mode);
        if (reply.mode === "paste") setText(reply.value);
        else if (reply.mode === "site") setSite(reply.value);
        else setRepo(reply.value);
        setAutoRun((n) => n + 1);
        return;
      }
      if (reply?.capped) setCapped(true);
      const answer = { text: reply?.text ?? NO_API, ...(reply?.action === "drive" || reply?.action === "slack" || reply?.action === "files" ? { action: reply.action as Pick } : {}) };
      // The AI tags the scan the visitor means (repo, history, site). With a link in the message the page starts it;
      // without one, the AI has asked for the link, and a history scan then waits for it. Those answers are not kept.
      const tagged = reply?.action === "repo" || reply?.action === "history" || reply?.action === "site" ? (reply.action as "repo" | "history" | "site") : null;
      const link = typeof reply?.link === "string" ? reply.link : "";
      if (reply?.text && !reply.retry && !tagged) answered.current.set(key, answer);
      if (tagged === "history" && link) {
        setChat((c) => [...c, { who: "ai", ...answer }, { who: "ai", text: A.historyToken, ask: "token", tokenFor: "history" }]);
        pendingRepo.current = link;
        tokenFor.current = "history";
        return;
      }
      setChat((c) => [...c, { who: "ai", ...answer }]);
      if (tagged === "history") setAwaitHistoryRepo(true);
      if ((tagged === "repo" || tagged === "site") && link) {
        changeMode(tagged);
        if (tagged === "site") setSite(link);
        else setRepo(link);
        setAutoRun((n) => n + 1);
      }
    } catch {
      setChat((c) => [...c, { who: "ai", text: NO_API }]);
    } finally {
      setAsking(false);
    }
  }

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
    // A chat is chosen and scanning, so the Connect Slack buttons above are done with.
    setChat((c) => c.map((m) => (m.action === "slack" ? { ...m, action: undefined } : m)));
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
        let job: {
          message?: string;
          done: number;
          total: number;
          step?: "read" | "ai";
          state: string;
          error?: string;
          result?: unknown;
        } | null = null;
        for (let attempt = 1; attempt <= 3 && !job; attempt++) {
          try {
            const res = await fetch(`/api/scan/repo/history/${startData.id}`, {
              cache: "no-store",
              signal,
            });
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
        setProgress({ done: job.done, total: job.total, step: job.step });
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
      // Nothing is kept in the browser: every scan runs live, so visitors always see the real calls.
      const sweep = new Promise((done) => setTimeout(done, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1150));
      let response: Response;
      let label: string;
      if (mode === "paste") {
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
          body: JSON.stringify({
            url: link,
            useModel: true,
            ...(token.trim() ? { token: token.trim() } : {}),
          }),
          signal,
        });
      } else if (mode === "drive" && driveDoc) {
        const picked = await driveFile(driveToken.current, driveDoc, signal);
        const form = new FormData();
        form.append("file", picked);
        form.append("useModel", "true");
        label = picked.name;
        response = await fetch("/api/scan/file", {
          method: "POST",
          headers: progressHeader,
          body: form,
          signal,
        });
      } else if (file) {
        const problem = fileProblem(file);
        if (problem) throw new Error(problem);
        const form = new FormData();
        form.append("file", file);
        form.append("useModel", "true");
        label = file.name;
        response = await fetch("/api/scan/file", {
          method: "POST",
          headers: progressHeader,
          body: form,
          signal,
        });
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
    } catch (e) {
      // Cancel is the visitor's choice, so it shows no error.
      if ((e as Error).name === "AbortError") {
        // nothing to say
      } else if (mode === "repo" && !token.trim() && /not found/i.test((e as Error).message)) {
        // A repository GitHub would not open: it may be private. KinBeat AI asks, and a token can follow in the chat.
        pendingRepo.current = repo;
        setChat((c) => [...c, { who: "ai", text: A.repoAsk, ask: "repoKind" }]);
      } else {
        setError(e instanceof TypeError ? NO_API : (e as Error).message);
      }
    } finally {
      clearInterval(asking);
      setStep(null);
      stop.current = null;
      setToken("");
      if (mode === "drive") clearDrive();
      setBusy(false);
    }
  }

  const visible = shown ? shown.findings.filter((f) => !hiddenFromPage(f) && !notChecked(f)) : [];
  const unchecked = shown ? shown.findings.filter(notChecked) : [];
  // A picture, or a page read as a picture, that could not be read after 2 tries is listed by name under Not scanned.
  // A file that was not read at all leaves the list of files read.
  const unreadFiles = shown?.files?.filter((f) => f.notRead || (f.notReadPages?.length ?? 0) > 0) ?? [];
  // A website's left-out scripts can be many, so they are counted here and listed behind See here.
  const unreadScripts = unreadFiles.filter((f) => f.type === "script");
  const unreadNames = unreadFiles.filter((f) => f.type !== "script").map((f) => (f.notReadPages?.length ? `${f.file} (page ${f.notReadPages.join(", ")})` : f.file));
  const readFiles = shown?.files?.filter((f) => !f.notRead) ?? [];
  const count = shown?.repo?.counts ? shown.repo.counts.real + shown.repo.counts.possible + shown.repo.counts.other : visible.length;
  // The progress under the box, as GitGuardian shows it: every step of this kind of scan, the one running now,
  // and a percent from the steps done plus the part of the current step the server reports.
  const order = STEP_ORDER[mode] ?? STEP_ORDER.paste;
  const counted = (mode === "slack" || mode === "history") && !step;
  const scanRows = counted ? [`${mode === "slack" ? R.slackProgress : R.prProgress}${progress?.total ? `: ${progress.done} of ${progress.total}` : ""}`, R.steps.ai] : order.map((k) => (step?.step === k && step.total ? `${R.steps[k]}: ${step.done} of ${step.total}` : R.steps[k]));
  const scanAt = counted ? (progress?.step === "ai" ? 1 : 0) : Math.max(0, step ? order.indexOf(step.step) : 0);
  const within = counted ? (progress?.step === "ai" ? 0.5 : progress?.total ? progress.done / progress.total : 0) : step?.total ? (step.done ?? 0) / step.total : 0;
  const scanPercent = Math.min(99, Math.round(((scanAt + within) / scanRows.length) * 100));
  // Slack's chat pick and every scan's progress live in the chat, as bubbles from KinBeat AI written by code.
  const slackPick = mode === "slack" && !!slack;
  // The Ask box is off while a Slack chat is being picked and while a scan runs.
  const boxOff = busy || slackPick;
  // The newest message is scrolled into view, and the box takes the cursor back once the answer is in.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const log = chatLog.current;
    if (!log) return;
    // A scan that has just finished shows from its count down; anything else shows the newest message.
    const fresh = result && !busy && result !== shownResult.current;
    if (fresh) shownResult.current = result;
    const shown = fresh ? log.querySelector<HTMLElement>(".chat__result") : null;
    log.scrollTop = shown ? shown.offsetTop - 4 : log.scrollHeight;
    if (!asking && chat.length > 1) askBox.current?.focus({ preventScroll: true });
  }, [chat, asking, busy, slackPick, scanAt, result]);

  // The box grows with its text, up to about six lines, then scrolls inside itself.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const box = askBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [question]);

  // The section heading, the line under it and the whole chat window stay on screen together on every device:
  // the chat log gets only the height that is left once those fixed parts fit, and scrolls inside itself.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const log = chatLog.current;
    const section = log?.closest<HTMLElement>("#scan");
    if (!log || !section) return;
    const fit = () => {
      const head = section.querySelector<HTMLElement>("h2");
      const box = log.closest<HTMLElement>(".scanbox");
      if (!head || !box) return;
      const fixed = box.getBoundingClientRect().bottom - head.getBoundingClientRect().top - log.offsetHeight;
      const room = window.innerHeight - fixed - 24;
      // At least two bubbles stay in view: the floor is 360px, or 45% of a short screen.
      log.style.maxHeight = `${Math.max(Math.min(360, window.innerHeight * 0.45), Math.min(room, window.innerHeight * 0.6))}px`;
    };
    fit();
    const sizer = new ResizeObserver(fit);
    sizer.observe(section);
    window.addEventListener("resize", fit);
    return () => {
      sizer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // When a scan or an answer starts or ends, the page scrolls so the heading, its line and the whole chat window
  // sit on screen together, from the heading down. The box never goes below the screen.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!busy && !asking && !result) return;
    // A short wait lets the chat window take its new height first; an earlier smooth scroll is replaced, not stacked.
    const id = window.setTimeout(() => {
      const head = chatLog.current?.closest<HTMLElement>("#scan")?.querySelector<HTMLElement>("h2");
      if (!head) return;
      const top = head.getBoundingClientRect().top + window.scrollY - 16;
      window.scrollTo({ top: Math.max(0, top), behavior: still() ? "auto" : "smooth" });
    }, 120);
    return () => window.clearTimeout(id);
  }, [busy, asking, result]);
  // A public repository without a token: the groups come from the server's counts, and no fold can open.
  const countsOnly = shown?.repo?.counts;
  // Nothing found: the token note and button would add nothing, so they stay hidden.
  const countsTotal = countsOnly ? (countsOnly.real ?? 0) + (countsOnly.possible ?? 0) + (countsOnly.other ?? 0) : 0;
  const groups = countsOnly ? (["real", "possible", "other"] as const).filter((k) => countsOnly[k]).map((k) => [k, countsOnly[k]] as [typeof k, number]) : tally(visible);
  const openGroup = group === "none" ? null : (group ?? groups[0]?.[0] ?? null);


  return (
    <div className="consolewrap">
      {/* A chat window: the scan's inputs, the progress, the results and the AI's answers sit above the one box.
        The box scans a link or pasted text, or asks KinBeat AI. The + menu next to it opens a file, Google Drive or Slack. */}
      <section className="scanbox" aria-label="Scan and results">
        <div className="chat__ask">
          {(chat.length > 0 || asking || busy || slackPick || (result && !busy)) && (
            <ol ref={chatLog} className="chat__log" aria-live="polite">
              {chat.map((m, i) =>
                m.result ? (
                  shown ? (
                    <li key={i} className="chat__msg ai chat__panel chat__result">
                    <span className="chat__who">{A.aiName}</span>
                        <div className="chat__resulthead">
                        <div>
                        <h4 className="count" tabIndex={-1} ref={countRef}>
                          {count === 0 ? (unchecked.length > 0 ? R.noneUnchecked : shown.summary.unread ? R.noneUnread : R.none) : count === 1 ? R.one : `${count} ${R.many}`}
                        </h4>
                        <p className="source">
                          {R.inLabel}
                          {source}
                        </p>
                        </div>
                        <div className="chat__resultnotes">
                {/* A PR history shown names the repository only, with no commit or file count. */}
                {shown && !busy && shown.repo?.sha && (
                  <ul className="notes scaninfo">
                    <li>
                      <b>{R.repoCommit}</b> {shown.repo.sha.slice(0, 7)}
                    </li>
                    <li>
                      <b>{R.filesRead}:</b> {shown.repo.files}
                    </li>
                  </ul>
                )}
                {/* Upload, Google Drive and Website: one file is named; several are counted, with the list behind See more. */}
                {shown && !busy && !shown.repo && !shown.slack && readFiles.length > 0 && (
                  <ul className="notes scaninfo">
                    <li>
                      {readFiles.length === 1 ? (
                        <>
                          <b>{R.fileRead}:</b> {readFiles[0].file}
                        </>
                      ) : (
                        <>
                          <b>{R.filesRead}:</b> {readFiles.length}
                        </>
                      )}
                    </li>
                  </ul>
                )}
                        </div>
                        </div>
                        {/* One fold per kind that has findings: "3 real", "1 possible". The open fold lists its rows; a row opens its detail. */}
                        {groups.map(([kind, n]) => (
                          <div key={kind} className={`findgroup ${kind}${openGroup === kind ? " open" : ""}`}>
                            <button type="button" className="findgroup__head" aria-expanded={openGroup === kind} disabled={!!countsOnly} onClick={() => setGroup(openGroup === kind ? "none" : kind)}>
                              <b>{n}</b> {R.tallyNames[kind]}
                              {!countsOnly && (
                                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                                  <path d="M5 8l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </button>
                            {openGroup === kind && !countsOnly && (
                              <ol className="findlist">
                                {visible
                                  .filter((f) => groupOf(f) === kind)
                                  .map((f) => (
                                    <li key={f.id} className={openId === f.id ? "open" : undefined}>
                                      <button type="button" className={`findlist__row ${kind}`} aria-expanded={openId === f.id} onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                                        <span className="findlist__n">{visible.indexOf(f) + 1}</span>
                                        <span className="findlist__type">{typeLabel(f)}</span>
                                        <span className="findlist__place">{placeLabel(f.place)}</span>
                                        <svg className="findlist__arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                                          <path d="M5 8l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </button>
                                      {openId === f.id && <FindingDetail finding={f} repo={shown.repo} />}
                                    </li>
                                  ))}
                              </ol>
                            )}
                          </div>
                        ))}
                {shown && !busy && (unchecked.length > 0 || unreadNames.length > 0 || unreadScripts.length > 0 || Object.keys(shown.repo?.skipped ?? {}).length > 0) && (
                  <ul className="notes scaninfo">
                    <li>
                      <b>{R.repoSkipped}:</b> {[...Object.entries(shown.repo?.skipped ?? {}).map(([reason, n]) => `${n} ${reason}`), ...(unchecked.length > 0 ? [`${unchecked.length} ${R.notChecked}`] : []), ...(unreadScripts.length > 0 ? [`${unreadScripts.length} ${R.scriptsNotRead}`] : []), ...unreadNames].join(", ")}
                    </li>
                  </ul>
                )}
                {shown && !busy && countsOnly && countsTotal > 0 && (
                  <div className="note scaninfo" role="status">
                    <p>{R.countsOnlyNote}</p>
                    <p className="chat__hint">
                      <a href={L.repoTokenHelpUrl} target="_blank" rel="noopener noreferrer">
                        {L.tokenLink}
                      </a>{" "}
                      {L.tokenHintEnd}{" "}
                      <button type="button" className="linkbtn" aria-expanded={tokenSteps} onClick={() => setTokenSteps(!tokenSteps)}>
                        {tokenSteps ? L.tokenLess : L.tokenMore}
                      </button>
                    </p>
                    {tokenSteps && (
                      <div className="tokensteps">
                        <p className="tokensteps__title">{L.tokenStepsTitle}</p>
                        <ol>
                          {L.repoTokenSteps.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    <button type="button" className="btn outline chat__pick" disabled={awaitToken} onClick={() => shareToken("repo")}>
                      {R.shareToken}
                    </button>
                  </div>
                )}
                {shown && !busy && shown.summary.blocked > 0 && (
                  <p className="note scaninfo" role="status">
                    <b>Note:</b> {shown.summary.blocked} {shown.summary.blocked === 1 ? "finding was" : "findings were"} hidden for safety and counted as real, because the value also appears in normal text.
                  </p>
                )}
                  </li>
                  ) : null
                ) : (
                <li key={i} className={`chat__msg ${m.who}`}>
                  {m.who === "you" ? <span className="visually-hidden">{A.you}: </span> : <span className="chat__who">{A.aiName}</span>}
                  {m.text}
                  {m.ask === "repoKind" && (
                    <div className="chat__actions">
                      <button type="button" className="btn outline chat__pick" disabled={busy} onClick={() => answerRepoKind("public")}>
                        {A.repoPublic}
                      </button>
                      <button type="button" className="btn outline chat__pick" disabled={busy} onClick={() => answerRepoKind("private")}>
                        {A.repoPrivate}
                      </button>
                    </div>
                  )}
                  {m.ask === "token" && (
                    <div className="chat__form">
                      <p className="chat__hint">
                        <a href={m.tokenFor === "history" ? L.tokenHelpUrl : L.repoTokenHelpUrl} target="_blank" rel="noopener noreferrer">
                          {L.tokenLink}
                        </a>{" "}
                        {L.tokenHintEnd}{" "}
                        <button type="button" className="linkbtn" aria-expanded={tokenSteps} onClick={() => setTokenSteps(!tokenSteps)}>
                          {tokenSteps ? L.tokenLess : L.tokenMore}
                        </button>
                      </p>
                      {tokenSteps && (
                        <div className="tokensteps">
                          <p className="tokensteps__title">{L.tokenStepsTitle}</p>
                          <ol>
                            {(m.tokenFor === "history" ? L.prTokenSteps : L.repoTokenSteps).map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <button type="button" className="btn outline chat__pick" disabled={busy || awaitToken} onClick={() => shareToken(m.tokenFor ?? "repo")}>
                        {R.shareToken}
                      </button>
                    </div>
                  )}
                  {m.action && (
                    <button type="button" className="btn outline chat__pick" disabled={busy} onClick={() => (m.action === "drive" ? chooseDrive() : m.action === "slack" ? openSlack() : picker.current?.click())}>
                      {CHIP_ICONS[m.action]}
                      {A.picks[m.action]}
                    </button>
                  )}
                </li>
                ),
              )}
              {/* A running scan: its progress and Cancel sit in the chat, so the box under it never moves. */}
              {busy && (
                <li className="chat__msg ai chat__wait">
                  <div className="progress" role="status">
                    <div className="progress__head">
                      <b>{R.progressTitle}</b>
                      <b>{scanPercent}%</b>
                    </div>
                    <div className="progress__bar" aria-hidden="true">
                      <i style={{ width: `${scanPercent}%` }} />
                    </div>
                    <ol className="progress__steps">
                      {scanRows.map((row, i) => (
                        <li key={row} className={i < scanAt ? "done" : i === scanAt ? "doing" : undefined}>
                          {row}
                        </li>
                      ))}
                    </ol>
                    {mode !== "slack" && (
                      <div className="chat__actions">
                        <button className="btn outline chat__pick" type="button" onClick={cancelScan}>
                          {L.cancel}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )}
              {/* Slack is connected: KinBeat AI asks which chat to scan, with the list, Scan and Cancel in the bubble. */}
              {slackPick && slack && (
                <li className="chat__msg ai chat__panel">
                  <span className="chat__who">{A.aiName}</span>
                  <span id="slack-l">{A.slackPick}</span>
                  <div className="chat__form">
                    <Select
                      labelledBy="slack-l"
                      value={slackChat}
                      onChange={setSlackChat}
                      disabled={busy}
                      options={slack.chats.map((c) => ({
                        value: c.id,
                        label: `${c.name} (${L.slackGroups[c.kind]})`,
                      }))}
                    />
                    <p className="chat__hint">
                      {result?.slack?.next && !dirty
                        ? fill(L.slackRange, {
                            from: slackFrom,
                            to: slackFrom + result.slack.read - 1,
                            next: slackFrom + result.slack.read,
                            last: slackFrom + result.slack.read + 9999,
                          })
                        : L.slackLimit}
                    </p>
                    <div className="chat__actions">
                      {busy ? (
                        <button className="btn chat__pick" type="button" onClick={cancelScan}>
                          {L.cancel}
                        </button>
                      ) : (
                        <button className="btn chat__pick" type="button" disabled={!ready} onClick={() => run()}>
                          {result?.slack?.next && !dirty ? L.slackScanNext : result && !dirty ? L.scanAgain : L.scan}
                        </button>
                      )}
                      <button className="btn outline chat__pick" type="button" disabled={busy} onClick={disconnectSlack}>
                        {L.slackDisconnect}
                      </button>
                    </div>
                  </div>
                </li>
              )}
              {/* The progress sits inside the chat, as the next message, so the box under it never moves. */}
              {asking && (
                <li className="chat__msg ai chat__wait">
                  <div className="progress" role="status">
                    <div className="progress__head">
                      <b>{A.thinkingTitle}</b>
                      <b>{thinkPercent}%</b>
                    </div>
                    <div className="progress__bar" aria-hidden="true">
                      <i style={{ width: `${thinkPercent}%` }} />
                    </div>
                    <ol className="progress__steps">
                      {A.thinkingSteps.map((row, i) => (
                        <li key={row} className={i < thinkAt ? "done" : i === thinkAt ? "doing" : undefined}>
                          {row}
                        </li>
                      ))}
                    </ol>
                  </div>
                </li>
              )}
            </ol>
          )}
        </div>
        <div className="askbox">
          {capped && <p className="askbox__note">{A.capped}</p>}
          <form
            className="scanrow"
            onSubmit={(e) => {
              e.preventDefault();
              sendQuestion();
            }}
          >
            <div className="scanrow__field">
              {/* The + menu, as in a chat app: upload a file, or connect Google Drive or Slack. */}
              <div className="plus">
                <button type="button" className="plus__btn" aria-label={A.plus} aria-haspopup="menu" aria-expanded={plusOpen} disabled={busy} onClick={() => setPlusOpen((o) => !o)}>
                  +
                </button>
                {plusOpen && (
                  <div className="plus__menu" role="menu">
                    {PLUS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="menuitem"
                        className="plus__item"
                        onClick={() => {
                          setPlusOpen(false);
                          if (m === "files") picker.current?.click();
                          else if (m === "drive") chooseDrive();
                          else openSlack();
                        }}
                      >
                        {CHIP_ICONS[m]}
                        {L.modes.find((x) => x.id === m)?.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                ref={askBox}
                rows={1}
                value={question} maxLength={2000} placeholder={awaitToken ? A.tokenPlaceholder : capped ? A.scanPlaceholder : A.askPlaceholder} aria-label={awaitToken ? A.tokenPlaceholder : capped ? A.scanPlaceholder : A.askPlaceholder} autoComplete="off" readOnly={asking || boxOff} onChange={(e) => setQuestion(e.target.value)}
                // Enter sends; Shift + Enter starts a new line, so a pasted chat keeps its lines.
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendQuestion();
                  }
                }}
              />
            </div>
            <button className="btn askbox__btn" type="submit" disabled={!question.trim() || asking || boxOff}>
              {asking ? (
                <span className="dots" aria-label={A.askTag}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : capped || awaitToken ? (
                A.scan
              ) : (
                A.askTag
              )}
            </button>
          </form>
        </div>
        <div className="chips" role="group">
          <input ref={picker} className="file-input" type="file" aria-label={L.choose} onChange={(e) => pickFile(e.target.files)} onClick={(e) => ((e.target as HTMLInputElement).value = "")} />
          <button type="button" className="linkbtn askbox__help" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
            {A.help.open}
          </button>
        </div>
        {helpOpen && (
          <div className="askhelp" role="region" aria-label={A.help.open}>
            <div className="askhelp__head">
              <b>{A.help.open}</b>
              <button type="button" className="linkbtn" onClick={() => setHelpOpen(false)}>
                {A.help.close}
              </button>
            </div>
            <p className="askhelp__intro">{A.help.intro}</p>
            <div className="askhelp__queries">
              {[...A.help.picks.map((p) => ({ text: p.label, action: p.action as Pick })), ...A.help.queries.map((q) => ({ text: q, action: undefined }))].map((q) => (
                <button
                  key={q.text}
                  type="button"
                  className="chip"
                  onClick={() => {
                    setQuestion(q.text);
                    askBox.current?.focus();
                  }}
                >
                  {q.action && CHIP_ICONS[q.action]}
                  {q.text}
                </button>
              ))}
            </div>
            <div className="askhelp__group">
              <p>
                <b>{A.help.samplesTitle}</b> - {A.help.samplesNote}
              </p>
              <div className="askhelp__samples">
                {templates.map((t) => (
                  <figure key={t.id} className="askhelp__sample">
                    <figcaption>{t.title}</figcaption>
                    <pre>{t.text}</pre>
                    <div className="askhelp__actions">
                      <button
                        type="button"
                        className="chip"
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(t.text ?? "")
                            .then(() => setCopied(t.id))
                            .catch(() => {});
                        }}
                      >
                        {copied === t.id ? A.help.copied : A.help.copy}
                      </button>
                    </div>
                  </figure>
                ))}
              </div>
            </div>
            <p className="askhelp__tipstitle">
              <b>{A.help.showsTitle}</b>
            </p>
            <ul className="askhelp__tips">
              {A.help.shows.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="askhelp__tipstitle">
              <b>{A.help.tipsTitle}</b>
            </p>
            <ul className="askhelp__tips">
              {A.help.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
