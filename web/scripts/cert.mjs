// Makes a local test certificate, so the dev site runs on https://localhost:3001. Slack sends people back only to https addresses.
// The browser warns once, because this computer made the certificate. It is made again when missing or close to its end.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DAYS = 365;
const dir = fileURLToPath(new URL("../certificates/", import.meta.url));
const cert = `${dir}localhost.pem`;
const old = existsSync(cert) && Date.now() - statSync(cert).mtimeMs > (DAYS - 7) * 24 * 60 * 60 * 1000;
if (!existsSync(cert) || old) {
  mkdirSync(dir, { recursive: true });
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", String(DAYS), "-keyout", `${dir}localhost-key.pem`, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  } catch {
    console.error("Could not make a local certificate: install openssl, then run npm run dev again.");
    process.exit(1);
  }
}
