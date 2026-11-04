import type { Metadata } from "next";
import { Legal, type LegalSection } from "../components/Legal";

export const metadata: Metadata = { title: "Privacy Policy - KinBeat", alternates: { canonical: "/privacy" } };

const sections: LegalSection[] = [
  {
    title: "Who we are",
    body: [
      'KinBeat ("we", "us") is operated by Soumya Das, an individual based in the United Kingdom, who is the data controller for the personal data described in this policy. For anything about your data, write to contact@kinbeat.com.',
    ],
  },
  {
    title: "What this policy covers",
    body: [
      "KinBeat is a website that finds exposed keys, tokens and passwords in text, files, websites, GitHub repositories, Google Drive files and Slack chats that you choose to scan. This policy explains what we see, what we keep and what we do not keep.",
    ],
  },
  {
    title: "What we do not keep",
    body: ["We never store your pasted text, your uploaded files, your chats or the secrets we find. They are read once for the scan and then dropped."],
  },
  {
    title: "What we keep",
    body: [
      [
        "A record of each scan: the time, the kind of scan (text, file, link, Drive, Slack), the size, how long it took, and the result with every secret masked. We keep this for 30 days to watch the service and to improve the checks.",
        "A record of each Ask AI question and its answer, without any pasted text or secrets, so we can see what the AI got wrong.",
        "The message you send through the contact form: your name, email, topic and message. We keep it until we have answered it.",
        "A random visitor number in your browser, used only to apply daily limits. It is not linked to your name.",
      ],
    ],
  },
  {
    title: "Tokens you paste",
    body: ["If you paste a read-only GitHub token to scan a private repository, it is used for that scan only, sent over an encrypted connection, and never stored or logged."],
  },
  {
    title: "Who else sees your data",
    body: [
      [
        "Meta's Muse Spark Open model, served on Modal, judges each finding. It receives a masked copy of the text, with the secret hidden. Pictures and scanned pages are sent whole, because nothing can be masked before they are read.",
        "Google and Slack see only what you connect through their own sign-in screens. KinBeat asks for read-only access and keeps no copy.",
        "Our hosting providers run the servers. We do not sell your data and we do not share it with advertisers.",
      ],
    ],
  },
  {
    title: "Cookies",
    body: ["KinBeat sets no tracking cookies. The admin pages set one sign-in cookie for staff only."],
  },
  {
    title: "Your rights",
    body: [
      "You can ask to see, correct or delete anything we hold about you, or complain to the UK Information Commissioner's Office at ico.org.uk. Email contact@kinbeat.com and we reply within 30 days.",
    ],
  },
  { title: "Changes", body: ["If this policy changes, the date at the top changes with it."] },
];

export default function PrivacyPage() {
  return <Legal title="KinBeat Privacy Policy" effective="4 November 2026" sections={sections} />;
}
