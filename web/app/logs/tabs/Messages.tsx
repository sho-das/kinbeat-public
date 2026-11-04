"use client";

import { useEffect, useState } from "react";
import { getJson, when } from "../../lib/logs";

type Row = { at: string; name: string; email: string; topic: string; message: string };
const TOPICS: Record<string, string> = { "not-working": "Something is not working", "scan-github": "Scan my GitHub repositories", other: "Something else" };

// Messages from the contact form on the home page, newest first.
export function Messages() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<Row[]>("/api/contact")
      .then((r) => {
        setRows(r);
        setError("");
      })
      .catch(() => setError("Could not load the messages."));
  }, []);

  return (
    <section>
      <h2>Messages</h2>
      {error && <p className="err">{error}</p>}
      {!error && rows.length === 0 && <p className="dash-note">No messages yet.</p>}
      {rows.length > 0 && (
        <table className="dash-table">
          <thead>
            <tr>
              <th>When</th>
              <th>From</th>
              <th>About</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{when(r.at)}</td>
                <td>
                  {r.name ? `${r.name} ` : ""}
                  <a href={`mailto:${r.email}`}>{r.email}</a>
                </td>
                <td>{TOPICS[r.topic] ?? r.topic}</td>
                <td style={{ whiteSpace: "pre-wrap" }}>{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
