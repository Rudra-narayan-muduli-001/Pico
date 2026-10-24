// One entry, three surfaces — tauri.conf.json routes each window to
// index.html?surface=island|circle|settings.

import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { applyAppearance, type Appearance } from "./lib/appearance";
import { settingsLoad } from "./lib/bridge";
import Island from "./island/Island";
import Circle from "./circle/Circle";
import SettingsApp from "./settings/SettingsApp";

const surface = new URLSearchParams(window.location.search).get("surface") ?? "island";
document.body.classList.add(`surface-${surface}`);

// Theme / reduced-motion classes land before first paint on every surface.
settingsLoad()
  .then((s) => applyAppearance(s as Appearance))
  .catch(() => {});

const App =
  surface === "circle" ? Circle : surface === "settings" ? SettingsApp : Island;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
