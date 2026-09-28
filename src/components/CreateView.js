import { html } from "../htm.js";
import { dbPut, uuid } from "../lib/db.js";
import { fileToCompressedDataURL } from "../lib/image.js";
import { syncAll } from "../lib/sync.js";
import { useUi } from "../context/UiContext.js";
import { IconCamera, IconX } from "./Icons.js";

const React = window.React;
const { useState, useRef } = React;

export function CreateView({ onBack, onSaved }) {
  const { toast } = useUi();
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState(null);
  const [staged, setStaged] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const fileRef = useRef(null);

  async function escolherFoto(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await fileToCompressedDataURL(file);
    setFoto(dataUrl);
  }

  function adicionarTarefa() {
    if (!foto) { toast("Adicione uma foto para a tarefa."); return; }
    if (!texto.trim()) { toast("Descreva do que se trata."); return; }
    setStaged((s) => [...s, { id: uuid(), texto: texto.trim(), imagem: foto }]);
    setFoto(null);
    setTexto("");
  }

  function removerTarefa(id) {
    setStaged((s) => s.filter((t) => t.id !== id));
  }

  async function salvarLista() {
    if (!nome.trim() || !staged.length) return;
    setSalvando(true);
    const now = new Date().toISOString();
    const listId = uuid();
    const list = { id: listId, nome: nome.trim(), criadoEm: now, status: "aberta", sincronizado: false };
    await dbPut("lists", list);
    for (const t of staged) {
      await dbPut("tasks", {
        id: t.id, listId, texto: t.texto, imagemCriacao: t.imagem, imagemResolucao: null,
        status: "pendente", criadoEm: now, resolvidoEm: null, sincronizado: false,
        imagemCriacaoEnviada: false, imagemResolucaoEnviada: false
      });
    }
    toast(`Lista salva com ${staged.length} tarefa(s).`);
    syncAll();
    setSalvando(false);
    onSaved();
  }

  const podeSalvar = nome.trim() && staged.length > 0 && !salvando;

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        <h2>Nova lista de tarefas</h2>
      </div>

      <label className="field-label" htmlFor="listName">Nome da lista</label>
      <input type="text" id="listName" placeholder="Ex.: Vistoria — Galpão 3"
        value=${nome} onInput=${(e) => setNome(e.target.value)} />

      <div className="section-label">ADICIONAR TAREFA</div>
      <div className="composer">
        <label className=${"shot-trigger" + (foto ? " has-image" : "")}>
          ${foto ? html`<img src=${foto} alt="Prévia da foto" />` : html`
            <${IconCamera} />
            <span>Tirar ou anexar uma foto</span>
          `}
          <input className="shot-input" type="file" accept="image/*" capture="environment" ref=${fileRef} onChange=${escolherFoto} />
        </label>
        <label className="field-label" htmlFor="taskText">Descrição</label>
        <textarea id="taskText" placeholder="O que precisa ser resolvido?"
          value=${texto} onInput=${(e) => setTexto(e.target.value)}></textarea>
        <button className="btn btn-ghost" onClick=${adicionarTarefa}>Adicionar tarefa à lista</button>
      </div>

      ${staged.length ? html`
        <div className="section-label">TAREFAS NESTA LISTA (${staged.length})</div>
        ${staged.map((t) => html`
          <div key=${t.id} className="staged-task">
            <img src=${t.imagem} alt="" />
            <div className="txt">${t.texto}</div>
            <button className="rm" aria-label="Remover" onClick=${() => removerTarefa(t.id)}><${IconX} /></button>
          </div>
        `)}
      ` : null}

      <button className="btn btn-primary" disabled=${!podeSalvar} onClick=${salvarLista}>
        ${salvando ? "Salvando…" : "Salvar lista"}
      </button>
    </main>
  `;
}
