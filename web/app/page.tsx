import { content as C } from "./content";
import { Demo } from "./components/Demo";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { Scanner } from "./components/Scanner";
import { Settle } from "./components/Settle";
import { Globe } from "./components/Globe";

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
    <>
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
              <span className="w w3 o">
                <span>
                  {C.headline[2].split(/(hackers)/i).map((part, i) =>
                    /^hackers$/i.test(part) ? (
                      <mark key={i} className="hl red">
                        {part}
                      </mark>
                    ) : (
                      part
                    ),
                  )}
                </span>
              </span>
            </h1>
            <p className="lede">{C.lead}</p>
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

        <section className="band light story" id="how" aria-labelledby="story-h">
          <div className="wrap">
            <h2 id="story-h">{C.demo.title}</h2>
            <Demo />
          </div>
        </section>

        <section className="section" id="scan" aria-labelledby="scan-h">
          <div className="wrap">
            <h2 className="big" id="scan-h">
              {C.scanSection.title}
            </h2>
            <p className="strip">
              <strong>{C.scanSection.strip}</strong> <span>{C.scanSection.stripNote}</span>
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

      </main>

      <Footer />
    </>
  );
}
