"use client";

import { useEffect, useRef } from "react";
import { content as C } from "../content";
import { DriveMark, FileMark, GitHubMark, SlackMark } from "./Marks";

const L = C.leak;

// The story is a still picture: the chat, the circled key and the note.

// A hand-drawn circle round a masked value. pathLength 1 lets the CSS draw it in.
function Ring() {
  return (
    <svg viewBox="0 0 200 50" preserveAspectRatio="none" aria-hidden="true">
      <path pathLength={1} d="M10 28 C 8 6, 150 2, 192 18 C 206 28, 186 48, 100 47 C 30 46, 0 40, 14 20" />
    </svg>
  );
}

export function Leak() {
  const chat = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLParagraphElement>(null);
  const key = useRef<HTMLSpanElement>(null);

  // On wide screens the note sits above the circled key, so its arrow ends just over the circle wherever the key falls.
  // On narrow screens the arrow is hidden and the note keeps its place at the top right of the chat (globals.css).
  // The note stays invisible until it is placed, so it never shows in one spot and then jumps to another.
  useEffect(() => {
    const box = chat.current;
    if (!box) return;
    const place = () => {
      const n = note.current;
      const k = key.current;
      if (!n || !k) return;
      if (window.innerWidth < 900) {
        n.style.left = n.style.top = n.style.right = "";
      } else {
        const c = box.getBoundingClientRect();
        const r = k.getBoundingClientRect();
        n.style.right = "auto";
        n.style.left = `${r.left - c.left + r.width / 2 + 50}px`;
        n.style.top = `${r.top - c.top - 40 - n.offsetHeight}px`;
      }
      n.style.visibility = "visible";
    };
    place();
    document.fonts?.ready.then(place);
    const sizer = new ResizeObserver(place);
    sizer.observe(box);
    return () => sizer.disconnect();
  }, []);

  return (
    <div className="leak s5 ready">
      <div className="leak__stage">
        <div className="leak__chat" ref={chat}>
          <span className="leak__beam" aria-hidden="true" />
          <p className="leak__note" ref={note} aria-hidden="true">
            {L.note}
            <svg viewBox="0 0 60 50">
              <path pathLength={1} d="M58 4 C 40 10, 20 20, 6 44 M6 44 L 4 30 M6 44 L 20 40" />
            </svg>
          </p>
          {L.chat.map((line) => (
            <p key={line.who + line.text} className="leak__line in">
              <span className="leak__who">{line.who}</span> {line.text}
              {line.key && (
                <span className="leak__key" ref={key}>
                  {line.key}
                  <Ring />
                </span>
              )}
              {"after" in line ? line.after : null}
            </p>
          ))}
        </div>
        <ul className="leak__files">
          {L.files.map((f) => (
            <li key={f.name} className="leak__file in">
              <span className="leak__fileicon" aria-hidden="true">
                {f.kind === "drive" ? <DriveMark /> : f.kind === "slack" ? <SlackMark /> : f.kind === "pdf" ? <FileMark /> : <GitHubMark />}
              </span>
              <span className="leak__filename">
                {f.name} <small>{f.place}</small>
              </span>
              <code className="leak__fileline">
                {f.line}
                <span className="leak__key">{f.key}</span>
              </code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
