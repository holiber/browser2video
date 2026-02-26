import { createContext, useContext } from "react";
import { PlayerStore } from "./player-store";

const PlayerStoreContext = createContext<PlayerStore | null>(null);

export const PlayerStoreProvider = PlayerStoreContext.Provider;

export function usePlayerStore(): PlayerStore {
  const store = useContext(PlayerStoreContext);
  if (!store) throw new Error("usePlayerStore must be used within PlayerStoreProvider");
  return store;
}
