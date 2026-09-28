import { html } from "../htm.js";
import { dbGetAll, dbGetAllByIndex } from "../lib/db.js";
import { fmtData } from "../lib/format.js";
import { IconPlus, IconCheck } from "./Icons.js";

const React = window.React;
const { useState, useEffect, useCallback } = React;

export function MenuView({ isAdmin, onCreate, onResolve, onOpenList, refreshKey }) {
  const [linhas, setLinhas] = useState(null); // null = carregando

  const carregar = useCallback(async () => {
    const lists = await dbGetAll("lists");
    if (!lists.length) { setLinhas([]); return; }
    lists.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    const linhasCarregadas = await Promise.all(lists.map(async (l) => {
      const tasks = await dbGetAllByIndex("tasks", "listId", l.id);
      const total = tasks.length;
      const resolvidas = tasks.filter((t) => t.status === "resolvida").length;
      const semSync = !l.sincronizado || tasks.some((t) => !t.sincronizado);
      return { lista: l, total, resolvidas, semSync };
    }));
    setLinhas(linhasCarregadas);
  }, []);

  useEffect(() => { carregar(); }, [carregar, refreshKey]);

  const lead = isAdmin
    ? "Crie uma lista de tarefas com fotos, ou resolva pendências registrando a foto de confirmação. Tudo é compartilhado — visível para todos, em qualquer dispositivo."
    : "Resolva pendências registrando a foto de confirmação, ou exporte uma lista em PDF.";

  return html`
    <main>
      <h1>Bom trabalho.</h1>
      <p className="lead">${lead}</p>

      <div className="menu-actions" style=${isAdmin ? undefined : { gridTemplateColumns: "1fr" }}>
        ${isAdmin ? html`
          <button className="menu-tile create" onClick=${onCreate}>
            <span className="ico"><${IconPlus} /></span>
            <span className="label">Criar lista de tarefas</span>
            <span className="hint">Fotografe e descreva o que precisa ser feito</span>
          </button>
        ` : null}
        <button className="menu-tile solve" onClick=${onResolve}>
          <span className="ico" style=${{ color: "var(--success)" }}><${IconCheck} /></span>
          <span className="label">Resolver lista de tarefas</span>
          <span className="hint">Passe pelas tarefas e confirme com uma foto</span>
        </button>
      </div>

      <div className="section-label">LISTAS GERAIS</div>
      ${linhas === null ? html`<div className="empty">Carregando…</div>` :
        linhas.length === 0 ? html`<div className="empty">Nenhuma lista ainda. Toque em "Criar lista de tarefas" para começar.</div>` :
        linhas.map(({ lista: l, total, resolvidas, semSync }) => {
          const vazia = !l.ausenteDaPlanilha && total === 0;
          const classes = "list-row status-" + l.status + (l.ausenteDaPlanilha ? " ausente" : "");
          return html`
            <div key=${l.id} className=${classes} onClick=${() => onOpenList(l.id)}>
              <div className="info">
                <div className="name">${l.nome}</div>
                <div className="meta">${fmtData(l.criadoEm)}</div>
              </div>
              ${vazia ? html`<span className="status-badge vazia">vazia</span>` : null}
              ${l.ausenteDaPlanilha ? html`<span className="status-badge ausente">local</span>` : null}
              <span className="count">${resolvidas}/${total}</span>
              <span
                className=${"dot sync-dot " + (semSync ? "pending" : "ok")}
                title=${semSync ? "aguardando sincronização" : "sincronizado"}
              ></span>
            </div>
          `;
        })
      }
    </main>
  `;
}
