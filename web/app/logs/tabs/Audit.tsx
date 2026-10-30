"use client";

import { useEffect, useState } from "react";
import { getJson, when, type AuditRow } from "../../lib/logs";

const ACTION_LABELS: Record<string, string> = {
  login_requested: "Asked for a sign-in link",
  login_ok: "Signed in",
  login_failed: "Sign-in failed",
  logout: "Signed out",
  case_opened: "Opened a case",
  case_updated: "Changed a case",
};

function detailText(row: AuditRow): string {
  const d = row.detail;
  const parts: string[] = [];
  if (typeof d.status === "string") parts.push(`status ${d.status}`);
  if (d.ownerChanged === true) parts.push("owner changed");
  if (d.noteAdded === true) parts.push("note added");
  if (typeof d.type === "string") parts.push(String(d.type));
  if (typeof d.reason === "string") parts.push(d.reason.replace(/_/g, " "));
  if (typeof d.caseId === "string") parts.push(`case ${d.caseId.slice(0, 8)}`);
  return parts.join(", ");
}

export function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getJson<AuditRow[]>("/api/logs/audit?limit=200")
      .then((r) => {
        setRows(r);
        setError("");
      })
      .catch(() => setError("Could not load the audit log."));
  }, []);

  return (
    <>
      <p className="dash-note">Sign-ins and changes by admins, newest first. It holds no notes, secrets or link tokens, and it can only be added to.</p>
      {error && <p className="err">{error}</p>}
      {!error && rows.length === 0 && <p className="dash-note">Nothing recorded yet.</p>}
      {rows.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Who</th>
                <th>What</th>
                <th>Details</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.at)}</td>
                  <td>{r.adminEmail ?? "-"}</td>
                  <td>{ACTION_LABELS[r.action] ?? r.action}</td>
                  <td className="dash-what">{detailText(r)}</td>
                  <td className="mono">{r.ip ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
