"use client";

import { useEffect, useState } from "react";
import { content } from "../content";
import { getMe } from "../lib/logs";
import { guideFor, ownerMessage } from "../lib/rotation";
import {
  confidenceLevel,
  confidenceText,
  encodingLabel,
  placeLabel,
  sourceLabel,
  typeLabel,
  verdictKind,
  type Finding,
  type VerdictKind,
} from "../lib/scan";

const R = content.right;

function VerdictTag({ kind }: { kind: VerdictKind }) {
  return (
    <span className={`verdict ${kind}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {kind === "real" && <path d="M2 2H9V7H14V14H2Z" />}
        {kind === "possible" && (
          <>
            <path d="M8 2A6 6 0 0 0 8 14Z" />
            <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </>
        )}
        {kind === "example" && <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="2" />}
        {(kind === "off" || kind === "unavailable" || kind === "validating" || kind === "timeout" || kind === "limit" || kind === "blocked") && <path d="M3 8H13" stroke="currentColor" strokeWidth="2.5" />}
      </svg>
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

function Next({ finding, scanId, scanLabel }: { finding: Finding; scanId?: string; scanLabel?: string }) {
  const [caseId, setCaseId] = useState("");
  const [note, setNote] = useState("");
  const [team, setTeam] = useState(false);
  useEffect(() => {
    getMe().then((admin) => setTeam(admin !== null));
  }, []);
  const guide = guideFor(finding.type);
  const message = ownerMessage(finding, scanLabel);

  async function track() {
    if (!scanId) return;
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ scanId, findingId: finding.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Could not open the case.");
      setCaseId(data.id);
      setNote("");
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setNote("Message copied.");
    } catch {
      setNote("Could not copy. Select the text and copy it.");
    }
  }

  return (
    <details className="saw next">
      <summary>What to do next</summary>
      <div className="saw-body">
        <p className="next-title">{guide.title}</p>
        <ol className="next-steps">
          {guide.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="next-title">Message for the owner</p>
        <pre className="slice">{message}</pre>
        <div className="next-actions">
          <button type="button" className="btn ghost" onClick={copy}>
            Copy message
          </button>
          {scanId && team && !caseId && (
            <button type="button" className="btn" onClick={track}>
              Track this finding
            </button>
          )}
          {caseId && (
            <a className="btn" href={`/logs?tab=cases&case=${caseId}`}>
              Open case {caseId}
            </a>
          )}
        </div>
        {note && (
          <p className="next-note" role="status">
            {note}
          </p>
        )}
      </div>
    </details>
  );
}

export function FindingCard({ finding, index, scanId, scanLabel }: { finding: Finding; index: number; scanId?: string; scanLabel?: string }) {
  const kind = verdictKind(finding);
  const source = sourceLabel(finding);
  const asked = kind !== "off";
  const reason = asked ? finding.judge.reason ?? finding.judge.error ?? "" : R.reasonOff;
  return (
    <article className={`finding ${kind}`} style={{ animationDelay: `${index * 90}ms` }}>
      <header>
        <h5>{typeLabel(finding)}</h5>
        <VerdictTag kind={kind} />
      </header>
      <dl className="facts">
        <div>
          <dt>{R.where}</dt>
          <dd>{placeLabel(finding.place)}</dd>
        </div>
        <div>
          <dt>{R.mask}</dt>
          <dd>
            <span className="masked">{finding.preview}</span>
          </dd>
        </div>
        <div>
          <dt>{R.hidden}</dt>
          <dd>{encodingLabel(finding)}</dd>
        </div>
        {source && (
          <div>
            <dt>{R.from}</dt>
            <dd>{source}</dd>
          </div>
        )}
        <div>
          <dt>{R.confidence}</dt>
          <dd>
            <Confidence finding={finding} />
          </dd>
        </div>
        <div className="reason">
          <dt>{R.reason}</dt>
          <dd>{reason}</dd>
        </div>
      </dl>
      <Next finding={finding} scanId={scanId} scanLabel={scanLabel} />
      <details className="saw">
        <summary>{R.saw}</summary>
        <div className="saw-body">{finding.judge.slice ? <pre className="slice">{finding.judge.slice}</pre> : <p>{finding.judge.mode === "rule" ? R.sawRule : R.sawOff}</p>}</div>
      </details>
    </article>
  );
}
