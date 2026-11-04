import type { Metadata } from "next";
import { Legal, type LegalSection } from "../components/Legal";

export const metadata: Metadata = { title: "Terms of Service - KinBeat", alternates: { canonical: "/terms" } };

const sections: LegalSection[] = [
  {
    title: "Who we are",
    body: [
      "By using KinBeat you agree to these terms. If you do not agree, please do not use it.",
      "KinBeat is operated by Soumya Das, an individual based in the United Kingdom. Contact: contact@kinbeat.com.",
    ],
  },
  {
    title: "What KinBeat does",
    body: [
      "KinBeat scans content you choose - text, files, websites, public and private GitHub repositories, Google Drive files and Slack chats - and reports keys, tokens and passwords that look exposed. An AI model judges whether each finding is real, possible or an example.",
    ],
  },
  {
    title: "What KinBeat does not promise",
    body: [
      [
        "It can miss secrets and it can flag things that are not secrets.",
        "It is not a security audit and not legal advice. You stay responsible for rotating any key it finds and for the security of your systems.",
      ],
    ],
  },
  {
    title: "What you may scan",
    body: [
      "Only scan content you own or have clear permission to scan. Do not use KinBeat to look for secrets in other people's repositories, files or chats without their consent. Do not try to overload, attack or reverse-engineer the service. We may block visitors who break these rules.",
    ],
  },
  {
    title: "Tokens and connected accounts",
    body: [
      "A GitHub token you paste should be read-only and is used for one scan only. Google Drive and Slack access is read-only and you can revoke it from your Google or Slack settings at any time.",
    ],
  },
  { title: "Your data", body: ["How we handle your data is explained in the Privacy Policy."] },
  {
    title: "Liability",
    body: [
      'To the extent the law allows, KinBeat is provided "as is" and we are not liable for any loss that comes from relying on a scan result, including secrets that were missed or keys that were not rotated.',
    ],
  },
  { title: "Governing law", body: ["These terms are governed by the law of England and Wales."] },
  { title: "Changes", body: ["If these terms change, the date at the top changes with it."] },
];

export default function TermsPage() {
  return <Legal title="KinBeat Terms of Service" effective="4 November 2026" sections={sections} />;
}
