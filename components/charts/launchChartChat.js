/**
 * STUB — the real launchChartChat opens an agent-chat thread about a chart, which
 * isn't available on the public API. These exports keep ChartCard / TableToolbar
 * importing cleanly; the "Ask about this chart" affordance simply does nothing.
 */
export const CHART_CHAT_EVENT = "cockpit:chart-chat";
export function launchChartChat() { /* no-op: agent chat not available on the public API */ }
export function buildChartChatVisible() { return null; }
export function buildChartChatContext() { return null; }
