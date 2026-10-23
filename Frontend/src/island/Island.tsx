// Island surface (Design.md "Island Component Spec"):
//   compact 120 px header (avatar + time + pills) ↔ expanded 420 px panels.
//   Scroll Y snaps panel-to-panel; scroll up at top collapses; click outside /
//   30 s idle collapses (the Rust poll emits `idle-collapse`). The window is a
//   fixed 760×420 — expansion is CSS; only the drawn shape takes the mouse.

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "./Avatar";
import { Panels, type PanelsData } from "./Panels";
import {
  getServerPort,
  onCursor,
  onIdleCollapse,
  onMessage,
  openSettingsWindow,
  reconnect,
  setIslandShape,
  type ToastMsg,
  type TranscriptMsg,
  type UiMsg,
  type VoiceState,
} from "../lib/bridge";

const COMPACT_H = 120;
const EXPANDED_W = 760;
const EXPANDED_H = 420;

/** While the brain is offline the island nudges the WS loop every 5 s. */
const RECONNECT_MS = 5000;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toTimeString().slice(0, 5);
}

export default function Island() {
  const [expanded, setExpanded] = useState(false);
  const [voice, setVoice] = useState<VoiceState>("idle");
  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptMsg[]>([]);
  const [toasts, setToasts] = useState<(ToastMsg & { key: number })[]>([]);
  const [panels, setPanels] = useState<PanelsData>({});
  const leftAt = useRef<number | null>(null);
  const toastKey = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const time = useClock();

  // Tell Rust which shape may take the mouse. Without this, nothing does.
  const applyShape = useCallback((isExpanded: boolean) => {
    setIslandShape(EXPANDED_W, isExpanded ? EXPANDED_H : COMPACT_H).catch(() => {});
  }, []);
  useEffect(() => applyShape(false), [applyShape]);

  const collapse = useCallback(() => {
    setExpanded((was) => {
      if (was) applyShape(false);
      return false;
    });
  }, [applyShape]);

  const expand = useCallback(() => {
    setExpanded((was) => {
      if (!was) applyShape(true);
      return true;
    });
  }, [applyShape]);

  // Rust poll: cursor position + idle-collapse.
  useEffect(() => {
    const un1 = onCursor((x, y) => {
      const onShape =
        x >= -14 && x <= EXPANDED_W + 14 && y >= -14 && y <= (expanded ? EXPANDED_H : COMPACT_H) + 14;
      if (!expanded) return;
      if (!onShape) {
        if (leftAt.current === null) leftAt.current = performance.now();
        // "Click outside → collapses after 2s" (Design.md interaction model).
        if (performance.now() - leftAt.current > 2000) collapse();
      } else {
        leftAt.current = null;
      }
    });
    const un2 = onIdleCollapse(collapse);
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [expanded, collapse]);

  // Brain offline → look up the port and nudge the WS loop every 5 s.
  // Degrades silently: the UI never depends on this succeeding.
  useEffect(() => {
    if (connected) return;
    getServerPort().catch(() => {});
    const t = setInterval(() => {
      getServerPort().catch(() => {});
      reconnect().catch(() => {});
    }, RECONNECT_MS);
    return () => clearInterval(t);
  }, [connected]);

  // Brain → island messages (dir:"ui").
  useEffect(() => {
    let alive = true;
    const un = onMessage((msg: UiMsg) => {
      if (!alive) return;
      switch (msg.type) {
        case "transcript":
          setLines((prev) => [...prev.slice(-7), msg as TranscriptMsg]);
          break;
        case "voice_state":
          setVoice((msg as { state: VoiceState }).state);
          break;
        case "toast": {
          const t = msg as ToastMsg;
          const key = ++toastKey.current;
          setToasts((prev) => [...prev, { ...t, key }]);
          setTimeout(
            () => setToasts((prev) => prev.filter((x) => x.key !== key)),
            t.duration ?? 3000,
          );
          break;
        }
        case "panel_update": {
          const p = msg as { panel: string; data: unknown };
          setPanels((prev) => ({ ...prev, [p.panel]: p.data }));
          break;
        }
        case "schedule_fired": {
          const s = msg as { id: string; prompt: string; result: string };
          setPanels((prev) => {
            const plans = (prev.plans ?? {}) as Record<string, unknown>;
            const fired = Array.isArray(plans.fired) ? plans.fired : [];
            return { ...prev, plans: { ...plans, fired: [...fired, s] } };
          });
          break;
        }
        case "link":
          setConnected((msg as { connected: boolean }).connected);
          break;
        // Python may report the active text provider / key state at connect.
        case "key_state":
          setProvider((msg as { provider?: string }).provider ?? null);
          break;
        default:
          break;
      }
    });
    return () => {
      alive = false;
      un.then((f) => f());
    };
  }, []);

  // Wheel: scroll panels; scroll up at top collapses (Design.md).
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!expanded && e.deltaY > 0) expand();
      if (expanded && e.deltaY < 0) {
        const el = scrollRef.current;
        if (el && el.scrollTop <= 8) collapse();
      }
    },
    [expanded, expand, collapse],
  );

  return (
    <div className={`island-shell${expanded ? "" : " compact"}`} onWheel={onWheel}>
      <div className="island-card" role="region" aria-label="Pico island">
        <div
          className="island-header"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => (expanded ? collapse() : expand())}
          onKeyDown={(e) => e.key === "Enter" && (expanded ? collapse() : expand())}
        >
          <Avatar state={voice} size={expanded ? 96 : 64} />
          <div className="island-time">{time}</div>
          <div className="island-pills">
            {!connected && <span className="pill warn">Brain offline — retrying</span>}
            {connected && !provider && (
              <span
                className="pill warn"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  openSettingsWindow().catch(() => {});
                }}
              >
                Add key in Settings
              </span>
            )}
            <span className={`pill${voice === "idle" ? "" : " accent"}`}>
              {voice === "idle" ? "Hold Ctrl+Space to talk" : voice}
            </span>
            {provider && <span className="pill">{provider}</span>}
          </div>
        </div>

        {(lines.length > 0 || voice !== "idle") && (
          <div className="voice-console" aria-live="polite">
            {lines.map((l, i) => (
              <div key={i} className={`voice-line role-${l.role}${l.role === "tool" ? " ok" : ""}`}>
                {l.role === "tool" ? (
                  <>
                    🔧 <span className="tool-pill">{l.tool_name}</span> {l.text}
                  </>
                ) : (
                  `${l.role === "user" ? "🎙 You" : "🤖 Pico"}: ${l.text}`
                )}
              </div>
            ))}
            {voice === "listening" && <div className="voice-line">Listening…</div>}
            {voice === "processing" && <div className="voice-line">Thinking…</div>}
          </div>
        )}

        {expanded && (
          <div
            className="panel-scroll"
            ref={scrollRef}
            tabIndex={0}
            aria-label="Pico panels"
          >
            <Panels data={panels} onCollapse={collapse} />
          </div>
        )}
      </div>

      <div className="toast-stack" aria-live="assertive">
        {toasts.map((t) => (
          <div key={t.key} className={`toast ${t.level}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
