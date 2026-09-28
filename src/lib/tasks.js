import { dbGet, dbGetAllByIndex, dbPut } from "./db.js";
import { syncList } from "./sync.js";

// Se não sobrou nenhuma tarefa pendente, marca a lista como concluída e
// sincroniza. Usado tanto ao confirmar a última tarefa quanto ao excluir
// uma tarefa que deixa a lista sem pendências.
export async function finalizeList(listId) {
  const list = await dbGet("lists", listId);
  if (!list) return;
  const tasks = await dbGetAllByIndex("tasks", "listId", listId);
  const aindaPendente = tasks.some((t) => t.status !== "resolvida");
  if (!aindaPendente) {
    list.status = "concluida";
    list.sincronizado = false;
    await dbPut("lists", list);
    syncList(list);
  }
}
