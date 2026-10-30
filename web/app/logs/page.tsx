import type { Metadata } from "next";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = { title: "Logs - KinBeat", robots: { index: false, follow: false } };

export default function LogsPage() {
  return <Dashboard />;
}
