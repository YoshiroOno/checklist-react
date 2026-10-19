import { dbGet, dbPut, dbDelete, dbGetAll, dbUpsert, dbDeleteSe, dbGetWhere, dbMapAll } from "./db.js";

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

/* ============================================================
   CONTROLE DE ENVIOS EM ANDAMENTO
   Importar um PDF cria várias tarefas com foto de uma vez e o envio
   demora mais que o intervalo de sincronização. Sem estes controles,
   cada rodada nova via as mesmas tarefas ainda "não enviadas" e
   mandava tudo de novo, empilhando envios repetidos.
   ============================================================ */
const emVoo = { listas: new Set(), tarefas: new Set(), exclusoes: new Set() };
let envioEmAndamento = null;   // promessa da rodada de envio atual
let repetirEnvio = false;      // alguém pediu envio enquanto a rodada rodava
let cicloEmAndamento = null;   // promessa do ciclo (envio + busca) atual

/* ============================================================
   ABA "VISUALIZAR" DA PLANILHA
   O servidor só a reconstrói quando o app pede (reconstruir a cada tarefa
   recebida deixava tudo lento). O app pede depois de QUALQUER envio
   bem-sucedido — inclusive os diretos, como resolver ou adicionar uma
   tarefa, que não passam pela rodada de envio — esperando um instante para
   juntar vários envios seguidos num pedido só.
   ============================================================ */
const ATRASO_VISUALIZAR_MS = 5000;
let versaoVisualizar = 0;       // sobe a cada envio; detecta envio que chegou durante o pedido
let timerVisualizar = null;
let visualizarEmAndamento = false;

function haEnvioEmCurso() {
  return !!envioEmAndamento || emVoo.listas.size > 0 || emVoo.tarefas.size > 0 || emVoo.exclusoes.size > 0;
}

function marcarVisualizarDesatualizado() {
  versaoVisualizar++;
  // Fica gravado no aparelho: se o app for fechado antes do pedido sair, o
  // próximo ciclo de sincronização faz o pedido.
  dbPut("config", { key: "visualizarDesatualizado", value: true }).catch(() => {});
  clearTimeout(timerVisualizar);
  timerVisualizar = setTimeout(atualizarVisualizarSePreciso, ATRASO_VISUALIZAR_MS);
}

async function atualizarVisualizarSePreciso() {
  clearTimeout(timerVisualizar);
  timerVisualizar = null;
  if (visualizarEmAndamento) return;
  if (haEnvioEmCurso()) { // ainda enviando: espera terminar para pedir uma vez só
    timerVisualizar = setTimeout(atualizarVisualizarSePreciso, ATRASO_VISUALIZAR_MS);
    return;
  }
  const marcado = await dbGet("config", "visualizarDesatualizado");
  if (!marcado) return;
  visualizarEmAndamento = true;
  try {
    const versao = versaoVisualizar;
    const r = await postToSheet({ tipo: "atualizarVisualizar" });
    if (!r.ok) return; // continua marcado: tenta de novo no próximo ciclo
    if (versao === versaoVisualizar) await dbDelete("config", "visualizarDesatualizado");
    else marcarVisualizarDesatualizado(); // chegou envio novo durante o pedido: mais um
  } finally {
    visualizarEmAndamento = false;
  }
}

// Uma vez por aparelho: a aba "Visualizar" pode estar desatualizada por causa
// de resoluções enviadas antes desta correção. Força uma reconstrução.
async function corrigirVisualizarAntigaUmaVez() {
  const feito = await dbGet("config", "visualizarReconstruidaV2");
  if (feito) return;
  await dbPut("config", { key: "visualizarReconstruidaV2", value: true });
  marcarVisualizarDesatualizado();
}

// Roda `fn` sobre os itens, com no máximo `limite` ao mesmo tempo.
async function executarComLimite(itens, limite, fn) {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const item = itens[proximo++];
      await fn(item);
    }
  });
  await Promise.all(trabalhadores);
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
      // Resposta que não é JSON = página de erro do Google (cota, falha
      // temporária...). Não dá para saber se gravou: trata como falha e o
      // item será reenviado na próxima rodada (o servidor não duplica).
      return { ok: false, reason: "resposta-invalida" };
    }
    return { ok: !!data.success, data };
  } catch (err) {
    return { ok: false, reason: "network", error: String(err) };
  }
}

export async function syncList(list) {
  if (emVoo.listas.has(list.id)) return false;
  emVoo.listas.add(list.id);
  try {
    const r = await postToSheet({
      tipo: "lista", id: list.id, nome: list.nome, criadoEm: list.criadoEm, status: list.status
    });
    if (!r.ok) return false;
    // Só marca como sincronizada se ela não mudou enquanto o envio rodava
    // (ex.: foi renomeada) — se mudou, continua pendente e vai de novo.
    await dbUpsert("lists", list.id, (atual) => {
      if (!atual) return null;
      if (atual.nome !== list.nome || atual.status !== list.status) return null;
      return { ...atual, sincronizado: true, sincronizadoEm: Date.now() };
    });
    marcarVisualizarDesatualizado(); // o nome da lista aparece na aba "Visualizar"
    return true;
  } finally {
    emVoo.listas.delete(list.id);
  }
}

export async function syncTask(task) {
  if (emVoo.tarefas.has(task.id)) return false;
  emVoo.tarefas.add(task.id);
  try {
    // Só manda a imagem em base64 se ela ainda não foi confirmada como
    // enviada — evita recriar o arquivo no Drive toda vez que a tarefa é
    // resincronizada por outro motivo (ex: ao resolver).
    const enviarCriacao = !task.imagemCriacaoEnviada && !!task.imagemCriacao && task.imagemCriacao.indexOf("data:") === 0;
    const enviarResolucao = !task.imagemResolucaoEnviada && !!task.imagemResolucao && task.imagemResolucao.indexOf("data:") === 0;
    const r = await postToSheet({
      tipo: "tarefa", id: task.id, listId: task.listId, texto: task.texto, status: task.status,
      criadoEm: task.criadoEm, resolvidoEm: task.resolvidoEm || "",
      imagemCriacaoBase64: enviarCriacao ? task.imagemCriacao : "",
      imagemResolucaoBase64: enviarResolucao ? task.imagemResolucao : ""
    });
    if (!r.ok) return false;

    // O servidor novo devolve o ID da foto que guardou; um servidor antigo
    // não devolve nada — nesse caso assume que guardou.
    const d = r.data || {};
    const gravouCriacao = d.fotoCriacaoId === undefined ? true : !!d.fotoCriacaoId;
    const gravouResolucao = d.fotoResolucaoId === undefined ? true : !!d.fotoResolucaoId;
    const fotoFalhou = (enviarCriacao && !gravouCriacao) || (enviarResolucao && !gravouResolucao);

    // Grava o resultado sobre a versão ATUAL da tarefa (não sobre a cópia que
    // foi enviada), para não desfazer algo que o usuário fez durante o envio
    // — por exemplo, resolver a tarefa enquanto ela sincronizava.
    await dbUpsert("tasks", task.id, (atual) => {
      if (!atual) return null; // foi excluída no meio do envio
      const novo = { ...atual };
      if (enviarCriacao && gravouCriacao && atual.imagemCriacao === task.imagemCriacao) novo.imagemCriacaoEnviada = true;
      if (enviarResolucao && gravouResolucao && atual.imagemResolucao === task.imagemResolucao) novo.imagemResolucaoEnviada = true;
      const inalterada =
        atual.texto === task.texto && atual.status === task.status && atual.resolvidoEm === task.resolvidoEm &&
        atual.imagemCriacao === task.imagemCriacao && atual.imagemResolucao === task.imagemResolucao;
      if (inalterada && !fotoFalhou) {
        novo.sincronizado = true;
        novo.sincronizadoEm = Date.now();
      }
      return novo;
    });
    marcarVisualizarDesatualizado();
    return true;
  } finally {
    emVoo.tarefas.delete(task.id);
  }
}

// Uma passada de envio: manda o que está pendente. Pode ser pedida de vários
// lugares ao mesmo tempo (salvar lista, importar PDF, timer, botão) — se já
// houver uma rodando, os pedidos se juntam a ela em vez de iniciar outra.
export function syncAll() {
  if (envioEmAndamento) {
    repetirEnvio = true; // quando terminar, faz mais uma passada para pegar o que chegou depois
    return envioEmAndamento;
  }
  envioEmAndamento = (async () => {
    let ok = true;
    do {
      repetirEnvio = false;
      ok = await rodadaDeEnvio();
    } while (repetirEnvio);
    return ok;
  })().finally(() => { envioEmAndamento = null; });
  return envioEmAndamento;
}

async function rodadaDeEnvio() {
  const url = await getWebAppUrl();
  if (!url) return false;

  // lê só o que está pendente (sem carregar na memória as fotos do resto)
  const listas = await dbGetWhere("lists", (l) => !l.sincronizado);
  const tarefasPendentes = await dbMapAll("tasks", (t) => ({ id: t.id, sincronizado: t.sincronizado }));
  const idsTarefas = tarefasPendentes.filter((t) => !t.sincronizado).map((t) => t.id);

  let allOk = true;

  for (const l of listas) {
    const ok = await syncList(l);
    allOk = ok && allOk;
  }

  // 2 de cada vez: aproveita o tempo de upload da foto enquanto o servidor
  // processa a anterior (o servidor grava uma por vez, com trava).
  await executarComLimite(idsTarefas, 2, async (id) => {
    const fresca = await dbGet("tasks", id); // versão mais nova, não a de quando a rodada começou
    if (!fresca || fresca.sincronizado) return;
    const ok = await syncTask(fresca);
    allOk = ok && allOk;
  });

  const exclusoesOk = await pushPendingDeletes();
  allOk = exclusoesOk && allOk;
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
    if (emVoo.exclusoes.has(p.id)) continue;
    emVoo.exclusoes.add(p.id);
    try {
      const tipoRemoto = p.tipo === "tarefa" ? "excluirTarefa" : "excluirLista";
      const r = await postToSheet({ tipo: tipoRemoto, id: p.id });
      if (r.ok) {
        await dbDelete("pendingDeletes", p.id);
        marcarVisualizarDesatualizado();
      } else {
        allOk = false;
      }
    } finally {
      emVoo.exclusoes.delete(p.id);
    }
  }
  return allOk;
}

// Busca o estado completo (todas as listas/tarefas) direto da planilha,
// para que qualquer dispositivo enxergue o que foi feito nos outros.
export async function pullAll() {
  const url = await getWebAppUrl();
  if (!url) return false;
  const inicioPull = Date.now();
  try {
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    const res = await fetch(url + sep + "action=listarTudo&_=" + inicioPull);
    const data = await res.json();
    if (!data || !data.success) return false;
    await mergeRemoteData(data.listas || [], data.tarefas || [], inicioPull);
    return true;
  } catch (err) {
    return false;
  }
}

// Mescla os dados vindos da planilha com o banco local. Nunca sobrescreve
// uma lista/tarefa criada/editada localmente que ainda não foi enviada
// (sincronizado:false) — e essa checagem é feita no momento da gravação,
// não numa foto antiga do banco. Só grava quando algo realmente mudou.
// Se uma lista já sincronizada sumiu da planilha (por exemplo, alguém
// apagou a linha manualmente), ela NÃO é apagada sozinha — só fica
// marcada como "ausente da planilha", e o usuário decide o que fazer.
// Itens enviados DEPOIS que esta busca começou não contam como "sumiram":
// a resposta da planilha pode ser anterior ao envio deles.
async function mergeRemoteData(listasRemotas, tarefasRemotas, inicioPull) {
  const [listasLocais, tarefasLocais, pendentesExclusao] = await Promise.all([
    dbMapAll("lists", (l) => ({ id: l.id, sincronizado: l.sincronizado, ausenteDaPlanilha: l.ausenteDaPlanilha, sincronizadoEm: l.sincronizadoEm })),
    dbMapAll("tasks", (t) => ({ id: t.id, listId: t.listId, sincronizado: t.sincronizado, sincronizadoEm: t.sincronizadoEm })),
    dbGetAll("pendingDeletes")
  ]);
  const idsPendentesListaExclusao = new Set(pendentesExclusao.filter((p) => p.tipo !== "tarefa").map((p) => p.id));
  const idsPendentesTarefaExclusao = new Set(pendentesExclusao.filter((p) => p.tipo === "tarefa").map((p) => p.id));

  // Ignora, na planilha, o que já foi apagado localmente e ainda não
  // teve a exclusão confirmada no servidor — senão o pull traria de volta.
  const listasRemotasValidas = listasRemotas.filter((rl) => !idsPendentesListaExclusao.has(rl.id));
  const tarefasRemotasValidas = tarefasRemotas.filter(
    (rt) => !idsPendentesListaExclusao.has(rt.listId) && !idsPendentesTarefaExclusao.has(rt.id)
  );

  for (const rl of listasRemotasValidas) {
    await dbUpsert("lists", rl.id, (local) => {
      if (local && !local.sincronizado) return null;
      const novo = {
        id: rl.id,
        nome: rl.nome || (local && local.nome) || "",
        criadoEm: rl.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
        status: rl.status || (local && local.status) || "aberta",
        sincronizado: true,
        ausenteDaPlanilha: false,
        sincronizadoEm: (local && local.sincronizadoEm) || Date.now()
      };
      if (local && local.sincronizado && !local.ausenteDaPlanilha &&
          local.nome === novo.nome && local.criadoEm === novo.criadoEm && local.status === novo.status) {
        return null; // nada mudou
      }
      return novo;
    });
  }

  for (const rt of tarefasRemotasValidas) {
    await dbUpsert("tasks", rt.id, (local) => {
      if (local && !local.sincronizado) return null;
      const novo = {
        id: rt.id,
        listId: rt.listId,
        texto: rt.texto || (local && local.texto) || "",
        status: rt.status || (local && local.status) || "pendente",
        criadoEm: rt.criadoEm || (local && local.criadoEm) || new Date().toISOString(),
        resolvidoEm: rt.resolvidoEm || (local && local.resolvidoEm) || null,
        imagemCriacao: rt.fotoCriacaoId || (local && local.imagemCriacao) || null,
        imagemResolucao: rt.fotoResolucaoId || (local && local.imagemResolucao) || null,
        imagemCriacaoEnviada: !!rt.fotoCriacaoId || !!(local && local.imagemCriacaoEnviada),
        imagemResolucaoEnviada: !!rt.fotoResolucaoId || !!(local && local.imagemResolucaoEnviada),
        sincronizado: true,
        sincronizadoEm: (local && local.sincronizadoEm) || Date.now()
      };
      if (local && local.sincronizado &&
          local.listId === novo.listId && local.texto === novo.texto && local.status === novo.status &&
          local.criadoEm === novo.criadoEm && (local.resolvidoEm || null) === novo.resolvidoEm &&
          local.imagemCriacao === novo.imagemCriacao && local.imagemResolucao === novo.imagemResolucao &&
          !!local.imagemCriacaoEnviada === novo.imagemCriacaoEnviada &&
          !!local.imagemResolucaoEnviada === novo.imagemResolucaoEnviada) {
        return null; // nada mudou
      }
      return novo;
    });
  }

  // Lista sincronizada que sumiu da planilha: só marca — quem decide se
  // sincroniza de novo ou exclui é o usuário.
  const idsListasRemotas = new Set(listasRemotas.map((l) => l.id));
  for (const l of listasLocais) {
    if (l.sincronizado && !l.ausenteDaPlanilha && !idsListasRemotas.has(l.id) &&
        !idsPendentesListaExclusao.has(l.id) && (l.sincronizadoEm || 0) < inicioPull) {
      await dbUpsert("lists", l.id, (atual) =>
        atual && atual.sincronizado && !atual.ausenteDaPlanilha && (atual.sincronizadoEm || 0) < inicioPull
          ? { ...atual, ausenteDaPlanilha: true }
          : null
      );
    }
  }

  // Tarefa sincronizada, cuja lista continua na planilha, mas que sumiu da
  // aba "Tarefas": foi excluída em outro dispositivo — aqui pode remover
  // direto, sem perguntar, porque a exclusão já passou por confirmação em
  // quem excluiu.
  const idsTarefasRemotas = new Set(tarefasRemotas.map((t) => t.id));
  for (const t of tarefasLocais) {
    if (t.sincronizado && idsListasRemotas.has(t.listId) && !idsTarefasRemotas.has(t.id) &&
        !idsPendentesTarefaExclusao.has(t.id) && (t.sincronizadoEm || 0) < inicioPull) {
      await dbDeleteSe("tasks", t.id, (atual) => atual.sincronizado && (atual.sincronizadoEm || 0) < inicioPull);
    }
  }
}

// Ciclo completo: envia o que está pendente e depois busca o estado global.
// Se já houver um ciclo rodando (timer, botão, voltar a ficar online...), o
// pedido se junta a ele em vez de começar outro por cima.
export function syncCycle({ onStatus } = {}) {
  if (cicloEmAndamento) return cicloEmAndamento;
  cicloEmAndamento = (async () => {
    const notify = onStatus || (() => {});
    const url = await getWebAppUrl();
    if (!url) { notify("local"); return false; }
    if (!navigator.onLine) { notify("offline"); return false; }
    notify("sincronizando");
    const envioOk = await syncAll();
    const pullOk = await pullAll();
    await corrigirVisualizarAntigaUmaVez();
    await atualizarVisualizarSePreciso(); // pedido que ficou pendente (app fechado, falha de rede...)
    notify(pullOk && envioOk ? "sincronizado" : "pendente");
    return pullOk;
  })().finally(() => { cicloEmAndamento = null; });
  return cicloEmAndamento;
}
