"use client";

import { useState } from "react";
import { content } from "../content";
import { Leak } from "./Leak";

const T = content.contact;

// The contact form at the end of the page. The message goes to the server, which keeps it for the team's logs page.
export function Contact() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState("");

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setState("sending");
    setError("");
    try {
      const response = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(typeof body?.message === "string" ? body.message : T.failed);
        setState("failed");
        return;
      }
      form.reset();
      setState("sent");
    } catch {
      setError(T.failed);
      setState("failed");
    }
  }

  return (
    <section className="section contact" id="contact" aria-labelledby="contact-h">
      {/* The form on the left, the story card on the right on wide screens; stacked on phones. */}
      <div className="wrap faq__grid">
        <div>
          <h2 className="big" id="contact-h">
            {T.title}
          </h2>
          <p className="contact__lead">{T.lead}</p>
          <form className="contact__form" onSubmit={send}>
            <label className="field">
              <span className="lbl">{T.name}</span>
              <input name="name" type="text" maxLength={120} autoComplete="name" />
            </label>
            <label className="field">
              <span className="lbl">{T.email}</span>
              <input name="email" type="email" required maxLength={200} autoComplete="email" />
            </label>
            <label className="field contact__message">
              <span className="lbl">{T.message}</span>
              <textarea name="message" required maxLength={2000} rows={5} />
            </label>
            <div className="contact__actions">
              <button className="btn" type="submit" disabled={state === "sending"}>
                {state === "sending" ? T.sending : T.send}
              </button>
              {state === "sent" && (
                <p className="contact__note" role="status">
                  {T.thanks}
                </p>
              )}
              {state === "failed" && (
                <p className="contact__note err" role="alert">
                  {error}
                </p>
              )}
            </div>
          </form>
        </div>
        <aside className="leak-section" aria-label="Example of exposed keys">
          <Leak />
        </aside>
      </div>
    </section>
  );
}
