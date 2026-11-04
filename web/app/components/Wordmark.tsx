// The KinBeat wordmark (magnifier with a pulse line in the B). Orange on light backgrounds, white on dark ones.
export function Wordmark({ tone = "orange" }: { tone?: "orange" | "white" }) {
  return <img className="wm" src={`/brand/wordmark-${tone}.png`} alt="KinBeat" width="1676" height="362" decoding="async" />;
}
