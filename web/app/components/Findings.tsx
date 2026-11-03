"use client";

import { useState } from "react";
import { content } from "../content";
import {
  encodingLabel,
  githubLineUrl,
  placeLabel,
  typeLabel,
  verdictKind,
  type Finding,
} from "../lib/scan";

const R = content.right;

// An inclined arrow that opens the line on GitHub, in a new tab. The line is highlighted there.
function GithubLink({ url }: { url: string }) {
  return (
    <a className="ghlink" href={url} target="_blank" rel="noopener noreferrer" aria-label={R.openOnGithub} title={R.openOnGithub}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17L17 7M8 7h9v9" />
      </svg>
    </a>
  );
}

function VerdictTag({ kind }: { kind: keyof typeof R.verdict }) {
  return (
    <span className={`verdict ${kind}`}>
      <span>{R.verdict[kind]}</span>
    </span>
  );
}

export function FindingCard({ finding, index, repo }: { finding: Finding; index: number; repo?: { owner: string; repo: string; sha: string } }) {
  const githubUrl = githubLineUrl(repo, finding.place);
  const kind = verdictKind(finding);
  const asked = kind !== "off";
  const reason = asked ? finding.judge.reason || "" : R.reasonOff;
  // A reason that asks the visitor to check by hand links straight to that line, when we know it.
  const checkLink = githubUrl && /Please check/.test(reason) ? githubUrl : null;
  const [open, setOpen] = useState(true);
  const [showLine, setShowLine] = useState(false);
  const tag = kind === "timeout" || kind === "limit";
  return (
    <article className={`finding ${kind}`} style={{ animationDelay: `${index * 90}ms` }}>
      <header>
        <h5>{typeLabel(finding)}</h5>
        {tag && <VerdictTag kind={kind} />}
      </header>
      <button type="button" className="linkbtn finding__toggle" aria-expanded={open} aria-label={open ? R.closeFinding : R.openFinding} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M5 8l7 8 7-8" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {!open && (
        <p className="finding__brief">
          <b>{R.file}:</b> {placeLabel(finding.place)}
          {githubUrl && <GithubLink url={githubUrl} />}
        </p>
      )}
      {open && (
        <>
      <dl className="facts">
        <div>
          <dt>{R.where}</dt>
          <dd>
            {placeLabel(finding.place)}
            {githubUrl && <GithubLink url={githubUrl} />}
          </dd>
        </div>
        <div className="reason">
          <dt>{R.reason}</dt>
          <dd>
            {[finding.encoding === "plain" ? "" : `${R.hiddenAs} ${encodingLabel(finding).toLowerCase()}.`, finding.found, reason].filter(Boolean).join(" ")}
            {checkLink && <GithubLink url={checkLink} />}
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
                    {finding.line.more?.map((m, i) => (
                      <span key={i}>
                        {"\n"}
                        {m.before}
                        <mark>{m.mark}</mark>
                        {m.after}
                      </span>
                    ))}
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
