import { content as C } from "./content";
import { Footer } from "./components/Footer";
import { Nav } from "./components/Nav";
import { Scanner } from "./components/Scanner";
import { Settle } from "./components/Settle";
import { Contact } from "./components/Contact";
import { Globe } from "./components/Globe";
import { SizeSection } from "./components/Dots";

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: C.name,
    applicationCategory: "SecurityApplication",
    operatingSystem: "Web",
    description: "Scan text, files, websites, GitHub, Google Drive and Slack chats",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: C.faq.items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a.replace("{video}", "this video") },
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
            <div className="cta">
              <a className="btn" href="#scan">
                {C.cta.primary}
              </a>
            </div>
          </div>
        </header>

        <SizeSection />

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
                  <p>
                    {/* "{video}" in an answer becomes a link to that item's video, opened in a new tab. */}
                    {f.a.split("{video}").map((part, i) =>
                      i === 0 ? (
                        part
                      ) : (
                        <span key={i}>
                          <a href={f.video} target="_blank" rel="noopener noreferrer">
                            this video
                          </a>
                          {part}
                        </span>
                      ),
                    )}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <Contact />
      </main>

      <Footer />
    </div>
  );
}
