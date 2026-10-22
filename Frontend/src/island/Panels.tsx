// Expanded-island panels (Design.md "Island Component Spec"): Music, Clipboard,
// Plans, Apps, Wallpapers, Settings. Every panel is fed by dir:"ui"
// panel_update frames from the Python brain — nothing here talks to an API
// directly. Controls send provisional dir:"py" cmds (documented in callouts;
// the brain maps them onto actions/*).

import { openSettingsWindow, send } from "../lib/bridge";

export interface PanelsData {
  music?: { title?: string; artist?: string; position?: string; duration?: string; playing?: boolean };
  clipboard?: { items?: { id: string; text: string }[] };
  plans?: {
    todos?: { id: string; text: string; done?: boolean }[];
    schedules?: { id: string; prompt: string; schedule: string; enabled: boolean }[];
    fired?: { id: string; prompt: string; result: string }[];
    circle_results?: { id: string; thumb?: string; answer: string }[];
  };
  apps?: { pinned?: string[]; recent?: string[] };
  wallpapers?: { items?: { id: string; name: string }[] };
}

function Empty({ what }: { what: string }) {
  return <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>No {what} yet.</div>;
}

export function Panels({ data, onCollapse }: { data: PanelsData; onCollapse: () => void }) {
  return (
    <>
      <section className="panel" aria-label="Music">
        <h2>Music</h2>
        <div className="panel-body">
          {data.music?.title ? (
            <>
              <div>
                {data.music.title}
                {data.music.artist ? ` • ${data.music.artist}` : ""}
              </div>
              {data.music.position && data.music.duration && (
                <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                  {data.music.position} / {data.music.duration}
                </div>
              )}
              <div className="row" style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="btn"
                  onClick={() => send({ cmd: "panel_action", panel: "music", action: "prev" })}
                >
                  ⏮
                </button>
                <button
                  className="btn accent"
                  onClick={() =>
                    send({
                      cmd: "panel_action",
                      panel: "music",
                      action: data.music?.playing ? "pause" : "play",
                    })
                  }
                >
                  {data.music?.playing ? "⏸" : "▶"}
                </button>
                <button
                  className="btn"
                  onClick={() => send({ cmd: "panel_action", panel: "music", action: "next" })}
                >
                  ⏭
                </button>
              </div>
            </>
          ) : (
            <Empty what="music — play something (SMTC) and it shows up here" />
          )}
        </div>
      </section>

      <section className="panel" aria-label="Clipboard">
        <h2>Clipboard</h2>
        {data.clipboard?.items?.length ? (
          <div className="panel-grid">
            {data.clipboard.items.map((c) => (
              <button
                key={c.id}
                className="panel-chip"
                title={c.text}
                onClick={() => send({ cmd: "clipboard_paste", id: c.id })}
              >
                {c.text.slice(0, 40)}
              </button>
            ))}
          </div>
        ) : (
          <Empty what="clipboard history" />
        )}
      </section>

      <section className="panel" aria-label="Plans">
        <h2>Plans</h2>
        <div className="panel-body">
          {data.plans?.todos?.length ? (
            <ul style={{ listStyle: "none", display: "grid", gap: 6 }}>
              {data.plans.todos.map((t) => (
                <li key={t.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!t.done}
                    aria-label={`Done: ${t.text}`}
                    onChange={() => send({ cmd: "todo_toggle", id: t.id })}
                  />
                  <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty what="to-dos — ask Pico to remember something" />
          )}
          {!!data.plans?.schedules?.length && (
            <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 12 }}>
              {data.plans.schedules.map((s) => (
                <li key={s.id} style={{ fontSize: 13 }}>
                  ⏰ “{s.prompt}” — {s.schedule}{" "}
                  <span style={{ color: s.enabled ? "var(--accent)" : "var(--fg-muted)" }}>
                    {s.enabled ? "on" : "off"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!!data.plans?.fired?.length && (
            <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 12 }}>
              {data.plans.fired.slice(-3).map((f, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  ✓ “{f.prompt}”: {f.result}
                </li>
              ))}
            </ul>
          )}
          {!!data.plans?.circle_results?.length && (
            <ul style={{ listStyle: "none", display: "grid", gap: 6, marginTop: 12 }}>
              {data.plans.circle_results.slice(-3).map((r, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  🔍 {r.answer}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel" aria-label="Apps">
        <h2>Apps</h2>
        {data.apps?.pinned?.length || data.apps?.recent?.length ? (
          <div className="panel-grid">
            {[...(data.apps.pinned ?? []), ...(data.apps.recent ?? [])].map((a, i) => (
              <button
                key={`${a}-${i}`}
                className="panel-chip"
                onClick={() => send({ cmd: "panel_action", panel: "apps", action: "open", app: a })}
              >
                {a}
              </button>
            ))}
          </div>
        ) : (
          <Empty what="pinned apps yet — ask Pico to open something first" />
        )}
      </section>

      <section className="panel" aria-label="Wallpapers">
        <h2>Wallpapers</h2>
        {data.wallpapers?.items?.length ? (
          <div className="panel-grid">
            {data.wallpapers.items.map((w) => (
              <button
                key={w.id}
                className="panel-chip"
                onClick={() =>
                  send({ cmd: "panel_action", panel: "wallpapers", action: "set", id: w.id })
                }
              >
                {w.name}
              </button>
            ))}
          </div>
        ) : (
          <Empty what="wallpapers" />
        )}
      </section>

      <section className="panel" aria-label="Settings">
        <h2>Settings</h2>
        <div className="panel-body" style={{ display: "flex", gap: 8 }}>
          <button className="btn accent" onClick={() => openSettingsWindow().catch(() => {})}>
            Open Settings
          </button>
          <button className="btn" onClick={onCollapse}>
            Collapse
          </button>
        </div>
      </section>
    </>
  );
}
