/**
 * STUB — createThread + chat submit are the agent-chat backend (not on the
 * public API). No-ops; keep the exports so CockpitPage imports cleanly.
 */
export const THREAD_CREATED_EVENT = "cockpit:thread-created";
export async function createThread() { return null; }
export function useMessageSubmit() { return { submit: () => {}, isProcessing: false }; }
