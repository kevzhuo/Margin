import { useEffect, useRef, type ReactNode } from "react";
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN, useStore, type FontFamily, type LineWidth, type ThemePref } from "../state/store";
import { formatShortcut } from "../state/appCommands";
import { usePresence } from "./usePresence";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: [T, string][];
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
      style={{ "--count": options.length, "--index": index } as React.CSSProperties}
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

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row toggle-row">
      <span className="setting-label">
        {label}
        {hint && <kbd className="setting-hint">{hint}</kbd>}
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-label">{label}</span>
      {children}
    </div>
  );
}

export function SettingsPopover() {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const theme = useStore((s) => s.theme);
  const fontSize = useStore((s) => s.fontSize);
  const fontFamily = useStore((s) => s.fontFamily);
  const lineWidth = useStore((s) => s.lineWidth);
  const fullWidth = useStore((s) => s.fullWidth);
  const focusMode = useStore((s) => s.focusMode);
  const typewriter = useStore((s) => s.typewriter);
  const smoothCaret = useStore((s) => s.smoothCaret);
  const smartTypography = useStore((s) => s.smartTypography);
  const titleSync = useStore((s) => s.titleSync);
  const { mounted, closing } = usePresence(open, 140);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (ref.current?.contains(target) || target.closest?.(".settings-button")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("button, input")?.focus());
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  if (!mounted) return null;
  const s = useStore.getState();

  return (
    <div ref={ref} className="settings-popover" role="dialog" aria-label="Settings" data-closing={closing || undefined}>
      <div className="settings-section">Appearance</div>
      <Row label="Theme">
        <Segmented<ThemePref>
          label="Theme"
          value={theme}
          options={[
            ["system", "Auto"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={s.setTheme}
        />
      </Row>
      <Row label="Font">
        <Segmented<FontFamily>
          label="Font"
          value={fontFamily}
          options={[
            ["sans", "Sans"],
            ["serif", "Serif"],
            ["mono", "Mono"],
          ]}
          onChange={s.setFontFamily}
        />
      </Row>
      <Toggle label="Full width" checked={fullWidth} onChange={s.setFullWidth} />
      <Row label="Line width">
        <Segmented<LineWidth>
          label="Line width"
          value={lineWidth}
          options={[
            ["narrow", "Narrow"],
            ["medium", "Medium"],
            ["wide", "Wide"],
          ]}
          onChange={s.setLineWidth}
          disabled={fullWidth}
        />
      </Row>
      <div className="setting-row">
        <label className="setting-label" htmlFor="font-size">
          Text size
        </label>
        <div className="size-control">
          <input
            id="font-size"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={(e) => s.setFontSize(Number(e.target.value))}
            style={{ "--fill": `${((fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100}%` } as React.CSSProperties}
          />
          <button className="size-value" onClick={() => s.setFontSize(FONT_SIZE_DEFAULT)} title="Reset to 16 px" aria-label={`Text size ${fontSize} pixels. Reset`}>
            {fontSize}
          </button>
        </div>
      </div>
      <div className="settings-divider" />
      <div className="settings-section">Writing</div>
      <Toggle label="Focus mode" hint={formatShortcut("F8")} checked={focusMode} onChange={s.setFocusMode} />
      <Toggle label="Typewriter mode" hint={formatShortcut("F9")} checked={typewriter} onChange={s.setTypewriter} />
      <Toggle label="Smooth caret" checked={smoothCaret} onChange={s.setSmoothCaret} />
      <Toggle label="Smart quotes and dashes" checked={smartTypography} onChange={s.setSmartTypography} />
      <Toggle label="Name notes after their title" checked={titleSync} onChange={s.setTitleSync} />
    </div>
  );
}
