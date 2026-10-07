import { html } from "../htm.js";
import { dbPut, uuid } from "../lib/db.js";
import { syncAll } from "../lib/sync.js";
import { extrairTarefasDoPdf } from "../lib/pdfImport.js";
import { useUi } from "../context/UiContext.js";
import { IconX } from "./Icons.js";

const React = window.React;
const { useState } = React;

function nomePadrao() {
  const d = new Date();
  return "Lista importada " + d.toLocaleDateString("pt-BR");
}

export function ImportPdfView({ onBack, onSaved }) {
  const { toast } = useUi();
  const [nome, setNome] = useState(nomePadrao());
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [staged, setStaged] = useState([]);
  const [salvando, setSalvando] = useState(false);

  async function escolherArquivo(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") { toast("Escolha um arquivo PDF."); return; }

    setProcessando(true);
    setStaged([]);
    try {
      const tarefas = await extrairTarefasDoPdf(file, (atual, total) => setProgresso({ atual, total }));
      setStaged(tarefas.map((t) => ({ id: uuid(), texto: t.texto, imagem: t.imagemDataUrl })));
      if (!tarefas.length) toast("Esse PDF não tem páginas para importar.");
    } catch (err) {
      toast("Não consegui ler esse PDF. Confirme se o arquivo não está corrompido.");
    }
    setProcessando(false);
    setProgresso(null);
  }

  function mudarTexto(id, valor) {
    setStaged((s) => s.map((t) => (t.id === id ? { ...t, texto: valor } : t)));
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
        id: t.id, listId, texto: (t.texto || "").trim() || "(sem descrição)", imagemCriacao: t.imagem,
        imagemResolucao: null, status: "pendente", criadoEm: now, resolvidoEm: null, sincronizado: false,
        imagemCriacaoEnviada: false, imagemResolucaoEnviada: false
      });
    }
    toast(`Lista importada com ${staged.length} tarefa(s).`);
    syncAll();
    setSalvando(false);
    onSaved();
  }

  const podeSalvar = nome.trim() && staged.length > 0 && !salvando;

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        <h2>Importar lista de um PDF</h2>
      </div>
      <p className="lead">
        Escolha o PDF do relatório (uma foto por página, com o texto do que precisa ser corrigido logo abaixo).
        Eu separo cada página numa tarefa — revise antes de salvar.
      </p>

      <label className="btn btn-ghost" style=${{ display: "inline-flex" }}>
        ${processando
          ? (progresso ? `Lendo página ${progresso.atual} de ${progresso.total}…` : "Lendo PDF…")
          : "Escolher arquivo PDF"}
        <input type="file" accept="application/pdf" style=${{ display: "none" }}
          disabled=${processando} onChange=${escolherArquivo} />
      </label>

      ${staged.length ? html`
        <label className="field-label" htmlFor="importListName">Nome da lista</label>
        <input type="text" id="importListName" value=${nome} onInput=${(e) => setNome(e.target.value)} />

        <div className="section-label">TAREFAS ENCONTRADAS (${staged.length})</div>
        ${staged.map((t) => html`
          <div key=${t.id} className="staged-task import-task">
            <img src=${t.imagem} alt="" />
            <textarea className="import-text" value=${t.texto}
              placeholder="O que precisa ser corrigido?"
              onInput=${(e) => mudarTexto(t.id, e.target.value)}></textarea>
            <button className="rm" aria-label="Remover" onClick=${() => removerTarefa(t.id)}><${IconX} /></button>
          </div>
        `)}

        <button className="btn btn-primary" disabled=${!podeSalvar} onClick=${salvarLista}>
          ${salvando ? "Salvando…" : "Salvar lista importada"}
        </button>
      ` : null}
    </main>
  `;
}
