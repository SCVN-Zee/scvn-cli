/**
 * main.tsx — Renderer entry: mount the React app.
 *
 * StrictMode is intentionally omitted: several views start a host invocation in
 * a mount effect, and StrictMode's dev double-invoke would fire those twice.
 */

import { createRoot } from "react-dom/client";

import "./styles/globals.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(<App />);
