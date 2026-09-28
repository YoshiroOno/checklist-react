import { html } from "../htm.js";
import { IconXBig } from "../components/Icons.js";

const React = window.React;
const { createContext, useContext, useState, useRef, useCallback } = React;

const UiContext = createContext(null);

export function UiProvider({ children }) {
  const [toastMsg, setToastMsg] = useState("");
  const [toastShow, setToastShow] = useState(false);
  const toastTimer = useRef(null);
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const toast = useCallback((msg) => {
    setToastMsg(msg);
    setToastShow(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 2600);
  }, []);

  const openLightbox = useCallback((src) => { if (src) setLightboxSrc(src); }, []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);

  const value = { toast, openLightbox };

  return html`
    <${UiContext.Provider} value=${value}>
      ${children}
      <div className=${"toast" + (toastShow ? " show" : "")}>${toastMsg}</div>
      ${lightboxSrc ? html`
        <div className="lightbox" onClick=${(e) => { if (e.target === e.currentTarget) closeLightbox(); }}>
          <button className="lightbox-close" aria-label="Fechar" onClick=${closeLightbox}>
            <${IconXBig} />
          </button>
          <img src=${lightboxSrc} alt="Foto ampliada" />
        </div>
      ` : null}
    <//>
  `;
}

export function useUi() {
  return useContext(UiContext);
}
