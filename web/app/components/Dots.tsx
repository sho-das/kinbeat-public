"use client";

import { useEffect, useRef, useState } from "react";
import { content as C } from "../content";

const S = C.size;
const fmt = (n: number) => n.toLocaleString("en-US");
const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// One dot for every 100,000 secrets. A faint grid of 2,865 places first, then 286 dots land on places
// picked in a fixed scattered order, once the field scrolls into view.
function DotField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const cols = 90;
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
    ctx.fillStyle = "rgba(246,241,231,.08)";
    for (let k = 0; k < S.places; k++) at(k, r * 0.5);
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
    const watcher = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      watcher.disconnect();
      let n = 0;
      const per = Math.ceil(S.dots / 90);
      const step = () => {
        for (let m = 0; m < per && n < S.dots; m++) dot(order[n++]);
        if (n < S.dots) frame = requestAnimationFrame(step);
      };
      step();
    }, { threshold: 0.35 });
    watcher.observe(cv);
    return () => {
      watcher.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvas} width={2400} height={860} role="img" aria-label={`${fmt(S.dots)} dots. ${S.title}`} />;
}

// The dot field, a live count beside it (the 2025 total spread evenly over the year's seconds), and the report numbers under both.
export function SizeSection() {
  const [since, setSince] = useState(0);
  useEffect(() => {
    const perSecond = S.yearTotal / (365 * 24 * 60 * 60);
    const start = Date.now();
    const t = window.setInterval(() => setSince(Math.floor(((Date.now() - start) / 1000) * perSecond)), still() ? 5000 : 250);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="sizesec" id="size" aria-labelledby="size-h">
      <div className="wrap">
        <h2 className="sizesec__title" id="size-h">
          {fmt(S.yearTotal)}
        </h2>
        <p className="sizesec__sub">{S.title}</p>
        <div className="livecount">
          <div className="dotfield">
            <DotField />
          </div>
          <div className="livecount__card" aria-live="off">
            <p>{S.sinceTitle}</p>
            <span className="livecount__tick">{fmt(since)}</span>
            <p>{S.sinceText}</p>
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
