import { html } from "../htm.js";
import { dbGet, dbGetAllByIndex, dbPut, dbDelete, uuid } from "../lib/db.js";
import { fmtData } from "../lib/format.js";
import { fileToCompressedDataURL, resolveImageSrc } from "../lib/image.js";
import { syncTask, syncList, pushPendingDeletes, syncAll } from "../lib/sync.js";
import { finalizeList } from "../lib/tasks.js";
import { useUi } from "../context/UiContext.js";
import { TaskImage } from "./TaskImage.js";
import { IconCamera, IconTrash, IconEdit } from "./Icons.js";

const React = window.React;
const { useState, useEffect, useRef, useCallback } = React;

export function ListDetailView({ listId, isAdmin, onBack, onChanged, onResolve, refreshKey }) {
  const { toast } = useUi();
  const [list, setList] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [composerAberto, setComposerAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [foto, setFoto] = useState(null);
  const [salvandoTarefa, setSalvandoTarefa] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const fileRef = useRef(null);

  const carregar = useCallback(async () => {
    const l = await dbGet("lists", listId);
    const t = await dbGetAllByIndex("tasks", "listId", listId);
    t.sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    setList(l || null);
    setTasks(t);
  }, [listId]);

  // Recarrega os dados da lista quando ela muda ou depois de uma
  // sincronização — mas nunca mexe no que está sendo digitado no
  // formulário de adicionar tarefa (ele vive numa state separada).
  useEffect(() => { carregar(); }, [carregar, refreshKey]);

  // Restaura um rascunho de tarefa em andamento para esta lista (se
  // existir) — evita perder foto/texto já preenchidos se a página
  // recarregar sozinha (ex.: o navegador descarrega a aba ao usar a
  // câmera). Só roda quando a lista muda, não a cada atualização.
  useEffect(() => {
    (async () => {
      const rascunho = await dbGet("config", "rascunhoTarefa");
      if (rascunho && rascunho.value && rascunho.value.listId === listId) {
        setComposerAberto(true);
        setTexto(rascunho.value.texto || "");
        setFoto(rascunho.value.imagem || null);
      } else {
        setComposerAberto(false);
        setTexto("");
        setFoto(null);
      }
    })();
    // eslint-disable-next-line
  }, [listId]);

  const salvarRascunho = useCallback(async (novoTexto, novaFoto) => {
    if (!novaFoto && !(novoTexto || "").trim()) {
      await dbDelete("config", "rascunhoTarefa");
      return;
    }
    await dbPut("config", { key: "rascunhoTarefa", value: { listId, texto: novoTexto, imagem: novaFoto } });
  }, [listId]);

  async function escolherFoto(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const dataUrl = await fileToCompressedDataURL(file);
    setFoto(dataUrl);
    salvarRascunho(texto, dataUrl);
  }

  function mudarTexto(v) {
    setTexto(v);
    salvarRascunho(v, foto);
  }

  async function cancelarComposer() {
    setComposerAberto(false);
    setTexto("");
    setFoto(null);
    await dbDelete("config", "rascunhoTarefa");
  }

  async function salvarTarefa() {
    const t = texto.trim();
    if (!foto) { toast("Adicione uma foto para a tarefa."); return; }
    if (!t) { toast("Descreva do que se trata."); return; }
    setSalvandoTarefa(true);

    const now = new Date().toISOString();
    const task = {
      id: uuid(), listId, texto: t, imagemCriacao: foto,
      imagemResolucao: null, status: "pendente", criadoEm: now, resolvidoEm: null, sincronizado: false,
      imagemCriacaoEnviada: false, imagemResolucaoEnviada: false
    };
    await dbPut("tasks", task);
    syncTask(task);

    if (list && list.status === "concluida") {
      const listaAtualizada = { ...list, status: "aberta", sincronizado: false };
      await dbPut("lists", listaAtualizada);
      syncList(listaAtualizada);
    }

    await dbDelete("config", "rascunhoTarefa");
    toast("Tarefa adicionada.");
    setSalvandoTarefa(false);
    setTexto("");
    setFoto(null);
    setComposerAberto(false);
    carregar();
    if (onChanged) onChanged();
  }

  async function excluirTarefa(taskId) {
    if (!isAdmin) return;
    const confirmado = confirm("Excluir esta tarefa? Ela some deste dispositivo e da planilha, para todo mundo.");
    if (!confirmado) return;
    const task = tasks.find((t) => t.id === taskId);
    await dbDelete("tasks", taskId);
    await dbPut("pendingDeletes", { id: taskId, tipo: "tarefa" });
    if (task) await finalizeList(task.listId);
    toast("Tarefa excluída.");
    carregar();
    pushPendingDeletes();
    if (onChanged) onChanged();
  }

  function abrirRenomear() {
    if (!isAdmin || !list) return;
    setNovoNome(list.nome);
    setRenomeando(true);
  }

  async function salvarNome() {
    const nome = novoNome.trim();
    if (!nome || !list) { setRenomeando(false); return; }
    const listaAtualizada = { ...list, nome, sincronizado: false };
    await dbPut("lists", listaAtualizada);
    syncList(listaAtualizada);
    setList(listaAtualizada);
    setRenomeando(false);
    if (onChanged) onChanged();
  }

  async function excluirListaAtual() {
    if (!isAdmin || !list) return;
    const confirmado = confirm(`Excluir a lista "${list.nome}"? Ela e suas tarefas somem deste dispositivo e da planilha, para todo mundo.`);
    if (!confirmado) return;
    for (const t of tasks) await dbDelete("tasks", t.id);
    await dbDelete("lists", listId);
    await dbPut("pendingDeletes", { id: listId, tipo: "lista" });
    toast("Lista excluída.");
    pushPendingDeletes();
    if (onChanged) onChanged();
    onBack();
  }

  async function resincronizar() {
    if (!isAdmin || !list) return;
    setSincronizando(true);
    let listaAtualizada = { ...list, sincronizado: false, ausenteDaPlanilha: false };
    await dbPut("lists", listaAtualizada);
    for (const t of tasks) {
      const tarefa = { ...t };
      if (tarefa.imagemCriacao && tarefa.imagemCriacao.indexOf("data:") !== 0) {
        const dataUri = await resolveImageSrc(tarefa.imagemCriacao);
        if (dataUri) tarefa.imagemCriacao = dataUri;
      }
      if (tarefa.imagemResolucao && tarefa.imagemResolucao.indexOf("data:") !== 0) {
        const dataUri = await resolveImageSrc(tarefa.imagemResolucao);
        if (dataUri) tarefa.imagemResolucao = dataUri;
      }
      tarefa.sincronizado = false;
      tarefa.imagemCriacaoEnviada = false;
      tarefa.imagemResolucaoEnviada = false;
      await dbPut("tasks", tarefa);
    }
    await syncAll();
    toast("Lista sincronizada com a planilha novamente.");
    setSincronizando(false);
    carregar();
    if (onChanged) onChanged();
  }

  async function exportarPDF(somentePendentes) {
    const alvo = somentePendentes ? tasks.filter((t) => t.status === "pendente") : tasks;
    if (!alvo.length) {
      toast(somentePendentes ? "Não há tarefas pendentes para exportar." : "Esta lista não tem tarefas.");
      return;
    }
    toast("Preparando PDF…");
    const imagens = await Promise.all(alvo.map((t) => resolveImageSrc(t.imagemCriacao)));
    const agora = new Date();
    const dataExport = agora.toLocaleDateString("pt-BR") + " " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const corpo = alvo.map((t, i) => {
      const foto = imagens[i]
        ? `<img class="print-task-img" src="${imagens[i]}" alt="">`
        : `<div class="print-task-img print-task-img-empty">Sem foto</div>`;
      const statusTxt = t.status === "resolvida" ? "Resolvida" : "Pendente";
      return `
        <div class="print-task">
          <div class="print-task-head">
            <span class="print-task-num">Tarefa ${i + 1}</span>
            <span class="print-task-status">${statusTxt}</span>
          </div>
          ${foto}
          <div class="print-task-text">${escapeHtml(t.texto)}</div>
        </div>`;
    }).join("");

    const printSheet = document.getElementById("printSheet");
    printSheet.innerHTML = `
      <div class="print-header">
        <h1>${escapeHtml(list ? list.nome : "")}</h1>
        <div class="print-meta">${somentePendentes ? "Tarefas pendentes" : "Todas as tarefas"} · ${alvo.length} tarefa(s) · exportado em ${dataExport}</div>
      </div>
      <div class="print-tasks">${corpo}</div>`;

    setTimeout(() => window.print(), 250);
  }

  if (!list) return html`<main><div className="back-row"><button className="icon-btn" onClick=${onBack}>‹</button></div></main>`;

  const pendentes = tasks.filter((t) => t.status === "pendente").length;
  const resolvidas = tasks.length - pendentes;
  const ausente = !!list.ausenteDaPlanilha;
  const vazia = !ausente && tasks.length === 0;
  const mostrarBotaoRodape = isAdmin && !ausente && !vazia;

  return html`
    <main>
      <div className="back-row">
        <button className="icon-btn" aria-label="Voltar" onClick=${onBack}>‹</button>
        ${renomeando ? html`
          <input type="text" className="rename-input" value=${novoNome} autoFocus
            onInput=${(e) => setNovoNome(e.target.value)}
            onKeyDown=${(e) => { if (e.key === "Enter") salvarNome(); if (e.key === "Escape") setRenomeando(false); }} />
          <button className="icon-btn" aria-label="Salvar nome" onClick=${salvarNome}>✓</button>
        ` : html`
          <h2>${list.nome}</h2>
          ${isAdmin ? html`<button className="icon-btn" aria-label="Renomear lista" onClick=${abrirRenomear}><${IconEdit} /></button>` : null}
        `}
      </div>
      <div className="detail-meta-row">
        <span className=${"status-badge " + list.status}>${list.status === "concluida" ? "concluída" : "aberta"}</span>
        <span className="note" style=${{ margin: 0 }}>${fmtData(list.criadoEm)} · ${resolvidas}/${tasks.length} resolvidas</span>
      </div>

      ${ausente ? html`
        <div className="alert-box">
          <p>Esta lista não existe mais na planilha. Deseja sincronizar ou excluir?</p>
          <div className="btn-row">
            <button className="btn btn-ghost" disabled=${sincronizando} onClick=${resincronizar}>${sincronizando ? "Sincronizando…" : "Sincronizar"}</button>
            <button className="btn btn-danger" onClick=${excluirListaAtual}>Excluir</button>
          </div>
        </div>
      ` : null}

      ${vazia ? html`
        <div className="alert-box neutral">
          <p>Esta lista não tem mais tarefas. Você pode adicionar uma nova ou excluir a lista.</p>
          <button className="btn btn-danger" onClick=${excluirListaAtual}>Excluir lista</button>
        </div>
      ` : null}

      <div className="detail-actions">
        ${pendentes > 0 ? html`<button className="btn btn-success" onClick=${() => onResolve(listId)}>Resolver pendências (${pendentes})</button>` : null}
        ${isAdmin ? html`<button className="btn btn-ghost" onClick=${() => setComposerAberto(true)}>+ Adicionar tarefa</button>` : null}
      </div>

      ${composerAberto ? html`
        <div className="composer inline">
          <label className=${"shot-trigger" + (foto ? " has-image" : "")}>
            ${foto ? html`<img src=${foto} alt="Prévia da foto" />` : html`
              <${IconCamera} />
              <span>Tirar ou anexar uma foto</span>
            `}
            <input className="shot-input" type="file" accept="image/*" capture="environment" ref=${fileRef} onChange=${escolherFoto} />
          </label>
          <label className="field-label" htmlFor="detailAddText">Descrição</label>
          <textarea id="detailAddText" placeholder="O que precisa ser resolvido?"
            value=${texto} onInput=${(e) => mudarTexto(e.target.value)}></textarea>
          <div className="btn-row">
            <button className="btn btn-ghost" onClick=${cancelarComposer}>Cancelar</button>
            <button className="btn btn-primary" disabled=${salvandoTarefa} onClick=${salvarTarefa}>${salvandoTarefa ? "Adicionando…" : "Adicionar"}</button>
          </div>
        </div>
      ` : null}

      <div className="section-label">EXPORTAR PARA PDF</div>
      <p className="note" style=${{ marginTop: "-4px" }}>Gera um documento para imprimir ou salvar como PDF, com a foto de registro de cada tarefa (sem a foto de resolução) — útil para quem não tem o app à mão.</p>
      <div className="detail-actions">
        <button className="btn btn-ghost" onClick=${() => exportarPDF(false)}>Exportar todas as tarefas</button>
        <button className="btn btn-ghost" onClick=${() => exportarPDF(true)}>Exportar apenas pendentes</button>
      </div>

      <div className="section-label">TAREFAS</div>
      ${tasks.length === 0 ? html`<div className="empty">Nenhuma tarefa nesta lista ainda.</div>` :
        tasks.map((t) => {
          const resolvida = t.status === "resolvida";
          const quando = resolvida ? "resolvida em " + fmtData(t.resolvidoEm) : "criada em " + fmtData(t.criadoEm);
          return html`
            <div key=${t.id} className="detail-task">
              <div className="dt-images">
                <div className="dt-img-col">
                  ${resolvida && t.imagemResolucao ? html`<span className="dt-img-label">Registro</span>` : null}
                  <${TaskImage} value=${t.imagemCriacao} alt="Foto de registro" />
                </div>
                ${resolvida && t.imagemResolucao ? html`
                  <div className="dt-img-col">
                    <span className="dt-img-label">Confirmação</span>
                    <${TaskImage} value=${t.imagemResolucao} alt="Foto de confirmação" />
                  </div>
                ` : null}
              </div>
              ${isAdmin ? html`
                <button className="dt-delete" aria-label="Excluir tarefa" onClick=${() => excluirTarefa(t.id)}>
                  <${IconTrash} />
                </button>
              ` : null}
              <div className="dt-body">
                <div className="dt-text">${t.texto}</div>
                <div className="dt-meta">
                  <span className=${"status-badge " + t.status}>${resolvida ? "resolvida" : "pendente"}</span>
                  <span className="when">${quando}</span>
                </div>
              </div>
            </div>
          `;
        })
      }

      ${mostrarBotaoRodape ? html`<button className="btn btn-danger" onClick=${excluirListaAtual}>Excluir lista</button>` : null}
    </main>
  `;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}
