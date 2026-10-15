import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronDown, IconMonitor } from "../icons";
import { THEMES, themeOf, type ThemeDef, type ThemeId } from "../../lib/themes";
import { applyTheme, resolvedTheme, setThemePreference, useThemePreference, type ThemePreference } from "../../lib/local-state";
import { Presence } from "../ui/Presence";

/** Applies a choice with a cross-fade instead of the last page change's slide (transitions.ts). */
function choose(pref: ThemePreference) {
  const apply = () => {
    setThemePreference(pref);
    applyTheme(resolvedTheme(pref), pref === null);
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    delete doc.documentElement.dataset.vt;
    doc.startViewTransition(apply);
  } else apply();
}

/** Three dots previewing a theme: page ground, card surface, accent. */
export function ThemeDots({ id, size = 14 }: { id: ThemeId; size?: number }) {
  const s = themeOf(id).swatch;
  return (
    <span className="inline-flex shrink-0 items-center" aria-hidden="true">
      {[s.bg, s.surface, s.accent].map((c, i) => (
        <span key={i} className="rounded-full border border-line-strong/60" style={{ width: size, height: size, background: c, marginLeft: i ? -size / 3 : 0 }} />
      ))}
    </span>
  );
}

/** Compact theme dropdown for the desktop sidebar footer; opens upward. */
export function ThemeMenu() {
  const pref = useThemePreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);
  const resolved: ThemeId = mounted ? resolvedTheme(pref) : "light";
  const pick = (next: ThemePreference) => {
    setOpen(false);
    if (next !== pref) choose(next);
  };
  return (
    <div ref={ref} className="relative mx-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="主题"
        onClick={() => setOpen(!open)}
        className="flex h-[34px] w-full items-center justify-center gap-1.5 rounded-full border border-line text-[12.5px] text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink"
      >
        <ThemeDots id={resolved} size={12} />
        <span className="max-w-[76px] truncate">{!mounted || pref === null ? `自动·${themeOf(resolved).name}` : themeOf(pref).name}</span>
        <IconChevronDown size={13} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      <Presence show={open} enter="anim-drop-in" exit="anim-drop-out" duration={140}>
        <div role="menu" aria-label="主题" className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-50 origin-bottom overflow-hidden rounded-tile border border-line bg-raised py-1 shadow-[var(--shadow-pop)]">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={mounted && pref === null}
            onClick={() => pick(null)}
            className="flex w-full items-center gap-2 px-2.5 py-[7px] text-left text-[12.5px] text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink"
          >
            <span className="flex w-[34px] shrink-0 justify-center text-ink-4">
              <IconMonitor size={14} />
            </span>
            <span className="flex-1 truncate">跟随系统</span>
            {mounted && pref === null && <IconCheck size={13} className="text-accent" />}
          </button>
          <div className="mx-2.5 my-1 border-t border-line-soft" aria-hidden="true" />
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={mounted && pref === t.id}
              onClick={() => pick(t.id)}
              className="flex w-full items-center gap-2 px-2.5 py-[7px] text-left text-[12.5px] text-ink-2 transition-colors hover:bg-bg-sunk hover:text-ink"
            >
              <span className="flex w-[34px] shrink-0 justify-center">
                <ThemeDots id={t.id} size={11} />
              </span>
              <span className="flex-1 truncate">{t.name}</span>
              <span className="text-[10.5px] text-ink-4">{t.mode === "dark" ? "深" : "浅"}</span>
              {mounted && pref === t.id && <IconCheck size={13} className="text-accent" />}
            </button>
          ))}
        </div>
      </Presence>
    </div>
  );
}

function ThemeCard({ active, onPick, preview, name, tag, blurb }: { active: boolean; onPick: () => void; preview: React.ReactNode; name: string; tag: string; blurb: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={`relative overflow-hidden rounded-card border p-2 text-left transition-colors duration-150 ${active ? "border-accent bg-accent-softer" : "border-line bg-surface hover:border-line-strong"}`}
    >
      {preview}
      <span className="mt-1.5 flex items-baseline gap-1 px-0.5 text-[13px] font-medium text-ink">
        {name}
        <span className="text-[10.5px] font-normal text-ink-4">{tag}</span>
      </span>
      <span className="block truncate px-0.5 text-[11px] leading-[1.7] text-ink-4">{blurb}</span>
      {active && (
        <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-accent text-accent-contrast" aria-hidden="true">
          <IconCheck size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function CardPreview({ theme }: { theme: ThemeDef }) {
  const bar = theme.mode === "dark" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.38)";
  return (
    <span aria-hidden="true" className="flex h-[52px] items-center justify-center rounded-control border border-black/5" style={{ background: theme.swatch.bg }}>
      <span className="flex h-7 w-12 flex-col justify-center gap-1 rounded-[6px] px-1.5 shadow-sm" style={{ background: theme.swatch.surface }}>
        <span className="h-1 w-3/4 rounded-full" style={{ background: bar }} />
        <span className="h-1 w-1/2 rounded-full" style={{ background: theme.swatch.accent }} />
      </span>
    </span>
  );
}

/** Theme cards with live-colour previews for the "我的" page. */
export function ThemeGallery() {
  const pref = useThemePreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current: ThemeId | "system" = !mounted ? "system" : (pref ?? "system");
  const pick = (next: ThemePreference) => {
    if ((next ?? "system") !== current) choose(next);
  };
  return (
    <div role="radiogroup" aria-label="主题" className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3">
      <ThemeCard
        active={current === "system"}
        onPick={() => pick(null)}
        preview={
          <span aria-hidden="true" className="flex h-[52px] items-center justify-center rounded-control border border-black/5" style={{ background: "linear-gradient(135deg, #f7f8fa 50%, #0d141d 50%)" }}>
            <span className="flex size-7 items-center justify-center rounded-full bg-surface text-ink-3 shadow-sm">
              <IconMonitor size={14} />
            </span>
          </span>
        }
        name="跟随系统"
        tag="自动"
        blurb="白天浅色，夜里深色"
      />
      {THEMES.map((t) => (
        <ThemeCard
          key={t.id}
          active={current === t.id}
          onPick={() => pick(t.id)}
          preview={<CardPreview theme={t} />}
          name={t.name}
          tag={t.mode === "dark" ? "深色" : "浅色"}
          blurb={t.blurb}
        />
      ))}
    </div>
  );
}
