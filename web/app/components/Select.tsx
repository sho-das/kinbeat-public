"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

export function Select({ value, options, onChange, labelledBy, disabled = false }: { value: string; options: Option[]; onChange: (value: string) => void; labelledBy: string; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    setActive(selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    const last = options.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) show();
      else setActive((a) => Math.min(last, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) show();
      else setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open) choose(active);
      else show();
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="sel" ref={root}>
      <button
        type="button"
        className="sel-btn"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={labelledBy}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        <span>{options[selectedIndex]?.label ?? ""}</span>
        <svg viewBox="0 0 12 8" aria-hidden="true" className={open ? "up" : ""}>
          <path d="M1 1.5L6 6.5L11 1.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        </svg>
      </button>
      {open && (
        <ul className="sel-list" id={`${id}-list`} role="listbox" aria-labelledby={labelledBy} ref={list}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`sel-opt${i === active ? " active" : ""}${o.value === value ? " chosen" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              <span className="tick" aria-hidden="true">
                {o.value === value ? "✓" : ""}
              </span>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
