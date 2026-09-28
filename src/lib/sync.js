import { dbGet, dbPut, dbDelete, dbGetAll } from "./db.js";

/* ============================================================
   CONFIGURAÇÃO — cole aqui a URL do seu Google Apps Script
   ============================================================
   1. Siga o LEIAME-configuracao.md para publicar o script como
      "App da Web" e copiar a URL gerada (termina em /exec).
   2. Cole essa URL entre as aspas abaixo.
   3. Salve o arquivo. Pronto — todo mundo que abrir este app já
      sincroniza direto com a planilha, sem precisar configurar nada.

   Deixe em branco ("") se ainda não tiver a URL; o app funciona
   normalmente offline e você pode configurá-la depois pela tela
   de Configurações dentro do próprio app.
   ============================================================ */
export const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyA5rR8ASTDuI7_S-9z5gwXYedAr4cV-nRICFIlWe_MGLMjtjr0LMxR5HfJpbUEjjmP/exec";

export async function getWebAppUrl() {
  if (WEB_APP_URL) return WEB_APP_URL; // definida diretamente no código — tem prioridade
  const c = await dbGet("config", "webAppUrl");
  return c ? c.value : "";
}

async function postToSheet(fields) {
  const url = await getWebAppUrl();
  if (!url) return { ok: false, reason: "no-url" };
  try {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v == null ? "" : String(v)));
    const res = await fetch(url, { method: "POST", body: fd });
    let data;
    try {
      data = await res.json();
    } catch (_) {
      data = { success: true };
    }
    return { ok: !!data.success, data };
  } catch (err) {
    return { ok: false, reason: "network", error: String(err) };
  }
}

export async function syncList(list) {
  const r = await postToSheet({
    tipo: "lista", id: list.id, nome: list.nome, criadoEm: list.criadoEm, status: list.status
  });
  if (r.ok) { list.sincronizado = true; await dbPut("lists", list); }
  return r.ok;
}

export async function syncTask(task) {
  // Só manda a imagem em base64 se ela ainda não foi confirmada como
  // enviada — evita recriar o arquivo no Drive toda vez que a tarefa é
  // resincronizada por outro motivo (ex: ao resolver, ou numa nova
  // tentativa depois de uma falha de rede).
  const enviarCriacao = !task.imagemCriacaoEnviada && task.imagemCriacao && task.imagemCriacao.indexOf("data:") === 0;
  const enviarResolucao = !task.imagemResolucaoEnviada && task.imagemResolucao && task.imagemResolucao.indexOf("data:") === 0;
  const r = await postToSheet({
    tipo: "tarefa", id: task.id, listId: task.listId, texto: task.texto, status: task.status,
    criadoEm: task.criadoEm, resolvidoEm: task.resolvidoEm || "",
    imagemCriacaoBase64: enviarCriacao ? task.imagemCriacao : "",
    imagemResolucaoBase64: enviarResolucao ? task.imagemResolucao : ""
  });
  if (r.ok) {
    task.sincronizado = true;
    if (enviarCriacao) task.imagemCriacaoEnviada = true;
    if (enviarResolucao) task.imagemResolucaoEnviada = true;
    await dbPut("tasks", task);
  }
  return r.ok;
}

export async function syncAll() {
  const url = await getWebAppUrl();
  if (!url) return false;
  const [lists, tasks] = await Promise.all([dbGetAll("lists"), dbGetAll("tasks")]);
  let allOk = true;
  for (const l of lists.filter((l) => !l.sincronizado)) { allOk = (await syncList(l)) && allOk; }
  for (const t of tasks.filter((t) => !t.sincronizado)) { allOk = (await syncTask(t)) && allOk; }
  allOk = (await pushPendingDeletes()) && allOk;
  return allOk;
}

// Envia para a planilha as exclusões de lista/tarefa feitas localmente (sem
// restrição de data — excluir é uma ação explícita do usuário). Enquanto
// não confirmado pelo servidor, o id continua na fila e o item não volta
// a aparecer localmente (veja o filtro em mergeRemoteData).
export async function pushPendingDeletes() {
  const url = await getWebAppUrl();
  if (!url) return true;
  const pendentes = await dbGetAll("pendingDeletes");
  let allOk = true;
  for (const p of pendentes) {
    const tipoRemoto = p.tipo === "tarefa" ? "excluirTarefa" : "excluirLista";
    const r = await postToSheet({ tipo: tipoRemoto, id: p.id });
    if (r.ok) await dbDelete("pendingDeletes", p.id);
    else allOk = false;
  }
  return allOk;
}

// Busca o estado completo (todas as listas/tarefas) direto da planilha,
// para que qualquer dispositivo enxergue o que foi feito nos outros.
export async function pullAll() {
  const url = await getWebAppUrl();
  if (!url) return false;
  try {
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    const res = await fetch(url + sep + "action=listarTudo");
    const data = await res.json();
    if (!data || !data.success) return false;
    await mergeRemoteData(data.listas || [], data.tarefas || []);
    return true;
  } catch (err) {
    return false;
  }
}

// Mescla os dados vindos da planilha com o banco local. Nunca sobrescreve
// uma lista/tarefa criada/editada localmente que ainda não foi enviada
// (sincronizado:false) — ela será enviada e só então substituída pela
// versão "oficial" na próxima sincronização.
// Se uma lista já sincronizada sumiu da planilha (por exemplo, alguém
// apagou a linha manualmente), ela NÃO é apagada sozinha — só fica
// marcada como "ausente da planilha", e o usuário decide o que fazer.
async function mergeRemoteData(listasRemotas, tarefasRemotas) {
  const [listasLocais, tarefasLocais, pendentesExclusao] = await Promise.all([
    dbGetAll("lists"), dbGetAll("tasks"), dbGetAll("pendingDeletes")
  ]);
  const idsPendentesListaExclusao = new Set(pendentesExclusao.filter((p) => p.tipo !== "tarefa").map((p) => p.id));
  const idsPendentesTarefaExclusao = new Set(pendentesExclusao.filter((p) => p.tipo === "tarefa").map((p) => p.id));
  const mapaListas = new Map(listasLocais.map((l) => [l.id, l]));
  const mapaTarefas = new Map(tarefasLocais.map((t) => [t.id, t]));

  // Ignora, na planilha, o que já foi apagado localmente e ainda não
  // teve a exclusão confirmada no servidor — senão o pull traria de volta.
  const listasRemotasValidas = listasRemotas.filter((rl) => !idsPendentesListaExclusao.has(rl.id));
  const tarefasRemotasValidas = tarefasRemotas.filter(
    (rt) => !idsPendentesListaExclusao.has(rt.listId) && !idsPendentesTarefaExclusao.has(rt.id)
  );

  for (const rl of listasRemotasValidas) {
    const local = mapaListas.get(rl.id);
    if (!local || local.sincronizado) {
      await dbPut("lists", {
        id: rl.id,
        nome: rl.nome || (local && local.nome) || "",
        criadoEm: rl.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
        status: rl.status || (local && local.status) || "aberta",
        sincronizado: true,
        ausenteDaPlanilha: false
      });
    }
  }

  for (const rt of tarefasRemotasValidas) {
    const local = mapaTarefas.get(rt.id);
    if (!local || local.sincronizado) {
      await dbPut("tasks", {
        id: rt.id,
        listId: rt.listId,
        texto: rt.texto || (local && local.texto) || "",
        status: rt.status || (local && local.status) || "pendente",
        criadoEm: rt.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
        resolvidoEm: rt.resolvidoEm || (local && local.resolvidoEm) || null,
        imagemCriacao: rt.fotoCriacaoId || (local && local.imagemCriacao) || null,
        imagemResolucao: rt.fotoResolucaoId || (local && local.imagemResolucao) || null,
        imagemCriacaoEnviada: !!rt.fotoCriacaoId || (local && local.imagemCriacaoEnviada) || false,
        imagemResolucaoEnviada: !!rt.fotoResolucaoId || (local && local.imagemResolucaoEnviada) || false,
        sincronizado: true
      });
    }
  }

  // Lista sincronizada que sumiu da planilha: só marca — quem decide se
  // sincroniza de novo ou exclui é o usuário.
  const idsListasRemotas = new Set(listasRemotas.map((l) => l.id));
  for (const l of listasLocais) {
    if (l.sincronizado && !l.ausenteDaPlanilha
        && !idsListasRemotas.has(l.id) && !idsPendentesListaExclusao.has(l.id)) {
      await dbPut("lists", Object.assign({}, l, { ausenteDaPlanilha: true }));
    }
  }

  // Tarefa sincronizada, cuja lista continua na planilha, mas que sumiu da
  // aba "Tarefas": foi excluída em outro dispositivo — aqui pode remover
  // direto, sem perguntar, porque a exclusão já passou por confirmação em
  // quem excluiu.
  const idsTarefasRemotas = new Set(tarefasRemotas.map((t) => t.id));
  for (const t of tarefasLocais) {
    if (t.sincronizado && idsListasRemotas.has(t.listId) && !idsTarefasRemotas.has(t.id)
        && !idsPendentesTarefaExclusao.has(t.id)) {
      await dbDelete("tasks", t.id);
    }
  }
}

// Ciclo completo: envia o que está pendente e depois busca o estado global.
// Recebe callbacks para refletir o status na interface sem acoplar este
// módulo a nenhum componente específico.
export async function syncCycle({ onStatus } = {}) {
  const notify = onStatus || (() => {});
  const url = await getWebAppUrl();
  if (!url) { notify("local"); return false; }
  if (!navigator.onLine) { notify("offline"); return false; }
  notify("sincronizando");
  await syncAll();
  const pullOk = await pullAll();
  notify(pullOk ? "sincronizado" : "pendente");
  return pullOk;
}
