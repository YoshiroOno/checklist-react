// Liga a biblioteca "htm" ao React.createElement, dando uma sintaxe bem
// parecida com JSX (html`<div className="x">${valor}</div>`) sem precisar
// de nenhum compilador/bundler — funciona direto no navegador.
import htm from "https://esm.sh/htm@3.1.1";

const React = window.React;

export const html = htm.bind(React.createElement);
