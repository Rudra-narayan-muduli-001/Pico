// Circle-to-ask overlay (Design.md "Circle-to-Ask Overlay"): fullscreen dark
// tint, 3 px accent lasso with dash animation; on release the polygon goes to
// the brain ({"dir":"py","cmd":"circle_ask", polygon}), then the window hides
// itself via the window op {"dir":"win","op":"circle_hide"}.
//
// Esc cancels: Rust's global Escape hotkey sends circle_cancel + hides (the
// overlay is WS_EX_NOACTIVATE, so it usually has no focus); the in-page key
// handler below is the fallback for when it does.
//
// Question flow (v1): after the polygon, python crops the region and either
// attaches the voice buffer or asks via TTS — the UI just shows the waiting
// state and points at Ctrl+Space for speaking the question.

import { useCallback, useEffect, useRef, useState } from "react";
import { onCircleMode, onCircleReset, send, sendWin } from "../lib/bridge";

type Pt = [number, number];

export default function Circle() {
  const [points, setPoints] = useState<Pt[]>([]);
  const [asking, setAsking] = useState(false);
  const drawing = useRef(false);

  const reset = useCallback(() => {
    setPoints([]);
    setAsking(false);
    drawing.current = false;
  }, []);

  useEffect(() => {
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    onCircleReset(reset).then((f) => (un1 = f));
    onCircleMode((active) => {
      if (active) reset();
    }).then((f) => (un2 = f));
    return () => {
      un1?.();
      un2?.();
    };
  }, [reset]);

  const cancel = useCallback(() => {
    send({ cmd: "circle_cancel" }).catch(() => {});
    sendWin("circle_hide").catch(() => {});
    reset();
  }, [reset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const down = (e: React.MouseEvent) => {
    if (asking) return;
    drawing.current = true;
    setPoints([[e.clientX, e.clientY]]);
  };

  const move = (e: React.MouseEvent) => {
    if (!drawing.current) return;
    setPoints((prev) => {
      const lastPoint = prev[prev.length - 1];
      // Throttle: 4 px min spacing keeps the polygon small.
      if (lastPoint && Math.hypot(e.clientX - lastPoint[0], e.clientY - lastPoint[1]) < 4) {
        return prev;
      }
      return [...prev, [e.clientX, e.clientY]];
    });
  };

  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (points.length < 3) {
      setPoints([]); // a dot isn't a region
      return;
    }
    setAsking(true);
    // Screenshot + question are the brain's job (it crops by polygon and either
    // uses the voice buffer or asks via TTS — Design.md circle flow).
    send({ cmd: "circle_ask", polygon: points, question_audio_b64: "" }).catch(() => {});
    // Give the brain a beat to ack, then release the screen. The answer lands
    // in the island's Plans panel (panel_update).
    setTimeout(() => {
      sendWin("circle_hide").catch(() => {});
      reset();
    }, 900);
  };

  const centroid =
    points.length > 2
      ? points.reduce((acc, p) => [acc[0] + p[0] / points.length, acc[1] + p[1] / points.length], [
          0, 0,
        ] as Pt)
      : null;

  return (
    <div
      className="circle-overlay"
      role="presentation"
      onMouseDown={down}
      onMouseMove={move}
      onMouseUp={up}
    >
      <div className="circle-hint">
        Draw a circle around what you want to ask about — Esc to cancel
      </div>
      {points.length > 1 && (
        <svg
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh" }}
          aria-hidden="true"
        >
          <polyline
            points={points.map((p) => p.join(",")).join(" ")}
            fill="rgba(0, 200, 150, 0.12)"
            stroke="var(--accent)"
            strokeWidth={3}
            strokeDasharray="10 6"
            strokeLinejoin="round"
          >
            <animate
              attributeName="stroke-dashoffset"
              from="16"
              to="0"
              dur="0.5s"
              repeatCount="indefinite"
            />
          </polyline>
        </svg>
      )}
      {asking && (
        <div className="circle-asking" role="status" aria-live="polite">
          {centroid && (
            <div
              className="circle-spinner"
              style={{ left: centroid[0] - 14, top: centroid[1] - 14 }}
              aria-label="Asking Pico"
            />
          )}
          <div className="circle-hint asking-hint">
            Pico is looking at it… hold Ctrl+Space to speak your question
          </div>
        </div>
      )}
    </div>
  );
}
