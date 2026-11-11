import type { CSSProperties, ReactNode } from "react";

/** A row of options with a thumb that slides to the chosen one. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: [T, ReactNode][];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div
      className={`segmented${disabled ? " disabled" : ""}`}
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={v === value} className={v === value ? "on" : ""} disabled={disabled} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
