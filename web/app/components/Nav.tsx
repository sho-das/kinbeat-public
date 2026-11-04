"use client";

import { useState } from "react";
import { content as C } from "../content";
import { Wordmark } from "./Wordmark";

// The same header on every page. Off the home page the links point back to the home page's sections.
export function Nav({ home = true }: { home?: boolean }) {
  const [open, setOpen] = useState(false);
  const at = (hash: string) => (home ? hash : `/${hash}`);
  return (
    <header className="nav">
      <div className="wrap nav__row">
        <button
          type="button"
          className="nav__menu"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="nav-links"
          onClick={() => setOpen(!open)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <a className="brand" href={home ? "#top" : "/"} aria-label="KinBeat, home">
          <Wordmark />
        </a>
        <nav id="nav-links" className={open ? "nav__links open" : "nav__links"} aria-label="Page">
          {C.nav.map((n) => (
            <a key={n.href} href={at(n.href)} onClick={() => setOpen(false)}>
              {n.label}
            </a>
          ))}
        </nav>
        <a className="nav__cta" href={at("#contact")}>
          {C.cta.nav}
        </a>
      </div>
    </header>
  );
}
