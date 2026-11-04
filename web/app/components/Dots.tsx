"use client";

import { useEffect, useRef, useState } from "react";
import { content as C } from "../content";

const S = C.size;
const fmt = (n: number) => n.toLocaleString("en-US");
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// One dot for every 100,000 secrets. A faint grid of 2,865 places first, then 286 dots land on places
// picked in a fixed scattered order, once the field scrolls into view. After that, dots blink: one goes out and
// another lights up elsewhere, so there are always 286.
function DotField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const cols = 70;
    const rows = Math.ceil(S.places / cols);
    const gx = cv.width / cols;
    const gy = cv.height / rows;
    const r = Math.min(gx, gy) * 0.28;
    const at = (k: number, radius: number) => {
      ctx.beginPath();
      ctx.arc(gx * ((k % cols) + 0.5), gy * (Math.floor(k / cols) + 0.5), radius, 0, Math.PI * 2);
      ctx.fill();
    };
    const orange = getComputedStyle(cv).color;
    const dot = (k: number) => {
      ctx.fillStyle = orange;
      at(k, r);
    };
    const faint = (k: number) => {
      ctx.clearRect(gx * (k % cols), gy * Math.floor(k / cols), gx, gy);
      ctx.fillStyle = "rgba(246,241,231,.08)";
      at(k, r * 0.5);
    };
    for (let k = 0; k < S.places; k++) faint(k);
    // A seeded shuffle, so the dots land scattered but the same way on every visit.
    const order = Array.from({ length: S.places }, (_, i) => i);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = S.places - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    if (still()) {
      for (let k = 0; k < S.dots; k++) dot(order[k]);
      return;
    }
    let frame = 0;
    let blink = 0;
    // Every second a random handful of dots, 6 to 10, fade out over half a second, and the same number
    // fade in at random places. The lit count never changes.
    const lit = order.slice(0, S.dots);
    const dark = order.slice(S.dots);
    const fade = (k: number, from: number, to: number) => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / 500);
        faint(k);
        ctx.globalAlpha = from + (to - from) * p;
        dot(k);
        ctx.globalAlpha = 1;
        if (p < 1) requestAnimationFrame(tick);
        else if (to === 0) faint(k);
      };
      requestAnimationFrame(tick);
    };
    const twinkle = () => {
      const n = 6 + Math.floor(Math.random() * 5);
      for (let m = 0; m < n; m++) {
        const i = Math.floor(Math.random() * lit.length);
        const j = Math.floor(Math.random() * dark.length);
        fade(lit[i], 1, 0);
        fade(dark[j], 0, 1);
        [lit[i], dark[j]] = [dark[j], lit[i]];
      }
    };
    const watcher = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      watcher.disconnect();
      let n = 0;
      const per = Math.ceil(S.dots / 90);
      const step = () => {
        for (let m = 0; m < per && n < S.dots; m++) dot(order[n++]);
        if (n < S.dots) frame = requestAnimationFrame(step);
        else blink = window.setInterval(twinkle, 1000);
      };
      step();
    }, { threshold: 0.35 });
    watcher.observe(cv);
    return () => {
      watcher.disconnect();
      cancelAnimationFrame(frame);
      window.clearInterval(blink);
    };
  }, []);

  return <canvas ref={canvas} width={2400} height={1400} role="img" aria-label={`${fmt(S.dots)} dots. ${S.title}`} />;
}

// The dot field, the site's live numbers beside it, and the report numbers under both.
export function SizeSection() {
  // Scans started and sessions since launch, from the server. Loading the page counts this visit.
  const [live, setLive] = useState<{ scans: number; sessions: number } | null>(null);
  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.scans === "number" && typeof data.sessions === "number") setLive(data);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="sizesec" id="size" aria-labelledby="size-h">
      <div className="wrap">
        <h2 className="sizesec__title" id="size-h">
          <b>{fmt(S.yearTotal)}</b> {S.yearLine}
        </h2>
        <div className="livecount">
          <div>
            <p className="sizesec__sub">{S.title}</p>
            <div className="dotfield">
              <DotField />
            </div>
          </div>
          <div className="livecount__card" aria-live="off">
            <p className="livecount__head">
              <span className="livecount__live" aria-hidden="true" />
              {S.sinceTitle}
            </p>
            <span className="livecount__tick">{fmt(S.scansBase + (live?.scans ?? 0))}</span>
            <p>
              {S.sinceText.split("{sessions}")[0]}
              <b>{live ? fmt(live.sessions) : "0"}</b>
              {S.sinceText.split("{sessions}")[1]}
            </p>
          </div>
        </div>
        <div className="facts3">
          {C.proof.map((p) => (
            <div key={p.figure}>
              <b>{p.figure}</b>
              <p>{p.text}</p>
              <small className="sizesec__src">
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.source}
                </a>
              </small>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
