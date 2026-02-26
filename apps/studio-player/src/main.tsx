import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { PlayerStore } from "./stores/player-store";
import { PlayerStoreProvider } from "./stores/context";
import "./index.css";

const WS_URL = `ws://${window.location.host}/ws`;
const store = new PlayerStore(WS_URL);
store.connect();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlayerStoreProvider value={store}>
      <App />
    </PlayerStoreProvider>
  </StrictMode>,
);
