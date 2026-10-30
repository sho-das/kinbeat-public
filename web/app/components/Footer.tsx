import { content as C } from "../content";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="foot dark">
      <div className="wrap">
        <div className="row">
          <Wordmark />
        </div>
        <p className="contact" id="contact">
          Questions or a bigger scan? <a href={`mailto:${C.contactEmail}`}>Contact us</a>
        </p>
        <p className="note">{C.draft}</p>
      </div>
    </footer>
  );
}
