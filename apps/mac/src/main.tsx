import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { CapturePanel } from "./CapturePanel";
import { startAppearance } from "./appearance";
const LibraryApp = lazy(() => import("./LibraryApp").then(({ LibraryApp }) => ({ default: LibraryApp })));
import "./styles.css";

const mode = new URLSearchParams(window.location.search).get("mode");
const isCaptureMode = mode === "capture";
document.documentElement.classList.toggle("capture-mode", isCaptureMode);
const stopAppearance = startAppearance();
if (import.meta.hot) import.meta.hot.dispose(stopAppearance);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isCaptureMode ? <CapturePanel /> : <Suspense fallback={<div className="loading-state">opening local cache…</div>}><LibraryApp /></Suspense>}</StrictMode>,
);
