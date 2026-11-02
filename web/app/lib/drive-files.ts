// Plain helpers for the Google Drive tab, kept apart from the Google scripts so they can be tested in Node.

export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  // Bytes, from the picker. Google's own files (Docs, Sheets) have none until they are saved as a file.
  size?: number;
}

// Google's own files have no bytes to download, so Drive saves them as a file KinBeat reads:
// Docs as Word files, everything else (Sheets, Slides, Drawings) as PDF, so every sheet and slide is kept.
const GOOGLE_PREFIX = "application/vnd.google-apps.";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function downloadPlan(doc: DriveDoc): { url: string; name: string } {
  const id = encodeURIComponent(doc.id);
  if (!doc.mimeType.startsWith(GOOGLE_PREFIX)) return { url: `https://www.googleapis.com/drive/v3/files/${id}?alt=media`, name: doc.name };
  const asWord = doc.mimeType === `${GOOGLE_PREFIX}document`;
  const mime = asWord ? DOCX : "application/pdf";
  return { url: `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(mime)}`, name: `${doc.name}.${asWord ? "docx" : "pdf"}` };
}
