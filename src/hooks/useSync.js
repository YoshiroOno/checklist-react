import { syncCycle, getWebAppUrl } from "../lib/sync.js";

const React = window.React;
const { useState, useEffect, useCallback, useRef } = React;

// Cuida do status de sincronização, do ciclo automático (a cada 1 minuto),
// e reage a ficar online/offline. `onSynced` é chamado depois de qualquer
// sincronização (automática ou manual) para a tela atual recarregar os
// dados, sem tirar o usuário do que ele está fazendo.
export function useSync(onSynced) {
  const [status, setStatus] = useState("local");
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const syncNow = useCallback(async () => {
    await syncCycle({ onStatus: setStatus });
    if (onSyncedRef.current) onSyncedRef.current();
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (!navigator.onLine) { setStatus("offline"); return; }
      const u = await getWebAppUrl();
      if (cancelado) return;
      setStatus(u ? "pendente" : "local");
    })();

    const aoFicarOnline = () => syncNow();
    const aoFicarOffline = () => setStatus("offline");
    window.addEventListener("online", aoFicarOnline);
    window.addEventListener("offline", aoFicarOffline);

    // Sincronização automática a cada 1 minuto: envia pendências e busca
    // o estado global mais recente, para que todos os dispositivos
    // enxerguem as mesmas listas.
    const intervalo = setInterval(() => { if (navigator.onLine) syncNow(); }, 60000);

    if (navigator.onLine) syncNow();

    return () => {
      cancelado = true;
      window.removeEventListener("online", aoFicarOnline);
      window.removeEventListener("offline", aoFicarOffline);
      clearInterval(intervalo);
    };
    // eslint-disable-next-line
  }, []);

  return { status, syncNow };
}
