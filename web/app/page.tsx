import { content as C } from "./content";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { Scanner } from "./components/Scanner";
import { Settle } from "./components/Settle";
import { Globe } from "./components/Globe";
import { Leak } from "./components/Leak";
import { SizeSection } from "./components/Dots";

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: C.name,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    description: "Finds exposed tokens, keys and passwords in chats, documents and images.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: C.faq.items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
];

export default function Home() {
  return (
    <div className="night">
      <Settle />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />

      <main id="top">
        <header className="hero">
          <Globe />
          <div className="wrap hero__copy">
            <h1>
              <span className="w w1">{C.headline[0]}</span>
              <span className="w w2">
                {C.headline[1]}
              </span>
              <span className="w w3">
                {C.headline[2].split(/(hackers do\.?)/i).map((part, i) =>
                  /^hackers do/i.test(part) ? (
                    <em key={i} className="glow">
                      {part}
                      <svg viewBox="0 0 300 24" preserveAspectRatio="none" aria-hidden="true">
                        <path pathLength={1} d="M3 15 C 60 4, 120 22, 180 9 S 270 6, 297 14" />
                      </svg>
                    </em>
                  ) : (
                    part
                  ),
                )}
              </span>
            </h1>
            <p className="lede">{C.lead}</p>
            <p className="lede-source">
              Source:{" "}
              <a href={C.leadSource.url} target="_blank" rel="noopener noreferrer">
                {C.leadSource.name}
              </a>
            </p>
            <div className="cta">
              <a className="btn" href="#scan">
                {C.cta.primary}
              </a>
              <a className="btn ghost" href="#how">
                {C.cta.secondary}
              </a>
            </div>
          </div>
        </header>

        <SizeSection />

        <section className="section leak-section" id="how" aria-labelledby="leak-h">
          <div className="wrap">
            <h2 className="big" id="leak-h">
              {C.leak.title}
            </h2>
            <Leak />
          </div>
        </section>

        <section className="section" id="scan" aria-labelledby="scan-h">
          <div className="wrap">
            <h2 className="big" id="scan-h">
              {C.scanSection.title}
            </h2>
            <p className="strip">
              <strong>{C.scanSection.strip}</strong>
            </p>
            <Scanner />
          </div>
        </section>

        <section className="band light faq" id="faq" aria-labelledby="faq-h">
          <div className="wrap">
            <h2 className="big" id="faq-h">
              {C.faq.title}
            </h2>
            <div className="faq-list">
              {C.faq.items.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-h">
          <div className="wrap">
            <h2 className="closing__big" id="closing-h">
              {C.closing.split(/(hackers do\.?)/i).map((part, i) => (/^hackers do/i.test(part) ? <em key={i}>{part}</em> : part))}
            </h2>
            <a className="btn" href="#scan">
              {C.cta.primary}
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
