import { content as C } from "../content";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="foot dark">
      <div className="wrap">
        {/* One line on desktop: wordmark, the two legal links, the copyright. On a phone the three stack. */}
        <div className="foot__line">
          <a className="foot__brand" href="/" aria-label="KinBeat, home">
            <Wordmark tone="white" />
          </a>
          <p className="legal-links">
            <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a>
          </p>
          <p className="note">{C.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
