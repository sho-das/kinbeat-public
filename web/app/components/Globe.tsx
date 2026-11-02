"use client";

import { useEffect, useRef } from "react";
import { RINGS } from "./map-rings";

type Vec = [number, number, number];

const ORANGE = "232,98,44";
// The page is dark: the sea, grid and labels are drawn in light paper colour.
const NAVY = "246,241,231";
const INK = "#F6F1E7";
const FADE_IN_MS = 1600;
const FLIGHT_MS = 3800;
const MAX_FLIGHTS = 28;
// Phones show only this many keys and tokens at once, so the small globe does not look crowded.
const MAX_FLIGHTS_PHONE = 3;
// The earth makes one turn in this time. START_LON is the longitude in the middle at the start; TILT leans the north towards the viewer (radians).
const TURN_MS = 90000;
const START_LON = 45;
const TILT = 0.5;

const CITIES: Array<{ name: string; lon: number; lat: number }> = [
  { name: "LONDON", lon: -0.12, lat: 51.5 },
  { name: "DELHI", lon: 77.2, lat: 28.6 },
  { name: "DUBLIN", lon: -6.26, lat: 53.35 },
  { name: "PARIS", lon: 2.35, lat: 48.85 },
  { name: "MADRID", lon: -3.7, lat: 40.42 },
  { name: "LISBON", lon: -9.14, lat: 38.72 },
  { name: "AMSTERDAM", lon: 4.9, lat: 52.37 },
  { name: "BERLIN", lon: 13.4, lat: 52.52 },
  { name: "ROME", lon: 12.5, lat: 41.9 },
  { name: "VIENNA", lon: 16.37, lat: 48.21 },
  { name: "WARSAW", lon: 21.01, lat: 52.23 },
  { name: "STOCKHOLM", lon: 18.07, lat: 59.33 },
  { name: "HELSINKI", lon: 24.94, lat: 60.17 },
  { name: "KYIV", lon: 30.52, lat: 50.45 },
  { name: "ATHENS", lon: 23.73, lat: 37.98 },
  { name: "ISTANBUL", lon: 28.98, lat: 41 },
  { name: "MOSCOW", lon: 37.62, lat: 55.75 },
  { name: "CAIRO", lon: 31.24, lat: 30.04 },
  { name: "RIYADH", lon: 46.68, lat: 24.71 },
  { name: "TEHRAN", lon: 51.39, lat: 35.69 },
  { name: "DUBAI", lon: 55.3, lat: 25.3 },
  { name: "ALGIERS", lon: 3.06, lat: 36.75 },
  { name: "LAGOS", lon: 3.4, lat: 6.5 },
  { name: "NAIROBI", lon: 36.82, lat: -1.29 },
  { name: "TASHKENT", lon: 69.24, lat: 41.3 },
  { name: "KARACHI", lon: 67.0, lat: 24.86 },
  { name: "MUMBAI", lon: 72.88, lat: 19.08 },
  { name: "BENGALURU", lon: 77.59, lat: 12.97 },
  { name: "DHAKA", lon: 90.41, lat: 23.81 },
  { name: "COLOMBO", lon: 79.86, lat: 6.93 },
  { name: "NEW YORK", lon: -74, lat: 40.7 },
  { name: "TORONTO", lon: -79.4, lat: 43.65 },
  { name: "MEXICO CITY", lon: -99.1, lat: 19.43 },
  { name: "LOS ANGELES", lon: -118.2, lat: 34.05 },
  { name: "SAO PAULO", lon: -46.6, lat: -23.5 },
  { name: "BUENOS AIRES", lon: -58.4, lat: -34.6 },
  { name: "JOHANNESBURG", lon: 28.05, lat: -26.2 },
  { name: "CAPE TOWN", lon: 18.42, lat: -33.92 },
  { name: "BEIJING", lon: 116.4, lat: 39.9 },
  { name: "SEOUL", lon: 126.98, lat: 37.57 },
  { name: "TOKYO", lon: 139.7, lat: 35.7 },
  { name: "SINGAPORE", lon: 103.8, lat: 1.35 },
  { name: "JAKARTA", lon: 106.85, lat: -6.2 },
  { name: "SYDNEY", lon: 151.2, lat: -33.87 },
  // Extra cities in the USA, China, Europe and India, so more flights start and land there.
  { name: "SAN FRANCISCO", lon: -122.42, lat: 37.77 },
  { name: "SEATTLE", lon: -122.33, lat: 47.61 },
  { name: "CHICAGO", lon: -87.63, lat: 41.88 },
  { name: "WASHINGTON", lon: -77.04, lat: 38.91 },
  { name: "BOSTON", lon: -71.06, lat: 42.36 },
  { name: "AUSTIN", lon: -97.74, lat: 30.27 },
  { name: "ATLANTA", lon: -84.39, lat: 33.75 },
  { name: "MIAMI", lon: -80.19, lat: 25.76 },
  { name: "SHANGHAI", lon: 121.47, lat: 31.23 },
  { name: "SHENZHEN", lon: 114.06, lat: 22.54 },
  { name: "HONG KONG", lon: 114.17, lat: 22.32 },
  { name: "GUANGZHOU", lon: 113.26, lat: 23.13 },
  { name: "HANGZHOU", lon: 120.16, lat: 30.27 },
  { name: "CHENGDU", lon: 104.07, lat: 30.57 },
  { name: "WUHAN", lon: 114.31, lat: 30.59 },
  { name: "FRANKFURT", lon: 8.68, lat: 50.11 },
  { name: "MUNICH", lon: 11.58, lat: 48.14 },
  { name: "ZURICH", lon: 8.54, lat: 47.37 },
  { name: "MILAN", lon: 9.19, lat: 45.46 },
  { name: "BARCELONA", lon: 2.17, lat: 41.39 },
  { name: "BRUSSELS", lon: 4.35, lat: 50.85 },
  { name: "PRAGUE", lon: 14.44, lat: 50.08 },
  { name: "COPENHAGEN", lon: 12.57, lat: 55.68 },
  { name: "MANCHESTER", lon: -2.24, lat: 53.48 },
  { name: "HYDERABAD", lon: 78.49, lat: 17.39 },
  { name: "CHENNAI", lon: 80.27, lat: 13.08 },
  { name: "PUNE", lon: 73.86, lat: 18.52 },
  { name: "KOLKATA", lon: 88.36, lat: 22.57 },
  { name: "AHMEDABAD", lon: 72.57, lat: 23.02 },
  { name: "JAIPUR", lon: 75.79, lat: 26.91 },
];

const rad = (deg: number) => (deg * Math.PI) / 180;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function unit(lon: number, lat: number): Vec {
  const a = rad(lat);
  const b = rad(lon);
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
}


// Turns a point on the earth into screen units (x right, y up, z towards the viewer). The earth turns on its own
// north-south axis, west to east, like a real globe. The north leans a little towards the viewer.
function makeView() {
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  return (p: Vec, spin: number): Vec => {
    const turn = spin - rad(START_LON);
    const x1 = p[0] * Math.cos(turn) - p[1] * Math.sin(turn);
    const y1 = p[0] * Math.sin(turn) + p[1] * Math.cos(turn);
    return [y1, p[2] * ct - x1 * st, x1 * ct + p[2] * st];
  };
}

// A point part of the way along the great circle from a to b, lifted off the surface in the middle.
function along(a: Vec, b: Vec, u: number): Vec {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const s = Math.sin(angle) || 1;
  const wa = Math.sin((1 - u) * angle) / s;
  const wb = Math.sin(u * angle) / s;
  const lift = 1 + 0.12 * Math.sin(Math.PI * u) * Math.min(1, angle * 3);
  return [(a[0] * wa + b[0] * wb) * lift, (a[1] * wa + b[1] * wb) * lift, (a[2] * wa + b[2] * wb) * lift];
}

function drawKey(g: CanvasRenderingContext2D, x: number, y: number, size: number) {
  g.beginPath();
  g.arc(x - size * 0.45, y, size * 0.32, 0, Math.PI * 2);
  g.moveTo(x - size * 0.13, y);
  g.lineTo(x + size * 0.55, y);
  g.moveTo(x + size * 0.3, y);
  g.lineTo(x + size * 0.3, y + size * 0.26);
  g.moveTo(x + size * 0.55, y);
  g.lineTo(x + size * 0.55, y + size * 0.26);
  g.stroke();
}

// What a flight carries. Each flight keeps one kind for its whole trip.
const PAYLOADS = ["key", "hash", "stars", "ghp_••••", "AKIA••••", "eyJ••••", "sk-••••", "pwd: ••••"];

function drawSymbol(g: CanvasRenderingContext2D, kind: number, x: number, y: number, size: number) {
  g.lineWidth = Math.max(1.6, size * 0.1);
  g.strokeStyle = INK;
  g.fillStyle = INK;
  g.font = `700 ${Math.round(size * 0.85)}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const payload = PAYLOADS[kind];
  if (payload === "key") drawKey(g, x, y, size);
  else if (payload === "hash") g.fillText("#####", x, y);
  else if (payload === "stars") {
    g.fillStyle = `rgb(${ORANGE})`;
    g.fillText("*****", x, y);
  } else g.fillText(payload, x, y);
}

interface Flight {
  from: number;
  to: number;
  born: number;
  kind: number;
}

export function Globe() {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = box.current;
    const cv = canvas.current;
    const g = cv?.getContext("2d");
    if (!el || !cv || !g) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Phones (860px or less, as in globals.css).
    const phone = () => window.innerWidth <= 860;
    const rings = RINGS.map((flat) => {
      const out: Vec[] = [];
      for (let i = 0; i < flat.length; i += 2) out.push(unit(flat[i] / 10, flat[i + 1] / 10));
      return out;
    });
    const view = makeView();
    const spots = CITIES.map((c) => unit(c.lon, c.lat));
    // Grid lines every 15 degrees.
    const lines: Vec[][] = [];
    for (let lon = -180; lon < 180; lon += 15) lines.push(Array.from({ length: 61 }, (_, k) => unit(lon, -90 + k * 3)));
    for (let lat = -75; lat <= 75; lat += 15) lines.push(Array.from({ length: 121 }, (_, k) => unit(-180 + k * 3, lat)));
    let width = 0;
    let height = 0;
    let begun = performance.now();
    let flights: Flight[] = [];
    let frame = 0;
    let visible = true;
    let spin = 0;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const rect = el.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      cv.width = Math.round(width * ratio);
      cv.height = Math.round(height * ratio);
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      begun = performance.now();
      draw(performance.now());
    };

    const draw = (now: number) => {
      // Phones: the globe sits to the right, above the headline, and does not turn.
      const wide = !phone();
      const radius = wide ? Math.min(width * 0.36, height * 0.8) : Math.min(width, height) * 0.46;
      const cx = wide ? width * 0.7 : width * 0.6;
      const cy = wide ? height * 0.52 : height * 0.5;
      const strength = wide ? 1 : 0.55;
      const at = (p: Vec): [number, number] => [cx + p[0] * radius, cy - p[1] * radius];
      g.clearRect(0, 0, width, height);

      // The sea: a soft disc with a thin edge.
      const sea = g.createRadialGradient(cx, cy, radius * 0.5, cx, cy, radius);
      sea.addColorStop(0, `rgba(${NAVY},0)`);
      sea.addColorStop(1, `rgba(${NAVY},${0.07 * strength})`);
      g.fillStyle = sea;
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = `rgba(${NAVY},${0.18 * strength})`;
      g.lineWidth = 1;
      g.stroke();

      // Grid lines.
      g.strokeStyle = `rgba(${NAVY},${0.1 * strength})`;
      g.lineWidth = 0.7;
      g.beginPath();
      for (const line of lines) {
        let pen = false;
        for (const point of line) {
          const p = view(point, spin);
          if (p[2] < 0) {
            pen = false;
            continue;
          }
          const [x, y] = at(p);
          if (pen) g.lineTo(x, y);
          else g.moveTo(x, y);
          pen = true;
        }
      }
      g.stroke();

      // Land: every country as a filled shape with its border. Points on the far side are pushed to the edge of the globe.
      g.fillStyle = `rgba(${ORANGE},${0.17 * strength})`;
      g.strokeStyle = `rgba(${ORANGE},${0.9 * strength})`;
      g.lineWidth = 0.9;
      g.lineJoin = "round";
      for (const ring of rings) {
        let seen = false;
        const path: Array<[number, number]> = [];
        for (const point of ring) {
          const p = view(point, spin);
          if (p[2] >= 0) {
            seen = true;
            path.push(at(p));
          } else {
            const len = Math.hypot(p[0], p[1]) || 1;
            path.push(at([p[0] / len, p[1] / len, 0]));
          }
        }
        if (!seen) continue;
        g.beginPath();
        path.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        g.closePath();
        g.fill();
        g.stroke();
      }

      if (still || now - begun < FADE_IN_MS) {
        g.globalAlpha = 1;
        return;
      }

      const marked = new Set<number>([0]);
      const named = new Set<number>([0]);
      flights.forEach((f, i) => {
        marked.add(f.from);
        marked.add(f.to);
        if (i < 5) {
          named.add(f.from);
          named.add(f.to);
        }
      });
      g.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
      g.textAlign = "left";
      g.textBaseline = "middle";
      marked.forEach((index) => {
        const p = view(spots[index], spin);
        if (p[2] < 0.1) return;
        const [x, y] = at(p);
        if (index === 0) {
          const ring = (now % 2600) / 2600;
          g.strokeStyle = `rgba(${ORANGE},${(1 - ring) * 0.8})`;
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(x, y, 6 + ring * 24, 0, Math.PI * 2);
          g.stroke();
        }
        g.fillStyle = `rgb(${ORANGE})`;
        g.beginPath();
        g.arc(x, y, 4.2, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = INK;
        if (named.has(index)) g.fillText(CITIES[index].name, x + 10, y - 11);
      });

      for (const f of flights) {
        const u = Math.min(1, (now - f.born) / FLIGHT_MS);
        const trail = 20;
        g.lineWidth = 1.5;
        for (let k = trail; k > 0; k--) {
          const a = view(along(spots[f.from], spots[f.to], Math.max(0, u - k * 0.012)), spin);
          const b = view(along(spots[f.from], spots[f.to], Math.max(0, u - (k - 1) * 0.012)), spin);
          if (a[2] < 0 || b[2] < 0) continue;
          const [ax, ay] = at(a);
          const [bx, by] = at(b);
          g.strokeStyle = `rgba(${ORANGE},${((trail - k) / trail) * 0.7})`;
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
          g.stroke();
        }
        const head = view(along(spots[f.from], spots[f.to], u), spin);
        if (head[2] < 0) continue;
        const [hx, hy] = at(head);
        g.globalAlpha = Math.max(0, Math.min(1, u * 8, (1 - u) * 8));
        drawSymbol(g, f.kind, hx, hy - 16, 15);
        g.globalAlpha = 1;
      }
    };

    // A new flight between two cities that are on the front of the globe right now.
    const newFlight = (now: number) => {
      // On phones only cities on the top half of the globe, so flights stay above the headline.
      const shown = spots.map((_, i) => i).filter((i) => {
        const p = view(spots[i], spin);
        return p[2] > 0.25 && (!phone() || p[1] > 0.15);
      });
      if (shown.length < 2) return;
      const from = shown[Math.floor(Math.random() * shown.length)];
      const near = shown.filter((i) => i !== from && dot(spots[from], spots[i]) < 0.995 && dot(spots[from], spots[i]) > 0.1);
      if (near.length === 0) return;
      flights.push({ from, to: near[Math.floor(Math.random() * near.length)], born: now, kind: Math.floor(Math.random() * PAYLOADS.length) });
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      const t = now - begun - FADE_IN_MS;
      spin = t > 0 && !phone() ? (2 * Math.PI * t) / TURN_MS : 0;
      if (t > 0) {
        flights = flights.filter((f) => now - f.born < FLIGHT_MS);
        if (flights.length < (phone() ? MAX_FLIGHTS_PHONE : MAX_FLIGHTS) && Math.random() < 0.15) newFlight(now);
      }
      draw(now);
    };

    const watcher = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    const sizer = new ResizeObserver(resize);
    watcher.observe(el);
    sizer.observe(el);
    resize();
    if (!still) frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      sizer.disconnect();
    };
  }, []);

  return (
    <div className="globe" ref={box} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
