"use client";

import { useEffect, useRef, useState } from "react";
import { content as C } from "../content";

const L = C.leak;
type Kind = (typeof L.files)[number]["kind"];

// The story, in stages: 1 the chat types itself (Add it), 2 the key is circled (Find it),
// 3 the note writes in (Judge it), 4 other files land and are circled, 5 everything but the circled secrets fades back.
// Which step on the right is lit at each stage:
const STEP = [-1, 0, 1, 2, 2, 2];
const LAST = STEP.length - 1;

// A person's typing: about 45 to 90ms a key, a beat longer after a space, a pause after a comma or full stop.
const keystroke = (ch: string) => 45 + Math.random() * 45 + (ch === " " ? 25 : 0) + (/[,.]/.test(ch) ? 140 : 0);

// A hand-drawn circle round a masked value. pathLength 1 lets the CSS draw it in.
function Ring() {
  return (
    <svg viewBox="0 0 200 50" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M10 28 C 8 6, 150 2, 192 18 C 206 28, 186 48, 100 47 C 30 46, 0 40, 14 20" />
    </svg>
  );
}

// One small mark per kind of file.
function Icon({ kind }: { kind: Kind }) {
  if (kind === "drive")
    return (
      <svg className="leak__icon" viewBox="0 0 24 21" aria-hidden="true">
        <path fill="#0F9D58" d="M8 0 0 14l4 7 8-14z" />
        <path fill="#FFC107" d="M16 0H8l8 14h8z" />
        <path fill="#4285F4" d="M4 21h16l4-7H8z" />
      </svg>
    );
  if (kind === "github")
    return (
      <svg className="leak__icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"
        />
      </svg>
    );
  if (kind === "pdf")
    return (
      <svg className="leak__icon" viewBox="0 0 20 24" aria-hidden="true">
        <path fill="#E5443A" d="M2 0h11l7 7v15a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2z" />
        <path fill="#F59A93" d="M13 0v5a2 2 0 0 0 2 2h5z" />
        <text x="10" y="19" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#fff" fontFamily="sans-serif">
          PDF
        </text>
      </svg>
    );
  return (
    <svg className="leak__icon" viewBox="0 0 24 20" aria-hidden="true">
      <rect x="1" y="1" width="22" height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="8" cy="7" r="2" fill="currentColor" />
      <path fill="currentColor" d="M3 17l6-6 4 4 3-3 5 5z" />
    </svg>
  );
}

const lines = L.chat.map((line) => line.text + (line.key ?? "") + (("after" in line ? line.after : undefined) ?? ""));

export function Leak() {
  const root = useRef<HTMLDivElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLParagraphElement>(null);
  const key = useRef<HTMLSpanElement>(null);
  // The page is first drawn with the finished story, so it is complete without script. With script it stays hidden
  // until this decides: reduced motion shows it still; otherwise it resets with transitions off for one frame
  // (so nothing visibly winds back), then shows and plays when scrolled into view.
  const [mode, setMode] = useState<"wait" | "settle" | "play" | "still">("wait");
  const [stage, setStage] = useState(LAST);
  // How many characters of each line are typed so far, and which line the block cursor is on.
  const [typed, setTyped] = useState<number[]>(() => lines.map((l) => l.length));
  const [cursor, setCursor] = useState(-1);

  // Plays once when the story scrolls into view. With reduced motion it stays on the finished picture.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMode("still");
      return;
    }
    setTyped(lines.map(() => 0));
    setStage(0);
    setMode("settle");
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setMode("play"))));
    const stop = new AbortController();
    const wait = (ms: number) =>
      new Promise<void>((done, fail) => {
        const t = window.setTimeout(done, ms);
        stop.signal.addEventListener("abort", () => {
          window.clearTimeout(t);
          fail(stop.signal.reason);
        });
      });
    const play = async () => {
      setStage(1);
      for (let i = 0; i < lines.length; i++) {
        setCursor(i);
        // The second person (the key line) waits a second longer before typing, as if thinking before sharing it.
        await wait(i === 0 ? 900 : i === 1 ? 1650 : 650);
        for (let n = 1; n <= lines[i].length; n++) {
          setTyped((t) => t.map((v, j) => (j === i ? n : v)));
          await wait(keystroke(lines[i][n - 1]));
        }
        await wait(400);
      }
      setCursor(-1);
      // Scan starts once the last line ("... into the config now") is written, and stays lit 3.2 seconds.
      setStage(2);
      await wait(3200);
      setStage(3);
      await wait(2600);
      setStage(4);
      await wait(3200);
      setStage(5);
    };
    const watcher = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      watcher.disconnect();
      play().catch(() => {});
    }, { threshold: 0.4 });
    watcher.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      stop.abort();
    };
  }, []);

  // On wide screens the note sits above the circled key, so its arrow ends just over the circle wherever the key falls.
  // On narrow screens the arrow is hidden and the note keeps its place at the top right of the chat (globals.css).
  useEffect(() => {
    const box = chat.current;
    if (!box) return;
    const place = () => {
      const n = note.current;
      const k = key.current;
      if (!n || !k) return;
      if (window.innerWidth < 900) {
        n.style.left = n.style.top = n.style.right = "";
        return;
      }
      const c = box.getBoundingClientRect();
      const r = k.getBoundingClientRect();
      n.style.right = "auto";
      n.style.left = `${r.left - c.left + r.width / 2 + 50}px`;
      n.style.top = `${r.top - c.top - 40 - n.offsetHeight}px`;
    };
    place();
    document.fonts?.ready.then(place);
    const sizer = new ResizeObserver(place);
    sizer.observe(box);
    return () => sizer.disconnect();
  }, []);

  return (
    <div className={`leak s${stage}${mode === "settle" || mode === "play" ? " armed" : ""}${mode === "settle" ? " settling" : ""}${mode === "play" || mode === "still" ? " ready" : ""}`} ref={root}>
      <div className="leak__stage">
        <div className="leak__chat" ref={chat}>
          <span className="leak__beam" aria-hidden="true" />
          <p className="leak__note" ref={note} aria-hidden="true">
            {L.note}
            <svg viewBox="0 0 60 50">
              <path pathLength={1} d="M58 4 C 40 10, 20 20, 6 44 M6 44 L 4 30 M6 44 L 20 40" />
            </svg>
          </p>
          {L.chat.map((line, i) => {
            // The whole line is always laid out, so nothing jumps; the part not typed yet is invisible.
            const n = typed[i];
            const said = line.text.slice(0, n);
            const keyShown = line.key ? line.key.slice(0, Math.max(0, n - line.text.length)) : "";
            // Words after the key, typed once the key is done.
            const after = ("after" in line ? line.after : undefined) ?? "";
            const keyEnd = line.text.length + (line.key?.length ?? 0);
            const afterShown = after.slice(0, Math.max(0, n - keyEnd));
            return (
              <p key={line.who + line.text} className={`leak__line${n > 0 || cursor === i ? " in" : ""}`}>
                <span className="leak__who">{line.who}</span> {said}
                {cursor === i && n <= line.text.length && <span className="leak__caret" aria-hidden="true" />}
                <span className="leak__rest">{line.text.slice(said.length)}</span>
                {line.key && (
                  <span className="leak__key" ref={key}>
                    {keyShown}
                    {cursor === i && n > line.text.length && (!after || n <= keyEnd) && <span className="leak__caret" aria-hidden="true" />}
                    <span className="leak__rest">{line.key.slice(keyShown.length)}</span>
                    <Ring />
                  </span>
                )}
                {after && (
                  <>
                    {afterShown}
                    {cursor === i && n > keyEnd && <span className="leak__caret" aria-hidden="true" />}
                    <span className="leak__rest">{after.slice(afterShown.length)}</span>
                  </>
                )}
              </p>
            );
          })}
        </div>
        <ul className="leak__files">
          {L.files.map((f) => (
            <li key={f.name} className={`leak__file leak__file--${f.kind}`}>
              <span className="leak__beam" aria-hidden="true" />
              <span className="leak__fname">
                <Icon kind={f.kind} />
                {f.name} <small>{f.place}</small>
              </span>
              <span className="leak__fline">
                {f.line}
                <span className="leak__key">
                  {f.key}
                  <Ring />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <ol className="leak__steps">
        {L.steps.map((s, i) => (
          <li key={s.title} className={STEP[stage] === i ? "on" : STEP[stage] > i ? "done" : undefined}>
            <b>{s.title}</b>
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
