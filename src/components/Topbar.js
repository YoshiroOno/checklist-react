import { html } from "../htm.js";
import { IconSync, IconSettings } from "./Icons.js";

const LABELS = {
  sincronizado: "sincronizado",
  sincronizando: "sincronizando…",
  pendente: "pendente",
  local: "somente local",
  offline: "offline"
};
const DOT_CLASS = {
  sincronizado: "ok",
  pendente: "pending",
  offline: "off"
};

export function Topbar({ status, onSyncNow, onOpenSettings }) {
  const pillClass = "sync-pill" + (status === "sincronizando" ? " sincronizando" : "");
  const dotClass = "dot" + (DOT_CLASS[status] ? " " + DOT_CLASS[status] : "");

  return html`
    <header className="topbar">
      <div className="brand">
        <span className="mark">Checklist</span>
        <span className="sub">listas de tarefas</span>
      </div>
      <div className="topbar-actions">
        <button
          className=${pillClass} type="button"
          aria-label="Sincronizar agora" title="Toque para sincronizar agora"
          onClick=${onSyncNow}
        >
          <${IconSync} />
          <span className=${dotClass}></span><span>${LABELS[status] || "local"}</span>
        </button>
        <button className="icon-btn" aria-label="Configurações" title="Configurações" onClick=${onOpenSettings}>
          <${IconSettings} />
        </button>
      </div>
    </header>
  `;
}
