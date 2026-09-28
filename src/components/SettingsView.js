import { html } from "../htm.js";
import { dbGet, dbPut } from "../lib/db.js";
import { WEB_APP_URL, getWebAppUrl } from "../lib/sync.js";
import { limparSessao } from "../lib/auth.js";
import { useUi } from "../context/UiContext.js";

const React = window.React;
const { useState, useEffect } = React;

export function SettingsView({ session, isAdmin, onBack, onSyncNow, onLogout }) {
  const { toast } = useUi();
  const [url, setUrl] = useState("");

  useEffect(() => { (async () => setUrl(await getWebAppUrl()))(); }, []);

  const somenteLeitura = !isAdmin || !!WEB_APP_URL;
  const nota = !isAdmin
    ? "Você não tem permissão para alterar a URL de sincronização."
    : WEB_APP_URL
    ? 'Este app já está conectado à planilha (a URL foi definida diretamente no código pelo responsável pelo app). Não é preciso configurar nada aqui.'
    : 'Cole aqui a URL gerada ao publicar o script como "App da Web" (veja o arquivo LEIAME-configuracao.md). Os dados ficam salvos neste dispositivo mesmo sem essa URL — a sincronização com a planilha é feita quando ela estiver configurada e houver conexão.';

  async function salvarUrl() {
    if (!isAdmin) { toast("Sem permissão para alterar a sincronização."); return; }
    await dbPut("config", { key: "webAppUrl", value: url.trim() });
    toast(url.trim() ? "URL salva." : "URL removida.");
    onSyncNow();
  }

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        <h2>Configurações</h2>
      </div>

      <div className="settings-box">
        <label className="field-label" htmlFor="webAppUrl">URL do Google Apps Script (Web App)</label>
        <input type="url" id="webAppUrl" placeholder="https://script.google.com/macros/s/.../exec"
          value=${url} disabled=${somenteLeitura} onInput=${(e) => setUrl(e.target.value)} />
        ${!somenteLeitura ? html`<button className="btn btn-primary" onClick=${salvarUrl}>Salvar</button>` : null}
      </div>
      <p className="note" style=${{ marginTop: "-8px" }}>${nota}</p>

      <button className="btn btn-ghost" onClick=${onSyncNow}>Sincronizar agora</button>

      <div className="section-label">SESSÃO</div>
      <p className="note" style=${{ marginTop: "-4px" }}>
        ${session ? `Conectado como ${session.usuario} (${isAdmin ? "administrativo" : "comum"}).` : ""}
      </p>
      <button className="btn btn-danger" onClick=${onLogout}>Sair</button>
    </main>
  `;
}
