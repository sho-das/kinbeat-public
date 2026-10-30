"use client";

import { useState } from "react";
import { content } from "../content";
import {
  confidenceLevel,
  confidenceText,
  encodingLabel,
  placeLabel,
  typeLabel,
  verdictKind,
  type Finding,
  type VerdictKind,
} from "../lib/scan";

const R = content.right;

function VerdictTag({ kind }: { kind: keyof typeof R.verdict }) {
  return (
    <span className={`verdict ${kind}`}>
      <span>{R.verdict[kind]}</span>
    </span>
  );
}

function Confidence({ finding }: { finding: Finding }) {
  const level = confidenceLevel(finding);
  return (
    <span className="conf">
      <svg viewBox="0 0 36 24" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const h = 8 + i * 8;
          return <rect key={i} x={i * 13 + 1} y={23 - h} width={9} height={h - 1} rx={1} className={i < level ? "on" : "off"} />;
        })}
      </svg>
      <span>{confidenceText(finding)}</span>
    </span>
  );
}

export function FindingCard({ finding, index }: { finding: Finding; index: number; scanId?: string; scanLabel?: string }) {
  const kind = verdictKind(finding);
  const asked = kind !== "off";
  const reason = asked ? finding.judge.reason ?? finding.judge.error ?? "" : R.reasonOff;
  const [open, setOpen] = useState(true);
  const [showLine, setShowLine] = useState(false);
  const tag = kind === "timeout" || kind === "limit" || kind === "blocked";
  return (
    <article className={`finding ${kind}`} style={{ animationDelay: `${index * 90}ms` }}>
      {(finding.type !== "generic_secret" || tag) && (
        <header>
          {finding.type !== "generic_secret" && <h5>{typeLabel(finding)}</h5>}
          {tag && <VerdictTag kind={kind} />}
        </header>
      )}
      <button type="button" className="linkbtn finding__toggle" aria-expanded={open} aria-label={open ? R.closeFinding : R.openFinding} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 8l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {!open && (
        <p className="finding__brief">
          <b>{R.file}:</b> {placeLabel(finding.place)}
        </p>
      )}
      {open && (
        <>
      <dl className="facts">
        <div>
          <dt>{R.where}</dt>
          <dd>{placeLabel(finding.place)}</dd>
        </div>
        <div>
          <dt>{R.confidence}</dt>
          <dd>
            <Confidence finding={finding} />
          </dd>
        </div>
        <div className="reason">
          <dt>{R.reason}</dt>
          <dd>
            {[finding.encoding === "plain" ? "" : `${R.hiddenAs} ${encodingLabel(finding).toLowerCase()}.`, finding.found, reason].filter(Boolean).join(" ")}
            {finding.line && (
              <>
                {" "}
                <button type="button" className="linkbtn" aria-expanded={showLine} onClick={() => setShowLine(!showLine)}>
                  {showLine ? R.hideLine : R.seeLine}
                </button>
                {showLine && (
                  <pre className="slice">
                    {finding.line.before}
                    <mark>{finding.line.mark}</mark>
                    {finding.line.after}
                  </pre>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>
        </>
      )}
    </article>
  );
}
