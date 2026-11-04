import { Footer } from "./Footer";
import { Nav } from "./Nav";

export interface LegalSection {
  title: string;
  // Each entry is one paragraph, or a list of bullet lines.
  body: (string | string[])[];
}

// The email address and the two page names are written as text in the sections; this turns them into links.
const LINKS: Array<[string, string]> = [
  ["contact@kinbeat.com", "mailto:contact@kinbeat.com"],
  ["Privacy Policy", "/privacy"],
  ["Terms of Service", "/terms"],
];
function withMail(text: string) {
  const pattern = new RegExp(`(${LINKS.map(([word]) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return text.split(pattern).map((part, i) => {
    const link = LINKS.find(([word]) => word === part);
    return link ? (
      <a key={i} href={link[1]}>
        {part}
      </a>
    ) : (
      part
    );
  });
}

export function Legal({ title, effective, sections }: { title: string; effective: string; sections: LegalSection[] }) {
  return (
    <div className="night">
      <Nav home={false} />
      <main className="wrap legal">
        <h1>{title}</h1>
        <p className="legal__date">Effective: {effective}</p>
        {sections.map((s, i) => (
          <section key={s.title}>
            <h2>
              {i + 1}. {s.title}
            </h2>
            {s.body.map((b, j) =>
              Array.isArray(b) ? (
                <ul key={j}>
                  {b.map((line) => (
                    <li key={line}>{withMail(line)}</li>
                  ))}
                </ul>
              ) : (
                <p key={j}>{withMail(b)}</p>
              ),
            )}
          </section>
        ))}
      </main>
      <Footer />
    </div>
  );
}
