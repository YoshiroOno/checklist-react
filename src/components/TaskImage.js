import { html } from "../htm.js";
import { resolveImageSrc } from "../lib/image.js";
import { useUi } from "../context/UiContext.js";

const React = window.React;
const { useState, useEffect } = React;

// Mostra a imagem de uma tarefa (foto de registro ou de resolução).
// O valor pode ser um data-URI local (recém-tirada) ou o ID do arquivo no
// Drive (já sincronizada) — nesse segundo caso, busca e guarda em cache.
// Tocar na imagem abre ela ampliada (lightbox).
export function TaskImage({ value, alt, className }) {
  const [src, setSrc] = useState(value && value.indexOf("data:") === 0 ? value : "");
  const [failed, setFailed] = useState(false);
  const { openLightbox } = useUi();

  useEffect(() => {
    let cancelado = false;
    setFailed(false);
    if (!value) { setSrc(""); return; }
    if (value.indexOf("data:") === 0) { setSrc(value); return; }
    setSrc("");
    resolveImageSrc(value).then((resolved) => {
      if (cancelado) return;
      if (resolved) setSrc(resolved);
      else setFailed(true);
    });
    return () => { cancelado = true; };
  }, [value]);

  const cls = ((className || "") + (failed ? " img-empty" : "")).trim();
  return html`<img className=${cls} src=${src} alt=${alt || ""} onClick=${() => src && openLightbox(src)} />`;
}
