import { html } from "../htm.js";
import { dbGetAll, dbGetAllByIndex } from "../lib/db.js";
import { fmtData } from "../lib/format.js";

const React = window.React;
const { useState, useEffect } = React;

export function ResolveSelectView({ onBack, onPick, refreshKey }) {
  const [linhas, setLinhas] = useState(null);

  useEffect(() => {
    (async () => {
      const lists = await dbGetAll("lists");
      const abertas = lists.filter((l) => l.status === "aberta");
      const carregadas = await Promise.all(abertas.map(async (l) => {
        const tasks = await dbGetAllByIndex("tasks", "listId", l.id);
        const total = tasks.length;
        const resolvidas = tasks.filter((t) => t.status === "resolvida").length;
        return { lista: l, total, resolvidas };
      }));
      setLinhas(carregadas);
    })();
  }, [refreshKey]);

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        <h2>Resolver lista de tarefas</h2>
      </div>
      <p className="lead">Escolha uma lista com tarefas pendentes.</p>
      ${linhas === null ? null :
        linhas.length === 0 ? html`<div className="empty">Nenhuma lista pendente. Crie uma nova lista de tarefas primeiro.</div>` :
        linhas.map(({ lista: l, total, resolvidas }) => html`
          <div key=${l.id} className="list-row status-aberta" onClick=${() => onPick(l.id)}>
            <div className="info">
              <div className="name">${l.nome}</div>
              <div className="meta">${fmtData(l.criadoEm)}</div>
            </div>
            <span className="count">${resolvidas}/${total}</span>
          </div>
        `)
      }
    </main>
  `;
}
