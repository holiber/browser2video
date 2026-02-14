/**
 * @description Automerge Repo setup with BroadcastChannel sync for cross-tab collaboration.
 * Uses the official @automerge/react library with Repo + BroadcastChannelNetworkAdapter.
 */
import {
  Repo,
  BroadcastChannelNetworkAdapter,
  IndexedDBStorageAdapter,
} from "@automerge/react";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";

export {
  RepoContext,
  useDocument,
  useRepo,
  isValidAutomergeUrl,
  updateText,
} from "@automerge/react";
export type { AutomergeUrl, DocHandle } from "@automerge/react";

/**
 * Create a Repo instance.
 *
 * Default: BroadcastChannel + IndexedDB for same-origin tabs.
 * Optional: add WebSocket networking (for Node reviewer / CI sync-server).
 */
export function createRepo(opts?: { wsUrl?: string }) {
  const network: any[] = [new BroadcastChannelNetworkAdapter()];
  if (opts?.wsUrl) {
    network.push(new BrowserWebSocketClientAdapter(opts.wsUrl));
  }
  return new Repo({
    network,
    storage: new IndexedDBStorageAdapter("b2v-notes"),
  });
}
