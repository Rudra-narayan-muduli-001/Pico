// Theme + reduced-motion classes on the root element. Shared by every surface
// (main.tsx applies them at boot; the Settings toggles apply them live).

export interface Appearance {
  theme?: "dark" | "light" | "system";
  reduced_motion?: boolean;
}

export function applyAppearance(s: Appearance): void {
  const root = document.documentElement;
  const light =
    s.theme === "light" ||
    (s.theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  root.classList.toggle("theme-light", light);
  root.classList.toggle("reduced-motion", !!s.reduced_motion);
}
