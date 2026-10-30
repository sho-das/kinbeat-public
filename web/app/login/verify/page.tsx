import type { Metadata } from "next";
import { VerifyForm } from "./VerifyForm";

export const metadata: Metadata = { title: "Sign in - KinBeat", robots: { index: false, follow: false } };

export default function VerifyPage() {
  return <VerifyForm />;
}
