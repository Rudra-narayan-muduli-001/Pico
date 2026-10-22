// Mochi-style canvas avatar (Design.md): code-drawn, requestAnimationFrame.
// States: idle (breathe + blink), listening (pulse), processing (gaze away),
// speaking (mouth bar). No images.

import { useEffect, useRef } from "react";
import type { VoiceState } from "../lib/bridge";

export default function Avatar({ state, size }: { state: VoiceState; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<VoiceState>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = size * scale;
    canvas.height = size * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();
    let nextBlink = start + 2500;

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const t = (now - start) / 1000;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      // Breathing: gentle radius swell on a 3.5s loop.
      const breathe = stateRef.current === "idle" ? 1 + Math.sin((t * 2 * Math.PI) / 3.5) * 0.03 : 1;
      const pulse =
        stateRef.current === "listening" ? 1 + Math.sin(t * 2 * Math.PI) * 0.06 : 1;
      const r = (w / 2 - 6 * scale) * breathe * pulse;

      // Body
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = stateRef.current === "listening" ? "#00C896" : "#1A1D20";
      ctx.fill();
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = "#00C896";
      ctx.globalAlpha = stateRef.current === "listening" ? 1 : 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Eyes; blink every ~2.5s+ for 120 ms.
      let blinkT = 0;
      if (now >= nextBlink) {
        if (now > nextBlink + 120) {
          nextBlink = now + 2000 + Math.random() * 2500;
        } else {
          blinkT = 1;
        }
      }
      const eyeR = r * 0.1;
      const eyeDX = r * 0.34;
      // Thinking: gaze drifts sideways.
      const gaze = stateRef.current === "processing" ? r * 0.12 : 0;
      ctx.fillStyle = "#E8EAED";
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        if (blinkT) {
          ctx.ellipse(cx + dir * eyeDX + gaze, cy - r * 0.1, eyeR, eyeR * 0.15, 0, 0, Math.PI * 2);
        } else {
          ctx.arc(cx + dir * eyeDX + gaze, cy - r * 0.1, eyeR, 0, Math.PI * 2);
        }
        ctx.fill();
      }

      // Mouth: speaking = animated bar, else a soft line.
      ctx.strokeStyle = "#E8EAED";
      ctx.lineWidth = 1.5 * scale;
      ctx.beginPath();
      if (stateRef.current === "speaking") {
        const amp = (Math.abs(Math.sin(t * 9)) * 0.6 + 0.2) * r * 0.16;
        ctx.moveTo(cx - r * 0.22, cy + r * 0.28 - amp / 2);
        ctx.quadraticCurveTo(cx, cy + r * 0.28 + amp, cx + r * 0.22, cy + r * 0.28 - amp / 2);
      } else {
        ctx.moveTo(cx - r * 0.2, cy + r * 0.3);
        ctx.quadraticCurveTo(cx, cy + r * 0.36, cx + r * 0.2, cy + r * 0.3);
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, flex: "0 0 auto" }}
      role="img"
      aria-label={`Pico avatar, ${state}`}
    />
  );
}
