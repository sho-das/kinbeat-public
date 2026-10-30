import type { Finding } from "./scan";
import { placeLabel, typeLabel } from "./scan";

interface Guide {
  title: string;
  steps: string[];
}

const CHECK = "Look for use you did not expect: sign-in or audit logs from the time it was exposed.";
const NEVER = "Do not test the old secret to see if it still works. Revoke it first.";

const GUIDES: Record<string, Guide> = {
  aws_key: {
    title: "Rotate a cloud access key",
    steps: [
      "Open the cloud console, go to the user's access keys, and make the exposed key inactive.",
      "Create a new access key for the same user.",
      "Put the new key into every app and pipeline that used the old one.",
      "Delete the old key once nothing uses it.",
      CHECK,
      NEVER,
    ],
  },
  github_token: {
    title: "Revoke and replace an access token",
    steps: [
      "Open the token list in your account settings and revoke the exposed token.",
      "Create a new token with only the permissions it needs, and a short expiry.",
      "Update every script or app that used the old token.",
      "Review the security log of the account for actions you do not recognise.",
      NEVER,
    ],
  },
  slack_token: {
    title: "Revoke and replace a chat token",
    steps: [
      "Open the app's settings in the Slack developer site and revoke the exposed token, or reinstall the app to issue a new one.",
      "Update every service that used the old token.",
      "Check the workspace audit log or the app's activity for use you do not recognise.",
      NEVER,
    ],
  },
  jwt: {
    title: "Invalidate a login token",
    steps: [
      "A login token (JWT) cannot be cancelled by itself. End the session it belongs to, or add it to your deny list.",
      "If the signing key may also be exposed, rotate the signing key. This signs everyone out.",
      "Shorten the token lifetime so a leak ends sooner.",
      CHECK,
    ],
  },
  private_key: {
    title: "Replace a private key",
    steps: [
      "Treat the key as stolen. Generate a new key pair.",
      "Remove the old public key everywhere it is trusted: servers, cloud accounts, code hosting.",
      "If it was a certificate key, have the certificate reissued and revoke the old one.",
      "Delete the exposed private key from chats, tickets and shared drives.",
      CHECK,
    ],
  },
  generic_secret: {
    title: "Change an exposed password or secret",
    steps: [
      "Change the password or secret at the service that uses it.",
      "End active sessions and turn on two-step sign-in if the service has it.",
      "Update every place that stores the new value. Use a password manager or a secrets store, not chat.",
      "Check the account's sign-in history for use you do not recognise.",
    ],
  },
};

export function guideFor(type: string): Guide {
  return GUIDES[type] ?? GUIDES.generic_secret;
}

export function ownerMessage(finding: Finding, scanLabel?: string): string {
  const where = scanLabel ? `${placeLabel(finding.place)} (${scanLabel})` : placeLabel(finding.place);
  const guide = guideFor(finding.type);
  return [
    "Hi,",
    "",
    `A scan found a secret that looks like it is exposed: ${typeLabel(finding).toLowerCase()}, shown as ${finding.preview}.`,
    `Where: ${where}.`,
    "",
    "Please do these steps today:",
    ...guide.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "Reply when it is done so we can close the case.",
  ].join("\n");
}
