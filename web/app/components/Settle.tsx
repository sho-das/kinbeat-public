"use client";

import { useEffect } from "react";

export function Settle() {
  useEffect(() => {
    const timer = setTimeout(() => document.documentElement.classList.add("settled"), 2600);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
