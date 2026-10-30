export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className={`dash-stat${tone ? " " + tone : ""}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
