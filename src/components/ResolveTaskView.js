import { html } from "../htm.js";
import { dbGet, dbGetAllByIndex, dbPut } from "../lib/db.js";
import { fmtData } from "../lib/format.js";
import { fileToCompressedDataURL } from "../lib/image.js";
import { syncTask } from "../lib/sync.js";
import { finalizeList } from "../lib/tasks.js";
import { useUi } from "../context/UiContext.js";
import { TaskImage } from "./TaskImage.js";
import { IconCheckCircle } from "./Icons.js";

const React = window.React;
const { useState, useEffect } = React;

export function ResolveTaskView({ listId, onBack, onChanged }) {
  const { toast } = useUi();
  const [nomeLista, setNomeLista] = useState("Lista");
  const [fila, setFila] = useState(null); // null = carregando
  const [indice, setIndice] = useState(0);
  const [foto, setFoto] = useState(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await dbGet("lists", listId);
      const tasks = await dbGetAllByIndex("tasks", "listId", listId);
      const pendentes = tasks.filter((t) => t.status === "pendente");
      setNomeLista(list ? list.nome : "Lista");
      if (!pendentes.length) {
        await finalizeList(listId);
        toast("Essa lista já está totalmente resolvida.");
        onBack();
        return;
      }
      setFila(pendentes);
      setIndice(0);
    })();
    // eslint-disable-next-line
  }, [listId]);

  async function escolherFoto(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setFoto(await fileToCompressedDataURL(file));
  }

  async function confirmar() {
    if (!foto || !fila) return;
    setConfirmando(true);
    const task = fila[indice];
    const now = new Date().toISOString();
    task.status = "resolvida";
    task.imagemResolucao = foto;
    task.imagemResolucaoEnviada = false; // é uma foto nova — força reenvio mesmo se já tinha sido resolvida antes
    task.resolvidoEm = now;
    task.sincronizado = false;
    await dbPut("tasks", task);
    syncTask(task).then(() => onChanged && onChanged());

    const novaFila = fila.slice();
    novaFila.splice(indice, 1);
    let novoIndice = indice;
    if (novoIndice >= novaFila.length) novoIndice = Math.max(0, novaFila.length - 1);
    if (!novaFila.length) await finalizeList(listId);

    setFila(novaFila);
    setIndice(novoIndice);
    setFoto(null);
    setConfirmando(false);
    if (onChanged) onChanged();
  }

  if (fila === null) return html`<main><div className="back-row"><button className="icon-btn" onClick=${onBack}>‹</button><h2>${nomeLista}</h2></div></main>`;

  if (!fila.length) {
    return html`
      <main>
        <div className="back-row"><button className="icon-btn" onClick=${onBack}>‹</button><h2>${nomeLista}</h2></div>
        <div className="done-screen">
          <div className="ico" style=${{ color: "var(--success)" }}><${IconCheckCircle} /></div>
          <h2>Lista concluída</h2>
          <p className="lead">Todas as tarefas foram resolvidas e fotografadas.</p>
          <button className="btn btn-primary" onClick=${onBack}>Voltar ao menu</button>
        </div>
      </main>
    `;
  }

  const task = fila[indice];

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        <h2>${nomeLista}</h2>
      </div>
      <div className="resolve-nav">
        ${fila.map((t, i) => html`
          <button key=${t.id} className=${"resolve-chip" + (i === indice ? " atual" : "")} onClick=${() => { setIndice(i); setFoto(null); }}>
            ${i + 1}
          </button>
        `)}
      </div>
      <div className="progress-line">${fila.length} pendente(s) · toque em um número acima para pular direto para ela</div>
      <div className="task-card">
        <${TaskImage} className="ref-image" value=${task.imagemCriacao} alt="Foto da tarefa" />
        <div className="ref-body">
          <div className="ref-tag">REGISTRADO EM ${fmtData(task.criadoEm)}</div>
          <div className="ref-text">${task.texto}</div>
        </div>
      </div>
      <div className="section-label">FOTO DE CONFIRMAÇÃO</div>
      <div className="confirm-zone">
        ${foto ? html`
          <img src=${foto} alt="Foto de confirmação" />
          <label className="btn btn-ghost" style=${{ display: "inline-flex" }}>
            Tirar outra foto
            <input type="file" accept="image/*" capture="environment" style=${{ display: "none" }} onChange=${escolherFoto} />
          </label>
        ` : html`
          <div className="cz-label">Fotografe o resultado para confirmar que foi resolvido</div>
          <label className="btn btn-ghost" style=${{ display: "inline-flex" }}>
            Tirar foto de confirmação
            <input type="file" accept="image/*" capture="environment" style=${{ display: "none" }} onChange=${escolherFoto} />
          </label>
        `}
      </div>
      <button className="btn btn-success" disabled=${!foto || confirmando} onClick=${confirmar}>
        ${confirmando ? "Confirmando…" : "Confirmar resolução"}
      </button>
    </main>
  `;
}
