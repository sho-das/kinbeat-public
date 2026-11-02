import { test } from "node:test";
import assert from "node:assert/strict";
import { downloadPlan } from "./drive-files.ts";

test("downloads a normal file as it is", () => {
  const plan = downloadPlan({ id: "abc", name: "notes.txt", mimeType: "text/plain" });
  assert.equal(plan.url, "https://www.googleapis.com/drive/v3/files/abc?alt=media");
  assert.equal(plan.name, "notes.txt");
});

test("saves a Google Doc as a Word file", () => {
  const plan = downloadPlan({ id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document" });
  assert.match(plan.url, /\/files\/d1\/export\?mimeType=application%2Fvnd\.openxmlformats-officedocument\.wordprocessingml\.document$/);
  assert.equal(plan.name, "Plan.docx");
});

test("saves Google Sheets and Slides as PDF", () => {
  for (const kind of ["spreadsheet", "presentation"]) {
    const plan = downloadPlan({ id: "x", name: "Deck", mimeType: `application/vnd.google-apps.${kind}` });
    assert.match(plan.url, /export\?mimeType=application%2Fpdf$/);
    assert.equal(plan.name, "Deck.pdf");
  }
});

test("escapes the file id in the address", () => {
  assert.match(downloadPlan({ id: "a/b?c", name: "f", mimeType: "text/plain" }).url, /files\/a%2Fb%3Fc\?alt=media$/);
});
