import { downloadPlan, type DriveDoc } from "./drive-files";
import { fileProblem, MAX_FILE_BYTES } from "./scan";

// Google Drive: the visitor signs in with Google, picks one file in Google's own picker, and this browser
// downloads it for the normal file scan, up to 10 MB. The Google sign-in never reaches our server.
// drive.file lets KinBeat open only the files the visitor picks, nothing else in their Drive.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
// The Google Cloud project number. The picker needs it so the picked files can be opened with drive.file.
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const driveReady = Boolean(CLIENT_ID && API_KEY && APP_ID);

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let wait = loaded.get(src);
  if (!wait) {
    wait = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.onload = () => resolve();
      tag.onerror = () => {
        loaded.delete(src);
        reject(new Error("Google Drive could not be loaded. Try again."));
      };
      document.head.appendChild(tag);
    });
    loaded.set(src, wait);
  }
  return wait;
}

// Asks Google for a short-lived access token. Google shows its own sign-in and consent window.
async function signIn(): Promise<string> {
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (answer: { access_token?: string; error?: string }) => (answer.access_token ? resolve(answer.access_token) : reject(new Error("Google sign-in did not finish."))),
      error_callback: () => reject(new Error("Google sign-in did not finish.")),
    });
    client.requestAccessToken();
  });
}

async function openPicker(token: string): Promise<DriveDoc | null> {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise<void>((resolve) => window.gapi.load("picker", { callback: () => resolve() }));
  const picker = window.google.picker;
  // Google focuses the picker at the page's end, which scrolls the page down. Hold the page still while it is open.
  const y = window.scrollY;
  const root = document.documentElement;
  const hold = () => window.scrollTo({ top: y, behavior: "instant" });
  const release = () => {
    window.removeEventListener("scroll", hold);
    root.style.overflow = "";
    hold();
  };
  root.style.overflow = "hidden";
  window.addEventListener("scroll", hold);
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setCallback((data: any) => {
        // Every answer except "loaded" ends the picker, an error included, so the page can always scroll again.
        if (data.action === picker.Action.LOADED) return;
        release();
        const d = data.docs?.[0];
        resolve(data.action === picker.Action.PICKED && d ? { id: d.id, name: d.name, mimeType: d.mimeType, ...(d.sizeBytes ? { size: Number(d.sizeBytes) } : {}) } : null);
      })
      .build()
      .setVisible(true);
  });
}

// Cancels Google's access as soon as the file is no longer needed, instead of letting it run for its hour.
export function revokeDrive(token: string): void {
  if (token) window.google?.accounts?.oauth2?.revoke(token, () => {});
}

// Signs in and shows the picker. No file means the visitor closed the picker.
export async function pickDriveFile(): Promise<{ token: string; doc: DriveDoc | null }> {
  const token = await signIn();
  return { token, doc: await openPicker(token) };
}

// Downloads the picked file in this browser, for the same scan as an uploaded file.
export async function driveFile(token: string, doc: DriveDoc, signal: AbortSignal): Promise<File> {
  // A file the picker already says is too big is not downloaded at all.
  if (doc.size && doc.size > MAX_FILE_BYTES) throw new Error(`${doc.name} is larger than 10 MB.`);
  const plan = downloadPlan(doc);
  const res = await fetch(plan.url, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) throw new Error(`${doc.name} could not be downloaded from Google Drive (${res.status}).`);
  const data = await res.blob();
  const file = new File([data], plan.name, { type: data.type });
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  return file;
}
