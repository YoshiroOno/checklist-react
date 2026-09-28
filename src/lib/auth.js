import { dbGet, dbPut, dbDelete } from "./db.js";

/* ============================================================
   LOGIN — os dois únicos usuários do app
   ============================================================
   "admin" tem acesso a tudo. "loja" só resolve tarefas (com foto
   de confirmação) e exporta PDF — sem criar, excluir ou mexer na
   configuração de sincronização.

   Isto roda inteiramente no navegador: não é uma trava de segurança
   de verdade (qualquer um com os arquivos pode ver o código-fonte),
   serve para organizar o fluxo de trabalho entre os dois perfis.
   ============================================================ */
export const USUARIOS = {
  prev18: { senha: "adm18prev", papel: "admin" },
  loja18: { senha: "loja18", papel: "loja" }
};

export async function getSessaoSalva() {
  const c = await dbGet("config", "sessao");
  const sessao = c ? c.value : null;
  if (sessao && USUARIOS[sessao.usuario]) return sessao;
  return null;
}

export async function salvarSessao(sessao) {
  await dbPut("config", { key: "sessao", value: sessao });
}

export async function limparSessao() {
  await dbDelete("config", "sessao");
}

export function isAdmin(sessao) {
  return !!sessao && sessao.papel === "admin";
}
