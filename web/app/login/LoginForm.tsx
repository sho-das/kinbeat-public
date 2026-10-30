"use client";

import { useState } from "react";
import { LogsError, requestLink } from "../lib/logs";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      await requestLink(email.trim());
      setState("sent");
    } catch (err) {
      setError(err instanceof LogsError ? err.message : "Could not send the link. Try again.");
      setState("idle");
    }
  }

  return (
    <div className="dash">
      <main className="dash-main dash-gate">
        <a className="brand" href="/" aria-label="KinBeat, home">
          <span>KinBeat</span>
        </a>
        <h1>Sign in</h1>
        {state === "sent" ? (
          <p className="dash-note" role="status">
            If that email belongs to an admin, a sign-in link is on its way. It works once and expires in 10 minutes. Open it in this same browser.
          </p>
        ) : (
          <form onSubmit={submit}>
            <p className="dash-note">This page is for the team. We email you a link, so there is no password.</p>
            <label className="lbl" htmlFor="login-email">
              Email
            </label>
            <input id="login-email" type="email" className="case-input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            {error && (
              <p className="err" role="alert">
                {error}
              </p>
            )}
            <button className="btn" type="submit" disabled={!email || state === "sending"}>
              {state === "sending" ? "Sending" : "Send me a link"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
