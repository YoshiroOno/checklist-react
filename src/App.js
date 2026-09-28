import { html } from "./htm.js";
import { getDB } from "./lib/db.js";
import { getSessaoSalva, limparSessao, isAdmin as checaAdmin } from "./lib/auth.js";
import { useSync } from "./hooks/useSync.js";
import { UiProvider } from "./context/UiContext.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { Topbar } from "./components/Topbar.js";
import { MenuView } from "./components/MenuView.js";
import { CreateView } from "./components/CreateView.js";
import { ResolveSelectView } from "./components/ResolveSelectView.js";
import { ResolveTaskView } from "./components/ResolveTaskView.js";
import { ListDetailView } from "./components/ListDetailView.js";
import { SettingsView } from "./components/SettingsView.js";

const React = window.React;
const { useState, useEffect, useCallback } = React;

function AppShell() {
  const [session, setSession] = useState(undefined); // undefined = ainda checando; null = sem login
  const [view, setView] = useState("menu");
  const [selectedListId, setSelectedListId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const { status, syncNow } = useSync(bumpRefresh);

  useEffect(() => {
    (async () => {
      await getDB();
      const sessaoSalva = await getSessaoSalva();
      setSession(sessaoSalva || null);
    })();
  }, []);

  function onLogin(sessao) {
    setSession(sessao);
    setView("menu");
    syncNow();
  }

  async function onLogout() {
    await limparSessao();
    setSession(null);
  }

  function abrirLista(id) {
    setSelectedListId(id);
    setView("list-detail");
  }

  function irParaResolver(id) {
    setSelectedListId(id);
    setView("resolve-task");
  }

  if (session === undefined) return null; // evita piscar a tela de login por um instante
  if (!session) return html`<${LoginScreen} onLogin=${onLogin} />`;

  const admin = checaAdmin(session);

  return html`
    <div id="app">
      <${Topbar} status=${status} onSyncNow=${syncNow} onOpenSettings=${() => setView("settings")} />

      ${view === "menu" ? html`
        <${MenuView}
          isAdmin=${admin}
          refreshKey=${refreshKey}
          onCreate=${() => setView("create")}
          onResolve=${() => setView("resolve-select")}
          onOpenList=${abrirLista}
        />
      ` : null}

      ${view === "create" ? html`
        <${CreateView} onBack=${() => setView("menu")} onSaved=${() => { bumpRefresh(); setView("menu"); }} />
      ` : null}

      ${view === "resolve-select" ? html`
        <${ResolveSelectView} refreshKey=${refreshKey} onBack=${() => setView("menu")} onPick=${irParaResolver} />
      ` : null}

      ${view === "resolve-task" ? html`
        <${ResolveTaskView} listId=${selectedListId} onBack=${() => { bumpRefresh(); setView("menu"); }} onChanged=${bumpRefresh} />
      ` : null}

      ${view === "list-detail" ? html`
        <${ListDetailView}
          listId=${selectedListId} isAdmin=${admin} refreshKey=${refreshKey}
          onBack=${() => { bumpRefresh(); setView("menu"); }}
          onChanged=${bumpRefresh}
          onResolve=${irParaResolver}
        />
      ` : null}

      ${view === "settings" ? html`
        <${SettingsView} session=${session} isAdmin=${admin} onBack=${() => setView("menu")} onSyncNow=${syncNow} onLogout=${onLogout} />
      ` : null}
    </div>
  `;
}

export function App() {
  return html`<${UiProvider}><${AppShell} /><//>`;
}
