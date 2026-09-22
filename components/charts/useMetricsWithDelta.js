/**
 * useMetricsWithDelta — a metrics query + the SAME query over the previous
 * same-length window, for WoW/PoP deltas.
 *
 * body must carry an explicit { startDate, endDate } (resolve presets via
 * dateWindows helpers first). Returns { rows, prevRows, loading, error } —
 * loading covers the current window only; a failed previous-window query just
 * yields empty prevRows (deltas render as "—", the KPI itself still shows).
 */
import { useMetrics } from './useMetrics'
import { previousWindow } from './dateWindows'

export function useMetricsWithDelta(body, opts = {}) {
    const { startDate, endDate, ...rest } = body || {}
    const prev = startDate && endDate ? previousWindow({ startDate, endDate }) : null

    const current = useMetrics(body, opts)
    const previous = useMetrics(
        prev ? { ...rest, ...prev } : { ...rest },
        // Without a window there is nothing to compare — still call the hook
        // (rules of hooks) but the caller should always pass a window.
        opts,
    )

    return {
        rows: current.rows,
        prevRows: prev && !previous.error ? previous.rows : [],
        loading: current.loading,
        prevLoading: previous.loading,
        error: current.error,
        refetch: current.refetch,
    }
}

export default useMetricsWithDelta
