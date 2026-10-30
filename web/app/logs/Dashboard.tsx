"use client";

import { useEffect, useState } from "react";
import { getMe, signOut } from "../lib/logs";
import { Audit } from "./tabs/Audit";
import { Cases } from "./tabs/Cases";
import { Checks } from "./tabs/Checks";
import { Evals } from "./tabs/Evals";
import { Scans } from "./tabs/Scans";

type Tab = "scans" | "cases" | "checks" | "evals" | "audit";

export function Dashboard() {
  const [gate, setGate] = useState<"checking" | "open" | "signin">("checking");
  const [email, setEmail] = useState("");

  useEffect(() => {
    getMe().then((admin) => {
      if (admin) {
        setEmail(admin.email);
        setGate("open");
      } else {
        setGate("signin");
      }
    });
  }, []);

  if (gate === "checking") return <div className="dash" />;
  if (gate === "signin") {
    return (
      <div className="dash">
        <main className="dash-main dash-gate">
          <h1>Logs</h1>
          <p className="dash-note">This page is for the team. Sign in to see it.</p>
          <a className="btn" href="/login">
            Sign in
          </a>
        </main>
      </div>
    );
  }
  return <Board email={email} />;
}

function Board({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>("scans");
  const [focusCase, setFocusCase] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "cases") setTab("cases");
    setFocusCase(params.get("case") ?? "");
  }, []);

  return (
    <div className="dash">
      <header className="dash-top">
        <a className="brand" href="/" aria-label="KinBeat, home">
          <span>KinBeat</span>
        </a>
        <h1>Logs</h1>
        <span className="dash-user">{email}</span>
        <button
          type="button"
          className="btn ghost dash-out"
          onClick={async () => {
            await signOut();
            window.location.replace("/login");
          }}
        >
          Sign out
        </button>
        <div className="dash-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "scans"} onClick={() => setTab("scans")}>
            Scans
          </button>
          <button role="tab" aria-selected={tab === "cases"} onClick={() => setTab("cases")}>
            Closure record
          </button>
          <button role="tab" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>
            Checks
          </button>
          <button role="tab" aria-selected={tab === "evals"} onClick={() => setTab("evals")}>
            Eval runs
          </button>
          <button role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")}>
            Audit
          </button>
        </div>
      </header>
      <main className="dash-main">{tab === "scans" ? <Scans /> : tab === "cases" ? <Cases focus={focusCase} /> : tab === "checks" ? <Checks /> : tab === "audit" ? <Audit /> : <Evals />}</main>
    </div>
  );
}
