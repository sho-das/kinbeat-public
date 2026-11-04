"use client";

import { Wordmark } from "../../components/Wordmark";

import { useEffect, useState } from "react";
import { LogsError, verifyLink } from "../../lib/logs";

export function VerifyForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const found = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? "";
    if (!found) return;
    setToken(found);
    history.replaceState(null, "", window.location.pathname);
  }, []);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await verifyLink(token);
      window.location.replace("/logs");
    } catch (err) {
      setError(err instanceof LogsError ? err.message : "Could not sign in.");
      setBusy(false);
    }
  }

  return (
    <div className="dash">
      <main className="dash-main dash-gate">
        <a className="brand" href="/" aria-label="KinBeat, home">
          <Wordmark />
        </a>
        <h1>Sign in</h1>
        {token ? (
          <>
            <p className="dash-note">Press the button to finish signing in.</p>
            <button className="btn" type="button" onClick={signIn} disabled={busy}>
              {busy ? "Signing in" : "Sign in"}
            </button>
          </>
        ) : (
          <p className="dash-note">
            This link is missing its code. <a href="/login">Ask for a new link.</a>
          </p>
        )}
        {error && (
          <p className="err" role="alert">
            {error} <a href="/login">Ask for a new link.</a>
          </p>
        )}
      </main>
    </div>
  );
}
