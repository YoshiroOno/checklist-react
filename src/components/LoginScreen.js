import { html } from "../htm.js";
import { USUARIOS, salvarSessao } from "../lib/auth.js";

const React = window.React;
const { useState, useRef } = React;

export function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState(false);
  const senhaRef = useRef(null);

  async function fazerLogin() {
    const u = usuario.trim();
    const registro = USUARIOS[u];
    if (!registro || registro.senha !== senha) {
      setErro(true);
      return;
    }
    setErro(false);
    const sessao = { usuario: u, papel: registro.papel };
    await salvarSessao(sessao);
    setUsuario("");
    setSenha("");
    onLogin(sessao);
  }

  return html`
    <div id="loginScreen">
      <div className="login-box">
        <div className="login-brand">Checklist</div>
        <label className="field-label" htmlFor="loginUser">Usuário</label>
        <input
          type="text" id="loginUser" autoComplete="username" autoCapitalize="off" autoCorrect="off"
          value=${usuario}
          onInput=${(e) => setUsuario(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") senhaRef.current && senhaRef.current.focus(); }}
        />
        <label className="field-label" htmlFor="loginPass">Senha</label>
        <input
          type="password" id="loginPass" autoComplete="current-password" ref=${senhaRef}
          value=${senha}
          onInput=${(e) => setSenha(e.target.value)}
          onKeyDown=${(e) => { if (e.key === "Enter") fazerLogin(); }}
        />
        ${erro ? html`<p className="login-error">Usuário ou senha incorretos.</p>` : null}
        <button className="btn btn-primary" onClick=${fazerLogin}>Entrar</button>
      </div>
    </div>
  `;
}
