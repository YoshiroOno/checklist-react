import { html } from "./htm.js";
import { App } from "./App.js";

const ReactDOM = window.ReactDOM;
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(html`<${App} />`);
