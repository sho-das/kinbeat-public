"use client";

import { useEffect, useState } from "react";
import { content } from "../content";

const D = content.demo;

export function Demo() {
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setStage((s) => (s + 1) % 3), 3200);
    return () => clearInterval(timer);
  }, [playing]);

  function pick(i: number) {
    setPlaying(false);
    setStage(i);
  }

  return (
    <div className="demo">
      <ol className="demo-steps">
        {D.steps.map((s, i) => (
          <li key={s.title}>
            <button type="button" className="demo-step" aria-current={stage === i ? "step" : undefined} onClick={() => pick(i)}>
              <span className="n">0{i + 1}</span>
              <span className="demo-step-text">
                <b>{s.title}</b>
                <span>{s.text}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="demo-stage">
        <div className="demo-bar">
          <span className="chip mono">{D.illustration}</span>
          <button type="button" className="demo-play" onClick={() => setPlaying((p) => !p)}>
            {playing ? D.pause : D.play}
          </button>
        </div>
        <div key={stage} className={`demo-screen s${stage}`} role="img" aria-label={`${D.illustration}: ${D.steps[stage].title}. ${D.steps[stage].text}`}>
          {stage < 2 && (
            <>
              <p className="demo-label">{D.sourcesTitle}</p>
              <ul className="demo-sources">
                {D.sources.map((src, i) => (
                  <li key={src.label} className={`demo-source${src.ready ? " ready" : " later"}`} style={{ animationDelay: `${i * 220}ms` }}>
                    <span>{src.label}</span>
                    {!src.ready && <small>{D.notBuilt}</small>}
                  </li>
                ))}
              </ul>
              <div className={`demo-text${stage === 1 ? " scanning" : ""}`}>
                {D.chat.map((l, i) => (
                  <span className="demo-line" style={{ animationDelay: `${i * 300}ms` }} key={l}>
                    {l}
                  </span>
                ))}
              </div>
              <div className="demo-file">
                <span className="demo-file-name">{D.file}</span>
                <span>{D.fileMeta}</span>
              </div>
              <div className="demo-foot">
                {stage === 1 ? <span className="demo-reading">{D.reading}</span> : <span />}
                <span className={`btn demo-btn${stage === 1 ? " pressed" : ""}`}>{D.scanButton}</span>
              </div>
            </>
          )}
          {stage === 2 && (
            <div className="demo-result">
              <p className="demo-count">{D.foundCount}</p>
              <div className="finding real demo-card">
                <header>
                  <h5>{D.foundType}</h5>
                  <span className="verdict real">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M2 2H9V7H14V14H2Z" />
                    </svg>
                    <span>{D.foundVerdict}</span>
                  </span>
                </header>
                <span className="masked">{D.foundMask}</span>
                <p className="demo-saw">{D.saw}</p>
                <pre className="slice">{D.slice}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
