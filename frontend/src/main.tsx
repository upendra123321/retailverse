import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthGate } from "./components/Auth/AuthGate";
import "./index.css";

// AuthGate wraps the whole app (not just its data calls) so App's effects
// (camera access, store-layout fetch, etc.) never even mount until the
// shared passcode has been entered - see AuthGate for the opt-in mechanics.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
);
