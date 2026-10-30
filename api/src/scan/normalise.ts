const HIDDEN = /[­​-‍⁠﻿]/;
const FULL_WIDTH = /[！-～]/;

interface Normalised {
  text: string;
  start(index: number): number;
  end(index: number): number;
}

export function needsNormalising(text: string): boolean {
  return HIDDEN.test(text) || FULL_WIDTH.test(text);
}

// Drops hidden characters and folds full-width letters. `origin[i]` is where cleaned index i sits in the original text.
export function normalise(text: string): Normalised {
  let out = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i) as number;
    const char = String.fromCodePoint(code);
    const size = char.length;
    if (!HIDDEN.test(char)) {
      const folded = FULL_WIDTH.test(char) ? String.fromCharCode(code - 0xfee0) : char;
      out += folded;
      for (let k = 0; k < folded.length; k++) origin.push(i);
    }
    i += size;
  }
  const last = origin.length;
  return {
    text: out,
    start: (index) => origin[index] ?? text.length,
    end: (index) => (index <= 0 ? 0 : index >= last ? text.length : origin[index - 1] + (text.codePointAt(origin[index - 1]) as number > 0xffff ? 2 : 1)),
  };
}
