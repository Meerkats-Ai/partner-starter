"use client";
/**
 * AgentsPage — the user-facing "Agents" catalog.
 *
 * Shows the SYSTEM small scheduled agents (the insight catalog — 90+ agents,
 * category='scale', is_system=true). Users filter by platform / cadence / plan,
 * ENABLE an agent for their workspace (it then runs on its schedule), and RUN it
 * on demand. Data is DB-backed via /api/v1/insight-scheduler (no hardcoded list).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import systemAgents from '@/lib/systemAgents';
import adRules from '@/lib/adRules';
import { Streamdown } from 'streamdown';
import { Tooltip2 } from '@/components/pages/Tooltip';
import HealthDashboard from '@/components/charts/HealthDashboard';
import ActivityFeed from '@/components/charts/ActivityFeed';
import ConfirmDialog from '@/components/charts/ConfirmDialog';
import RunDetailDrawer from '@/components/pages/RunDetailDrawer';
import { Eye, Pencil, Trash2, Copy, FlaskConical, Loader2, X, ScrollText } from 'lucide-react';
import '@/components/pages/campaign-mockup.css';

// "All platforms" (no filter) already surfaces cross-platform/universal agents,
// so a separate "Cross-platform" option reads as a duplicate to users — merged
// into "All platforms" here. Cross-platform agents still render with their own
// badge/icon; only the redundant filter entry is dropped.
const PLATFORMS = [
  { v: '', t: 'All platforms' }, { v: 'meta', t: 'Meta' },
  { v: 'google', t: 'Google' }, { v: 'quick_commerce', t: 'Blinkit & Zepto' },
  { v: 'flipkart', t: 'Flipkart' }, { v: 'amazon', t: 'Amazon' }, { v: 'demo', t: 'Demo' },
];
// Cadence filter options — MUST match the cadence keys the backend derives
// (insight-scheduler-user.controller cadenceOf) and the presets SmallAgentForm offers.
// No "Custom" — the raw-cron option was removed.
const CADENCES = [
  { v: '', t: 'All cadences' },
  { v: 'every_5m', t: 'Every 5 minutes' },
  { v: 'hourly', t: 'Hourly' },
  { v: 'hourly_working', t: 'Hourly (working hours)' },
  { v: 'hourly_day', t: 'Hourly (8am–11pm)' },
  { v: 'daily', t: 'Daily' },
  { v: 'weekdays', t: 'Weekdays' },
  { v: 'weekly', t: 'Weekly' },
  { v: 'monthly', t: 'Monthly' },
  { v: 'once', t: 'Once' },
];
// Human label for a cadence key (for the CADENCE column / detail). Falls back to a
// prettified version of any unknown key so it never shows a raw snake_case value.
const cadenceLabel = (key) =>
  CADENCES.find((c) => c.v === key)?.t ||
  (key ? String(key).replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) : '—');
const PLANS = [
  { v: '', t: 'All plans' }, { v: 'free', t: 'Free' }, { v: 'growth', t: 'Growth' },
  { v: 'pro', t: 'Pro' }, { v: 'enterprise', t: 'Enterprise' },
];
const PLATFORM_ICON = { cross: '🔀', meta: '📘', google: '🔍', quick_commerce: '⚡', flipkart: '🛒', amazon: '📦', demo: '👋' };
const PAGE = 24;
// Compact footer button — small height/padding/font.
const SM_BTN = { height: 24, padding: '0 10px', fontSize: 12, lineHeight: '24px' };
// Compact square icon button for the row actions (View/Edit/Delete/Test).
const ICON_BTN = {
  width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#4b5563', cursor: 'pointer',
};

function Sel({ value, onChange, options }) {
  return (
    <select value={value} onChange={onChange}
      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border,#e5e7eb)', fontSize: 13, background: '#fff' }}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
    </select>
  );
}

// Platform → the label shown on the "Connect" prompt.
const PLATFORM_LABEL = { google: 'Google Ads', meta: 'Meta Ads', flipkart: 'Flipkart', quick_commerce: 'Blinkit/Zepto', amazon: 'Amazon' };

// Compact platform badge(s) — the mockup shows a small coloured square per
// platform (a=amazon, G=google, M=meta, S=shopify, F=flipkart, etc.).
const PLAT_BADGE = {
  google: { t: 'G', bg: '#e8f0fe', fg: '#1a73e8' },
  meta: { t: 'M', bg: '#e7f0ff', fg: '#1877f2' },
  amazon: { t: 'a', bg: '#ff9900', fg: '#111' },
  flipkart: { t: 'F', bg: '#fff3d6', fg: '#f59e0b' },
  quick_commerce: { t: 'Q', bg: '#fdeffe', fg: '#a21caf' },
  cross: { t: '∞', bg: '#eef2ff', fg: '#4f46e5' },
  demo: { t: '·', bg: '#f3f4f6', fg: '#6b7280' },
};
function PlatBadge({ platform }) {
  const b = PLAT_BADGE[platform] || { t: (platform || '?')[0]?.toUpperCase(), bg: '#f3f4f6', fg: '#6b7280' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 22, height: 22, borderRadius: 5, background: b.bg, color: b.fg,
      fontSize: 12, fontWeight: 700,
    }}>{b.t}</span>
  );
}

// "just now" / "1h ago" / "2d ago" / "never run"
function relTime(iso) {
  if (!iso) return 'never run';
  const d = new Date(iso); if (isNaN(d)) return '—';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24); return `${days}d ago`;
}

function AgentRow({ agent, onToggle, onRun, onConnect, onView, onEdit, onDelete, onClearResult, onOpenRun, onOpenLog, busy, running, result }) {
  const enabled = agent.enabled;
  const connected = agent.connected !== false;
  const isCustom = agent.is_custom === true || agent.is_system === false;
  // Unconnected agents are greyed out but still clickable → connect the platform.
  const dim = !connected;
  const [expanded, setExpanded] = useState(false);
  // Compiled automation test → the rich delivered report_text (fall back to the
  // ReAct output_summary / error for non-compiled agents).
  const resultText = result
    ? (result.report_text || result.output_summary || result.error_message || result.status || '')
    : '';
  const isLong = resultText.length > 320;

  return (
    <>
      <tr style={{ borderTop: '1px solid #f1f3f5', background: dim ? '#fcfcfc' : 'transparent' }}>
        {/* Agent name — clicking it opens the read-only viewer (what it does).
            The small "Connect" chip on greyed rows still routes to the connect flow. */}
        <td style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: dim ? 0.6 : 1 }}>
            <button onClick={() => onEdit(agent)} title="Open this agent to edit"
              style={{ fontWeight: 600, color: '#111827', textAlign: 'left', cursor: 'pointer', background: 'none', border: 0, padding: 0 }}>
              {agent.name}
            </button>
            {isCustom && (
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4338ca', background: '#e0e7ff', borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                Custom
              </span>
            )}
            {dim && (
              <button onClick={() => onConnect(agent)}
                style={{ fontSize: 10.5, fontWeight: 600, color: '#b45309', background: '#fef3c7', borderRadius: 6, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '.03em', border: 0, cursor: 'pointer' }}>
                Connect
              </button>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: '#9ca3af', marginTop: 2, opacity: dim ? 0.6 : 1 }}>{agent.description || '—'}</div>
        </td>

        {/* Status: an ENABLED toggle switch (enables/disables the schedule) */}
        <td style={{ padding: '12px 14px', opacity: dim ? 0.55 : 1 }}>
          <Tooltip2 description={!connected ? 'Connect platform first' : enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}>
            <button
              disabled={busy}
              onClick={() => (connected || enabled ? onToggle(agent) : onConnect(agent))}
              style={{
                position: 'relative', width: 34, height: 20, borderRadius: 999, border: 0, padding: 0,
                cursor: busy ? 'default' : 'pointer', transition: 'background .15s',
                background: enabled ? '#16a34a' : '#d1d5db', opacity: busy ? 0.6 : 1,
              }}>
              <span style={{
                position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 16, height: 16,
                borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)',
              }} />
            </button>
          </Tooltip2>
        </td>

        {/* Platform badge(s) */}
        <td style={{ padding: '12px 14px', opacity: dim ? 0.55 : 1 }}><PlatBadge platform={agent.platform} /></td>

        {/* Cadence */}
        <td style={{ padding: '12px 14px', color: '#374151', opacity: dim ? 0.55 : 1 }}>{cadenceLabel(agent.cadence)}</td>

        {/* Last run */}
        <td style={{ padding: '12px 14px', color: agent.last_run_at ? '#374151' : '#9ca3af', opacity: dim ? 0.55 : 1 }}>{relTime(agent.last_run_at)}</td>

        {/* Icon actions: View · Edit/Customize · Delete(custom) · Test */}
        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <Tooltip2 description="View what this agent does">
              <button style={ICON_BTN} onClick={() => onView(agent)}><Eye size={15} /></button>
            </Tooltip2>
            <Tooltip2 description={isCustom ? 'Edit this agent' : 'Customize — creates your own editable copy'}>
              <button style={ICON_BTN} onClick={() => onEdit(agent)}>
                {isCustom ? <Pencil size={15} /> : <Copy size={15} />}
              </button>
            </Tooltip2>
            {/* View run history — opens this agent's recent runs (like the "Agents
                run history" tab), each drilling into its own full trace. Only for
                agents that have actually run. */}
            {agent.last_run_at && onOpenLog && (
              <Tooltip2 description="View run history">
                <button style={ICON_BTN} onClick={() => onOpenLog(agent)}><ScrollText size={15} /></button>
              </Tooltip2>
            )}
            {isCustom && (
              <Tooltip2 description="Delete this custom agent">
                <button style={{ ...ICON_BTN, color: '#b91c1c' }} onClick={() => onDelete(agent)}><Trash2 size={15} /></button>
              </Tooltip2>
            )}
            {connected ? (
              <Tooltip2 description={running ? 'Testing…' : 'Test run now'}>
                <button style={ICON_BTN} disabled={running} onClick={() => onRun(agent)}>
                  {running ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
                </button>
              </Tooltip2>
            ) : (
              <button style={SM_BTN} className="mini" onClick={() => onConnect(agent)}>Connect</button>
            )}
          </div>
        </td>
      </tr>
      {result && (
        <tr>
          <td colSpan={6} style={{ padding: '0 14px 10px 14px' }}>
            <div style={{ position: 'relative', fontSize: 12.5, color: result.status === 'error' ? '#b91c1c' : '#374151', background: '#f9fafb', borderRadius: 8, padding: '8px 28px 8px 10px' }}>
              {/* Dismiss the test output */}
              <Tooltip2 description="Close output">
                <button onClick={() => onClearResult(agent)}
                  style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>
                  <X size={14} />
                </button>
              </Tooltip2>
              {/* Full agent output — clamped to a few lines with Show more/less so a
                  long deep-audit is readable without dominating the table. */}
              <div className="mk-streamdown" style={ !expanded && isLong ? { maxHeight: 84, overflow: 'hidden', position: 'relative', maskImage: 'linear-gradient(180deg,#000 60%,transparent)' } : undefined }>
                <Streamdown>{resultText}</Streamdown>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 6 }}>
                {isLong && (
                  <button className="mini" onClick={() => setExpanded((v) => !v)}
                    style={{ fontSize: 11.5, color: '#4f46e5', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
                {(result?.is_compiled || result?.thread_id) && onOpenRun && (
                  <button
                    onClick={() => onOpenRun(
                      result.is_compiled
                        ? {
                            // Compiled trace renders in-band from step_results (no fetch/race).
                            is_compiled: true,
                            agent_id: agent.agent_key,
                            status: result.status,
                            report_type: result.report_type,
                            step_results: result.step_results,
                            report_text: result.report_text,
                            delivered: result.delivered,
                            error: result.error,
                            insight: agent.name,
                          }
                        : {
                            thread_id: result.thread_id,
                            status: result.status,
                            started_at: result.started_at || new Date().toISOString(),
                            insight: agent.name,
                            output: result.output_summary || resultText,
                          },
                    )}
                    style={{ fontSize: 11.5, fontWeight: 600, color: '#4f46e5', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                    View full run →
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// One titled agent table — used to render the custom and system-default groups
// as separate tables sharing the same columns/rows. busy/running/results are the
// per-key maps; the row reads its own entry.
function AgentTable({ title, agents, onToggle, onRun, onConnect, onView, onEdit, onDelete, onClearResult, onOpenRun, onOpenLog, busy, running, results }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 2px 10px' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#374151' }}>{title}</h3>
        <span style={{ fontSize: 12, color: '#9ca3af' }}>{agents.length}</span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #eceff1', borderRadius: 12, background: '#fff' }}>
        <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#9ca3af', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Agent</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Platform</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Cadence</th>
              <th style={{ padding: '10px 14px', fontWeight: 600 }}>Last run</th>
              <th style={{ padding: '10px 14px' }} />
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <AgentRow key={a.agent_key} agent={a}
                onToggle={onToggle} onRun={onRun} onConnect={onConnect}
                onView={onView} onEdit={onEdit} onDelete={onDelete} onClearResult={onClearResult}
                onOpenRun={onOpenRun} onOpenLog={onOpenLog}
                busy={!!busy[a.agent_key]} running={!!running[a.agent_key]} result={results[a.agent_key]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Small modal shown when a user tries to Enable/Run an agent whose platform
// isn't connected — points them to Integrations.
function ConnectModal({ platform, onClose, onGo }) {
  const label = PLATFORM_LABEL[platform] || platform || 'this platform';
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 420, boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600 }}>Connect {label}</h3>
        <p style={{ margin: '0 0 18px', fontSize: 14, color: '#4b5563', lineHeight: 1.5 }}>
          This agent runs on <b>{label}</b>. Connect your {label} account in Integrations so it can read
          your campaigns and act on them.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="mini" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-orange" onClick={onGo}>Go to Integrations →</button>
        </div>
      </div>
    </div>
  );
}

// ── Agent detail drawer — "what does this agent actually do?" ────────────────
// Read-only. Shows the FRAME steps (structured) + the raw system prompt rendered
// as Markdown, plus schedule/plan/model metadata. Fetches on open.
function AgentDetailDrawer({ agentKey, onClose, justCreated = false, highlightTest = false, onEdit }) {
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null); // { status, output_summary?, thread_id?, error_message? }
  const [runDetail, setRunDetail] = useState(null); // run object when the full-trace drawer is open

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    systemAgents.get(agentKey)
      .then((res) => { if (alive) setAgent(res.data?.agent || null); })
      .catch((e) => { if (alive) setError(e?.response?.data?.error || 'Failed to load agent'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [agentKey]);

  const onTest = async () => {
    setRunning(true); setRunResult(null);
    try {
      // Compiled automation → run the deterministic step graph (full report_text +
      // step_results); ReAct agents use the plain run(). The list endpoint exposes
      // this as automation_active, the detail (get) endpoint as automation_compiled
      // — accept either so both entry points branch correctly.
      const isAutomation = agent?.automation_active === true || agent?.automation_compiled === true;
      const res = isAutomation
        ? await systemAgents.testAutomation(agentKey, { dry_run: false })
        : await systemAgents.run(agentKey);
      const result = res.data?.result || { status: 'done' };
      setRunResult(isAutomation ? { ...result, is_compiled: true } : result);
    } catch (e) {
      setRunResult({ status: 'error', error_message: e?.response?.data?.error || 'Run failed' });
    } finally {
      setRunning(false);
    }
  };

  const connectors = Array.isArray(agent?.connectors) ? agent.connectors : [];
  const meta = [
    ['Platform', agent?.platform_label || agent?.platform || '—'],
    ['Signal', agent?.metric || '—'],
    ['Cadence', cadenceLabel(agent?.cadence)],
    ['Plan', agent?.plan_required || 'free'],
    ['Model', agent?.default_model || '—'],
    ['Max steps', agent?.max_steps || '—'],
  ];

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 620, height: '100%', overflowY: 'auto', background: '#fff', padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
              {agent?.icon ? `${agent.icon} ` : ''}{agent?.name || (loading ? 'Loading…' : 'Agent')}
            </div>
            {agent?.description && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{agent.description}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
            {onEdit && agent && (
              <button className="mini" onClick={() => onEdit(agent)}>Edit</button>
            )}
            <button className="mini" onClick={onClose}>Close</button>
          </div>
        </div>

        {/* Just-created banner */}
        {justCreated && (
          <div style={{ margin: '12px 0 4px', padding: '10px 12px', borderRadius: 8, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', fontSize: 13 }}>
            ✓ Agent created. It’s not enabled yet — <b>Test run</b> it below to see its output, then enable it from the list to run on schedule.
          </div>
        )}

        {/* Primary action: Test run (highlighted when arriving fresh from create) */}
        {agent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 4px' }}>
            <button
              onClick={onTest}
              disabled={running}
              className={highlightTest ? 'mk-pulse' : ''}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px',
                borderRadius: 9, border: 0, fontSize: 13.5, fontWeight: 600, cursor: running ? 'default' : 'pointer',
                background: '#f97316', color: '#fff', opacity: running ? 0.7 : 1,
                boxShadow: highlightTest ? '0 0 0 3px rgba(249,115,22,.25)' : 'none',
              }}>
              {running ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
              {running ? 'Testing…' : 'Test run now'}
            </button>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Runs once now — doesn’t change the schedule.</span>
          </div>
        )}

        {/* Test run output */}
        {runResult && (
          <div style={{ position: 'relative', margin: '10px 0 4px', fontSize: 12.5, color: runResult.status === 'error' ? '#b91c1c' : '#374151', background: '#f9fafb', borderRadius: 8, padding: '10px 28px 10px 12px' }}>
            <button onClick={() => setRunResult(null)}
              style={{ position: 'absolute', top: 6, right: 6, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 6, background: 'transparent', color: '#9ca3af', cursor: 'pointer' }}>
              <X size={14} />
            </button>
            {runResult.status === 'error' ? (
              <div className="mk-streamdown" style={{ color: '#b91c1c' }}>
                <Streamdown>{runResult.error_message || 'Run failed'}</Streamdown>
              </div>
            ) : (
              <div className="mk-streamdown">
                <Streamdown>{runResult.report_text || runResult.output_summary || '_Run finished with no text summary — open the full run to see the trace._'}</Streamdown>
              </div>
            )}
            {/* Full trace — compiled step trace (in-band) for automations, else the
                LangGraph message trace from the checkpointer. */}
            {(runResult.is_compiled || runResult.thread_id) && (
              <button
                type="button"
                onClick={() => setRunDetail(
                  runResult.is_compiled
                    ? {
                        is_compiled: true,
                        agent_id: agentKey,
                        status: runResult.status,
                        report_type: runResult.report_type,
                        step_results: runResult.step_results,
                        report_text: runResult.report_text,
                        delivered: runResult.delivered,
                        error: runResult.error,
                        insight: agent?.name,
                      }
                    : {
                        thread_id: runResult.thread_id,
                        status: runResult.status,
                        started_at: runResult.started_at || new Date().toISOString(),
                        insight: agent?.name,
                        output: runResult.output_summary,
                      },
                )}
                style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: '#4f46e5', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                View full run →
              </button>
            )}
          </div>
        )}

        {/* Full-trace drawer (opens over this one) */}
        {runDetail && (
          <RunDetailDrawer run={runDetail} onClose={() => setRunDetail(null)} />
        )}

        {error && (
          <div style={{ margin: '14px 0', padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading agent…</div>
        ) : agent && (
          <>
            {/* Meta chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '14px 0 18px' }}>
              {meta.map(([k, v]) => (
                <span key={k} style={{ fontSize: 12, color: '#374151', background: '#f9fafb', border: '1px solid #eceff1', borderRadius: 8, padding: '4px 10px' }}>
                  <span style={{ color: '#9ca3af' }}>{k}: </span><b style={{ fontWeight: 600, textTransform: k === 'Cadence' || k === 'Plan' ? 'capitalize' : 'none' }}>{v}</b>
                </span>
              ))}
            </div>

            {/* Connectors (read-only) */}
            {connectors.length > 0 && (
              <div style={{ margin: '0 0 18px' }}>
                <div style={{ fontSize: 11.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Connectors</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {connectors.map((c) => (
                    <span key={c} style={{ fontSize: 11.5, color: '#374151', background: '#f3f4f6', borderRadius: 999, padding: '3px 9px' }}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* System prompt (markdown) */}
            <div style={{ fontSize: 11.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid #e5e7eb' }}>System prompt</div>
            <div className="mk-streamdown" style={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6 }}>
              <Streamdown>{agent.system_prompt || '_No system prompt._'}</Streamdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Agent Run History drawer — recent runs for ONE agent ─────────────────────
// Opened from the row's log icon. Shows the agent's recent runs (status + time +
// output summary) like the "Agents run history" tab — NOT a single run's step
// trace. Each run drills into its own full trace via onOpenRun. Data comes from
// the shared run-history endpoint, filtered to this agent.
const HIST_RUN_COLOR = { success: '#16a34a', error: '#b91c1c', no_action: '#6b7280', running: '#0284c7', skipped: '#9ca3af', interrupted: '#d97706' };

function AgentRunHistoryDrawer({ agent, onClose, onOpenRun }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [task, setTask] = useState(null); // the run-history task for this agent (carries runs[])

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    // The run-history endpoint returns a task per agent (each with its recent runs).
    // Scope the fetch by platform to keep the payload small, then pick this agent.
    systemAgents.runHistory(agent.platform ? { platform: agent.platform } : {})
      .then((res) => {
        if (!alive) return;
        const tasks = res.data?.tasks || [];
        setTask(tasks.find((t) => t.agent_id === agent.agent_key) || null);
      })
      .catch((e) => { if (alive) setError(e?.response?.data?.error || 'Failed to load run history'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [agent.agent_key, agent.platform]);

  const runs = task?.runs || [];

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 65, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 620, height: '100%', overflowY: 'auto', background: '#fff', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em' }}>Run history</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#111827', marginTop: 2 }}>{agent.name || task?.insight || 'Agent'}</div>
          </div>
          <button className="mini" onClick={onClose}>Close</button>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading run history…</div>
        ) : error ? (
          <div style={{ margin: '14px 0', padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13 }}>{error}</div>
        ) : !runs.length ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>No runs recorded yet. Test run this agent to see activity here.</div>
        ) : (
          <div style={{ marginTop: 16, border: '1px solid #eceff1', borderRadius: 12, overflow: 'hidden' }}>
            {runs.map((r, i) => (
              <div key={r.id || i}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderTop: i ? '1px solid #f1f3f5' : 0 }}>
                <span style={{ marginTop: 6, width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: HIST_RUN_COLOR[r.status] || '#6b7280' }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11.5, color: '#9ca3af' }}>
                    {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                    {r.duration_s != null ? ` · ${r.duration_s}s` : ''}
                  </div>
                  <div className="mk-streamdown" style={{ fontSize: 13, color: r.status === 'error' ? '#b91c1c' : '#374151', marginTop: 2, overflowX: 'auto' }}>
                    <Streamdown>{r.output || r.error_message || '—'}</Streamdown>
                  </div>
                  {(r.is_compiled || r.thread_id) && onOpenRun && (
                    <button
                      onClick={() => onOpenRun({ ...r, insight: agent.name || task?.insight, agent_id: agent.agent_key })}
                      style={{ marginTop: 6, fontSize: 11.5, fontWeight: 600, color: '#4f46e5', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                      View full run →
                    </button>
                  )}
                </div>
                <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: HIST_RUN_COLOR[r.status] || '#6b7280' }}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Remember the user's last platform pick across visits ("last interacted").
const LAST_PLATFORM_KEY = 'agents:lastPlatform';

function AgentsCatalog() {
  // react-router → Next App Router compat.
  const _router = useRouter();
  const _pathname = usePathname();
  const navigate = (path, opts) => (opts?.replace ? _router.replace(path) : _router.push(path));
  const searchParams = useSearchParams();
  const setSearchParams = (next, _opts) => {
    const sp = next instanceof URLSearchParams ? next : new URLSearchParams(next || {});
    const qs = sp.toString();
    _router.replace(qs ? `${_pathname}?${qs}` : _pathname);
  };
  const [connectFor, setConnectFor] = useState(null); // platform string when the connect modal is open
  const [viewAgent, setViewAgent] = useState(null);   // agent_key when the detail drawer is open
  const [deleteTarget, setDeleteTarget] = useState(null); // agent pending delete confirmation
  const [deleting, setDeleting] = useState(false);        // delete request in flight
  // When the drawer is opened right after creating (?view=<key>&created=1), show a
  // "just created" banner and highlight the Test run button.
  const [drawerCtx, setDrawerCtx] = useState({ justCreated: false, highlightTest: false });
  const [agents, setAgents] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [platform, setPlatform] = useState('');
  const [cadence, setCadence] = useState('');
  const [plan, setPlan] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});       // { [id]: true } during enable/disable
  const [running, setRunning] = useState({}); // { [id]: true } during run
  const [results, setResults] = useState({}); // { [id]: runResult }
  const [toggleTarget, setToggleTarget] = useState(null); // agent whose enable/disable is being confirmed
  const [toggling, setToggling] = useState(false);        // enable/disable request in flight (dialog spinner)
  const [runDetail, setRunDetail] = useState(null); // run object when the full-trace drawer is open
  const [historyAgent, setHistoryAgent] = useState(null); // {agent_key,name,platform} when the run-history drawer is open
  const [connectedPlatforms, setConnectedPlatforms] = useState([]);
  const [autoSelected, setAutoSelected] = useState(false); // one-time auto-pick guard

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE };
      if (platform) params.platform = platform;
      if (cadence) params.cadence = cadence;
      if (plan) params.plan = plan;
      if (q.trim()) params.q = q.trim();
      const res = await systemAgents.list(params);
      // Custom agents float to the very top (even when disabled), then enabled
      // agents, then the rest; stable within each group.
      const isCustomAgent = (a) => a.is_custom === true || a.is_system === false;
      const list = (res.data?.agents || []).map((a, i) => ({ a, i }));
      list.sort((x, y) =>
        (Number(isCustomAgent(y.a)) - Number(isCustomAgent(x.a))) ||
        (Number(!!y.a.enabled) - Number(!!x.a.enabled)) ||
        (x.i - y.i));
      setAgents(list.map((x) => x.a));
      setTotal(res.data?.total ?? 0);
      if (Array.isArray(res.data?.connectedPlatforms)) setConnectedPlatforms(res.data.connectedPlatforms);
    } catch (e) {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [page, platform, cadence, plan, q]);
  useEffect(() => { load(); }, [load]);

  // Deep-link: ?view=<agent_key>[&created=1] auto-opens the read-only drawer.
  // Used after creating an agent so the user lands on the new agent (not a
  // reshuffled list) with the Test run action highlighted.
  useEffect(() => {
    // ?log=<key> → open the agent's last compiled run-log trace directly (used by
    // the "View run log →" link after a New Automation test). Takes precedence over
    // ?view (the read-only description drawer) so the run log isn't the wrong drawer.
    const log = searchParams.get('log');
    const view = searchParams.get('view');
    if (!log && !view) return;
    if (log) {
      setHistoryAgent({ agent_key: log, name: '', platform: '' });
    } else {
      const created = searchParams.get('created') === '1';
      setViewAgent(view);
      setDrawerCtx({ justCreated: created, highlightTest: created });
    }
    // Strip the params so a refresh / back doesn't re-trigger.
    const next = new URLSearchParams(searchParams);
    next.delete('view'); next.delete('created'); next.delete('log');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openView = (ag) => { setDrawerCtx({ justCreated: false, highlightTest: false }); setViewAgent(ag.agent_key); };
  const closeView = () => { setViewAgent(null); setDrawerCtx({ justCreated: false, highlightTest: false }); };
  useEffect(() => { setPage(1); }, [platform, cadence, plan, q]);

  // Auto-select the platform filter from the workspace's connected integrations,
  // ONCE, and only if the user hasn't already chosen one. One connected → pick it;
  // multiple → the last one the user interacted with (if still connected), else
  // the first. No connections → leave on "All platforms".
  useEffect(() => {
    if (autoSelected || platform || !connectedPlatforms.length) return;
    const last = localStorage.getItem(LAST_PLATFORM_KEY);
    const pick = (last && connectedPlatforms.includes(last)) ? last : connectedPlatforms[0];
    setAutoSelected(true);
    if (pick) setPlatform(pick);
  }, [connectedPlatforms, platform, autoSelected]);

  // A manual platform change is the "last interacted" signal — remember it and
  // stop any further auto-selection.
  const onPlatformChange = (v) => {
    setAutoSelected(true);
    setPlatform(v);
    if (v) localStorage.setItem(LAST_PLATFORM_KEY, v);
    else localStorage.removeItem(LAST_PLATFORM_KEY);
  };

  const mark = (setter, id, val) => setter((m) => ({ ...m, [id]: val }));

  // If a write is rejected because the platform isn't connected, open the modal.
  const notConnected = (e) => e?.response?.status === 400 && /connect/i.test(e?.response?.data?.error || '');

  // Patch a single agent row in place (avoids a full list reload + reshuffle on
  // toggle — the switch flips instantly, everything else stays put).
  const patchAgent = (key, next) =>
    setAgents((list) => list.map((a) => (a.agent_key === key ? { ...a, ...next } : a)));

  // The row toggle asks for confirmation first (styled dialog, not an instant
  // flip). onToggle just opens it; confirmToggle does the enable/disable.
  const onToggle = (a) => setToggleTarget(a);
  const confirmToggle = async () => {
    const a = toggleTarget;
    if (!a || toggling) return;
    const enabling = !a.enabled;
    setToggling(true);
    mark(setBusy, a.agent_key, true);
    try {
      if (enabling) await systemAgents.enable(a.agent_key);
      else await systemAgents.disable(a.agent_key);
      // Flip only this row — no load() so the screen doesn't refresh/reshuffle.
      patchAgent(a.agent_key, { enabled: enabling });
      setToggleTarget(null);
    } catch (e) {
      if (notConnected(e)) { setConnectFor(a.platform); setToggleTarget(null); }
      else window.alert(e?.response?.data?.error || 'Failed to update agent');
    } finally {
      setToggling(false);
      mark(setBusy, a.agent_key, false);
    }
  };
  const onRun = async (a) => {
    mark(setRunning, a.agent_key, true);
    try {
      // Compiled AUTOMATION agents run the deterministic step graph — NOT the ReAct
      // path. testAutomation() returns the full compiled report (report_text +
      // step_results); tag it is_compiled so the row + "View full run" render it
      // as a compiled trace. Non-automation (ReAct) agents use run() as before.
      const isAutomation = a.automation_active === true;
      const res = isAutomation
        ? await systemAgents.testAutomation(a.agent_key, { dry_run: false })
        : await systemAgents.run(a.agent_key);
      const result = res.data?.result || { status: 'done' };
      setResults((m) => ({ ...m, [a.agent_key]: isAutomation ? { ...result, is_compiled: true } : result }));
      // A test run is recorded in insight_run — reflect it in the row's "Last run"
      // immediately (the list derives last_run_at from insight_run on next load).
      patchAgent(a.agent_key, { last_run_at: new Date().toISOString() });
    } catch (e) {
      if (notConnected(e)) { setConnectFor(a.platform); }
      else setResults((m) => ({ ...m, [a.agent_key]: { status: 'error', error_message: e.response?.data?.error || 'Run failed' } }));
    } finally {
      mark(setRunning, a.agent_key, false);
    }
  };
  // Dismiss a test-run output row.
  const onClearResult = (a) => setResults((m) => { const n = { ...m }; delete n[a.agent_key]; return n; });
  // Open the agent's RUN HISTORY (recent runs list, like the "Agents run history"
  // tab) — NOT a single run's step trace. Each run in the drawer drills into its
  // own full trace.
  const onOpenLog = (a) => setHistoryAgent({ agent_key: a.agent_key, name: a.name, platform: a.platform });
  // Customize (system) or Edit (custom) → the editor that CREATED the agent:
  // step-graph automations (authored on /dashboard/agents/new) reopen there so
  // create and edit are the same screen; everything else uses SmallAgentForm.
  const onEdit = (a) => {
    const authoredVia = a.authored_via || a.agent_config?.authored_via;
    navigate(
      authoredVia === 'new-automation'
        ? `/dashboard/agents/new/${a.agent_key}`
        : `/dashboard/agents/${a.agent_key}/edit`,
    );
  };
  // Delete a workspace-owned custom agent (system agents don't show Delete).
  // Opens the styled ConfirmDialog (not window.confirm); confirmDelete performs it.
  const onDelete = (a) => setDeleteTarget(a);
  const confirmDelete = async () => {
    const a = deleteTarget;
    if (!a || deleting) return;
    setDeleting(true);
    mark(setBusy, a.agent_key, true);
    try {
      await systemAgents.remove(a.agent_key);
      await load();
      setDeleteTarget(null);
    } catch (e) {
      window.alert(e?.response?.data?.error || 'Delete failed');
    } finally {
      setDeleting(false);
      mark(setBusy, a.agent_key, false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  // Split the current page into CUSTOM (workspace-owned) vs SYSTEM-DEFAULT agents so
  // each renders as its own table with a separator. Backend already sorts custom
  // first, so on page 1 the custom table leads. (Ordering within each group is kept
  // from the server + the load()-time sort.)
  const isCustomAgent = (a) => a.is_custom === true || a.is_system === false;
  const customAgents = agents.filter(isCustomAgent);
  const defaultAgents = agents.filter((a) => !isCustomAgent(a));

  return (
    <>
        

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '16px 0', alignItems: 'center' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…"
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, minWidth: 200 }} />
          <Sel value={platform} onChange={(e) => onPlatformChange(e.target.value)} options={PLATFORMS} />
          <Sel value={cadence} onChange={(e) => setCadence(e.target.value)} options={CADENCES} />
          <Sel value={plan} onChange={(e) => setPlan(e.target.value)} options={PLANS} />
          {(platform || cadence || plan || q) && (
            <button className="mini" onClick={() => { onPlatformChange(''); setCadence(''); setPlan(''); setQ(''); }}>Clear</button>
          )}
          {/* Create a fresh workspace small agent */}
          <button onClick={() => navigate('/dashboard/agents/new')}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 0, background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            + New Agent
          </button>
        </div>

        {loading ? (
          <div className="desc" style={{ padding: 40, textAlign: 'center' }}>Loading agents…</div>
        ) : agents.length === 0 ? (
          <div className="desc" style={{ padding: 40, textAlign: 'center' }}>No agents match these filters.</div>
        ) : (
          <>
            {customAgents.length > 0 && (
              <AgentTable title="CUSTOM AGENTS" agents={customAgents}
                onToggle={onToggle} onRun={onRun} onConnect={(ag) => setConnectFor(ag.platform)}
                onView={openView} onEdit={onEdit} onDelete={onDelete} onClearResult={onClearResult}
                onOpenRun={(run) => setRunDetail(run)} onOpenLog={onOpenLog}
                busy={busy} running={running} results={results} />
            )}
            {/* Separator between custom and system-default agents (only when both show). */}
            {customAgents.length > 0 && defaultAgents.length > 0 && (
              <div style={{ height: 1, background: '#eceff1', margin: '28px 0' }} />
            )}
            {defaultAgents.length > 0 && (
              <AgentTable title="TEMPLATE AGENTS" agents={defaultAgents}
                onToggle={onToggle} onRun={onRun} onConnect={(ag) => setConnectFor(ag.platform)}
                onView={openView} onEdit={onEdit} onDelete={onDelete} onClearResult={onClearResult}
                onOpenRun={(run) => setRunDetail(run)} onOpenLog={onOpenLog}
                busy={busy} running={running} results={results} />
            )}
          </>
        )}

        {/* Pagination */}
        {total > PAGE && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid #eceff1',
            fontSize: 13, color: '#6b7280', flexWrap: 'wrap',
          }}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total} agents
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
              <span style={{ whiteSpace: 'nowrap' }}>Page {page} / {pages}</span>
              <button className="mini" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}

      {connectFor !== null && (
        <ConnectModal
          platform={connectFor}
          onClose={() => setConnectFor(null)}
          onGo={() => navigate(`/dashboard/mcp/servers${connectFor ? `?connect=${encodeURIComponent(connectFor)}` : ''}`)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        destructive
        busy={deleting}
        title={`Delete “${deleteTarget?.name || ''}”?`}
        message="This removes the agent and its schedule. Run history is kept."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      {/* Enable / disable confirmation — a styled dialog with a loading state,
          then the row's switch flips in place (no full-screen refresh). */}
      <ConfirmDialog
        open={!!toggleTarget}
        busy={toggling}
        title={toggleTarget?.enabled
          ? `Disable “${toggleTarget?.name || ''}”?`
          : `Enable “${toggleTarget?.name || ''}”?`}
        message={toggleTarget?.enabled
          ? 'The agent stops running on its schedule. Run history is kept and you can re-enable it anytime.'
          : 'The agent starts running on its schedule for this workspace.'}
        confirmLabel={toggling
          ? (toggleTarget?.enabled ? 'Disabling…' : 'Enabling…')
          : (toggleTarget?.enabled ? 'Disable' : 'Enable')}
        onConfirm={confirmToggle}
        onCancel={() => !toggling && setToggleTarget(null)}
      />

      {viewAgent && (
        <AgentDetailDrawer
          agentKey={viewAgent}
          justCreated={drawerCtx.justCreated}
          highlightTest={drawerCtx.highlightTest}
          onEdit={onEdit}
          onClose={closeView}
        />
      )}
      {/* Run-history drawer (log icon) — the agent's recent runs; each drills into
          its own full trace via the RunDetailDrawer below. */}
      {historyAgent && (
        <AgentRunHistoryDrawer
          agent={historyAgent}
          onOpenRun={(run) => setRunDetail(run)}
          onClose={() => setHistoryAgent(null)}
        />
      )}
      {runDetail && (
        <RunDetailDrawer run={runDetail} onClose={() => setRunDetail(null)} />
      )}
    </>
  );
}

// ── User Monitor — runs for THIS workspace only ──────────────────────────────
const RUN_PAGE = 25;
const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtCost = (n) => `$${Number(n || 0).toFixed(4)}`;
const RUN_COLOR = { success: '#16a34a', error: '#b91c1c', no_action: '#6b7280', running: '#0284c7', skipped: '#9ca3af', interrupted: '#d97706' };

/** A labelled JSON value in a compiled run's step trace (input / output / trace). */
function RunKV({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#9ca3af', marginBottom: 2 }}>{label}</div>
      <pre style={{ margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f3f4f6', borderRadius: 6, padding: 6, fontSize: 11, color: '#374151' }}>
        {typeof value === 'string' ? value : JSON.stringify(value, null, 1)}
      </pre>
    </div>
  );
}
// Strip markdown to a clean one-line preview for the run-list OUTPUT column.
const stripMd = (s) => (s || '')
  .replace(/[#*_`>~]/g, '')       // headings / bold / italic / code / quotes
  .replace(/\s*\n+\s*/g, ' ')     // newlines → spaces
  .replace(/\s{2,}/g, ' ')
  .trim();

// First pending actionRequest from an interrupted run's interrupt payload
// (interrupt jsonb → actionRequests[0]). Shared by the drawer's tool/params/explain.
const firstInterruptAction = (run) => {
  let p = run?.interrupt;
  // Defensive: older rows may have stored `interrupt` as a JSON STRING (double
  // encoded). Parse it so we can index into it either way.
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { return null; } }
  const collect = (x) => {
    if (!x) return [];
    if (Array.isArray(x)) return x.flatMap(collect);
    if (Array.isArray(x.actionRequests)) return x.actionRequests;
    return [];
  };
  return collect(p)[0] || null;
};
// Agentic plain-English `explain` for the drawer (matches the Inbox card).
const interruptExplain = (run) => (firstInterruptAction(run)?.explain || '').trim();
// Tool + a compact params summary (same shape the Inbox card shows).
const interruptAction = (run) => {
  const a = firstInterruptAction(run);
  if (!a) return null;
  const args = a.args || {};
  const params = Object.entries(args)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .slice(0, 4)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return { tool: a.name || '', params };
};

function UserMonitor() {
  const [runs, setRuns] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(true);
  const [openRun, setOpenRun] = useState(null);
  const [decideBusy, setDecideBusy] = useState('');   // '', 'approve', 'reject'
  const [decideErr, setDecideErr] = useState('');
  // Compiled (deterministic) runs carry a full step-by-step trace (input/output per step)
  // in compiled_agent_run — fetched on demand for the open run and shown as JSON logs.
  const [runDetail, setRunDetail] = useState(null);   // { status, step_results, report_text, ... }
  const [detailLoading, setDetailLoading] = useState(false);
  const [showRawLogs, setShowRawLogs] = useState(false);

  // When a COMPILED run's drawer opens, pull its traced step_results (JSON logs).
  useEffect(() => {
    setRunDetail(null);
    setShowRawLogs(false);
    if (!openRun?.is_compiled || !openRun?.agent_id) return;
    let alive = true;
    setDetailLoading(true);
    systemAgents.automationRunDetail(openRun.agent_id, { started_at: openRun.started_at })
      .then((r) => { if (alive) setRunDetail(r.data?.run || null); })
      .catch(() => { if (alive) setRunDetail(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [openRun]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: RUN_PAGE };
      if (status) params.status = status;
      if (platform) params.platform = platform;
      const res = await systemAgents.listRuns(params);
      setRuns(res.data?.runs || []);
      setTotal(res.data?.total ?? 0);
      setStats(res.data?.stats || null);
    } catch { setRuns([]); } finally { setLoading(false); }
  }, [page, status, platform]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, platform]);

  // Approve / reject a paused (interrupted) run's pending change — resumes the
  // SAME thread via the Inbox endpoints (card id = interrupt:<thread_id>).
  const decide = useCallback(async (action) => {
    if (!openRun?.thread_id) return;
    setDecideBusy(action); setDecideErr('');
    try {
      const cardId = `interrupt:${openRun.thread_id}`;
      if (action === 'approve') await adRules.approve(cardId);
      else await adRules.reject(cardId);
      setOpenRun(null);
      await load();
    } catch (e) {
      setDecideErr(e?.response?.data?.error || e?.message || 'Failed to submit decision');
    } finally { setDecideBusy(''); }
  }, [openRun, load]);

  const pages = Math.max(1, Math.ceil(total / RUN_PAGE));
  const s = stats || {};

  return (
    <>
      <p className="ag-intro">Runs of your enabled agents in this workspace — scheduled and manual (last 24h summary below).</p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, margin: '16px 0' }}>
        {[['runs (24h)', s.total ?? 0], ['success', s.success ?? 0], ['errors', s.error ?? 0],
          ['no action', s.no_action ?? 0], ['tokens', s.total_tokens ?? 0], ['cost', fmtCost(s.total_cost_usd)]].map(([k, v]) => (
          <div key={k} style={{ border: '1px solid #eceff1', borderRadius: 12, padding: 14, background: '#fbfbfa' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{v}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.04em' }}>{k}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Sel value={platform} onChange={(e) => setPlatform(e.target.value)} options={PLATFORMS} />
        <Sel value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ v: '', t: 'All status' }, ...['success', 'error', 'no_action', 'running', 'skipped'].map((x) => ({ v: x, t: x }))]} />
      </div>

      {loading ? (
        <div className="desc" style={{ padding: 40, textAlign: 'center' }}>Loading runs…</div>
      ) : runs.length === 0 ? (
        <div className="desc" style={{ padding: 40, textAlign: 'center' }}>No runs yet. Enable or Run an agent to see activity here.</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 12 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#9ca3af' }}>
                <th style={{ padding: '8px 12px' }}>Status</th><th style={{ padding: '8px 12px' }}>Insight</th>
                <th style={{ padding: '8px 12px' }}>Started</th><th style={{ padding: '8px 12px' }}>Output</th>
                <th style={{ padding: '8px 12px', textAlign: 'right' }}>Tokens</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setOpenRun(r)} style={{ borderTop: '1px solid #f1f3f5', cursor: 'pointer' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: RUN_COLOR[r.status] || '#6b7280' }}>{r.status}</span>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{r.insight_key}</td>
                  <td style={{ padding: '8px 12px', color: '#6b7280', whiteSpace: 'nowrap' }}>{fmt(r.started_at)}</td>
                  <td style={{ padding: '8px 12px', color: r.status === 'error' ? '#b91c1c' : '#374151', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.status === 'error'
                      ? (r.error_message || r.error_code || 'error')
                      : r.status === 'interrupted'
                      ? '⏸ Waiting for your approval in the Inbox'
                      : (stripMd(r.output_summary) || '—')}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{r.total_tokens || 0}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280' }}>{fmtCost(r.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > RUN_PAGE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: '#6b7280' }}>
          <span>{(page - 1) * RUN_PAGE + 1}–{Math.min(page * RUN_PAGE, total)} of {total}</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="mini" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span>Page {page} / {pages}</span>
            <button className="mini" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {openRun && (
        <div onClick={() => setOpenRun(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,.3)', display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, height: '100%', overflowY: 'auto', background: '#fff', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{openRun.insight_key}</span>
              <button className="mini" onClick={() => setOpenRun(null)}>Close</button>
            </div>
            {/* Interrupted → show the SAME info as the Inbox card: tool + params + explain. */}
            {openRun.status === 'interrupted' ? (
              <div style={{ marginBottom: 16 }}>
                {(() => {
                  const act = interruptAction(openRun)
                  return (
                    <>
                      {act?.tool && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 12.5, color: '#6b7280', marginBottom: 10 }}>
                          <span>tool <b style={{ fontFamily: 'monospace', fontSize: 11.5, color: '#374151' }}>{act.tool}</b></span>
                          {act.params && <span>params <b style={{ color: '#374151' }}>{act.params}</b></span>}
                        </div>
                      )}
                      <div style={{ borderRadius: 8, background: '#fffbeb', border: '1px solid #fef3c7', padding: '10px 12px', fontSize: 13, color: '#78350f' }}>
                        {interruptExplain(openRun) || 'Waiting for your approval.'}
                      </div>
                    </>
                  )
                })()}
              </div>
            ) : openRun.status === 'error' ? (
              <div style={{ whiteSpace: 'pre-wrap', padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 14, marginBottom: 16 }}>
                {openRun.error_message || openRun.error_code || 'error'}
              </div>
            ) : (
              <div className="mk-streamdown" style={{ padding: 12, borderRadius: 8, background: '#f9fafb', color: '#374151', fontSize: 14, marginBottom: 16 }}>
                {openRun.output_summary
                  ? <Streamdown>{openRun.output_summary}</Streamdown>
                  : '— no output —'}
              </div>
            )}

            {/* Compiled (deterministic) run → full execution trace: input/output per step +
                raw JSON logs. Fetched on drawer open from compiled_agent_run. */}
            {openRun.is_compiled && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#6b7280', marginBottom: 8 }}>
                  Execution trace
                </div>
                {detailLoading ? (
                  <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading run logs…</div>
                ) : !runDetail ? (
                  <div style={{ fontSize: 13, color: '#9ca3af' }}>No step logs found for this run.</div>
                ) : (
                  <>
                    {/* Per-step input/output */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Object.entries(runDetail.step_results || {}).map(([stepId, log]) => {
                        const failed = log?.error || log?.stopped;
                        return (
                          <div key={stepId} style={{ border: `1px solid ${failed ? '#fecaca' : '#e5e7eb'}`, borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: failed ? '#fef2f2' : '#f9fafb', fontSize: 12.5 }}>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: failed ? '#b91c1c' : '#374151' }}>{stepId}</span>
                              {failed && <span style={{ fontSize: 11, color: '#b91c1c' }}>failed</span>}
                            </div>
                            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {log?.input !== undefined && <RunKV label="input" value={log.input} />}
                              {log?.output !== undefined && <RunKV label="output" value={log.output} />}
                              {log?.trace !== undefined && <RunKV label="trace" value={log.trace} />}
                              {log?.error && <div style={{ fontSize: 12, color: '#b91c1c' }}>error: {log.error}</div>}
                            </div>
                          </div>
                        );
                      })}
                      {!Object.keys(runDetail.step_results || {}).length && (
                        <div style={{ fontSize: 13, color: '#9ca3af' }}>No step results recorded.</div>
                      )}
                    </div>

                    {/* Raw JSON logs — the whole run record, collapsible. */}
                    <button
                      onClick={() => setShowRawLogs((v) => !v)}
                      style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      {showRawLogs ? '▾' : '▸'} Raw logs (JSON)
                    </button>
                    {showRawLogs && (
                      <pre style={{ marginTop: 6, maxHeight: 360, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 11.5, lineHeight: 1.5 }}>
                        {JSON.stringify(runDetail, null, 2)}
                      </pre>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Paused for approval → Approve / Reject inline (resumes the thread). */}
            {openRun.status === 'interrupted' && openRun.thread_id && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => decide('approve')}
                    disabled={!!decideBusy}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#dc2626', color: '#fff', fontWeight: 600, fontSize: 13, cursor: decideBusy ? 'default' : 'pointer', opacity: decideBusy ? 0.6 : 1 }}>
                    {decideBusy === 'approve' ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => decide('reject')}
                    disabled={!!decideBusy}
                    style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', color: '#374151', fontWeight: 500, fontSize: 13, cursor: decideBusy ? 'default' : 'pointer', opacity: decideBusy ? 0.6 : 1 }}>
                    {decideBusy === 'reject' ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
                {decideErr && <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{decideErr}</div>}
              </div>
            )}
            {/* The human's recorded response (audit), if this run was already decided. */}
            {openRun.action_taken && (
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                <strong>Your response:</strong> {openRun.action_taken}
              </div>
            )}
            <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.9 }}>
              <div>Trigger: {openRun.trigger}</div>
              <div>Started: {fmt(openRun.started_at)}</div>
              <div>Finished: {fmt(openRun.finished_at)}</div>
              <div>Tokens: {openRun.total_tokens || 0} · Cost: {fmtCost(openRun.cost_usd)}</div>
              <div>Model: {openRun.llm_model || '—'}</div>
              {openRun.thread_id && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>Thread:</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{openRun.thread_id}</span>
                  <button
                    className="mini"
                    onClick={() => { try { navigator.clipboard.writeText(openRun.thread_id); } catch {} }}
                    style={{ fontSize: 11, padding: '1px 6px' }}
                    title="Copy thread id">copy</button>
                </div>
              )}
              {openRun.langgraph_run_id && (
                <div>Run: <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{openRun.langgraph_run_id}</span></div>
              )}
              {openRun.langsmith_url && <div><a href={openRun.langsmith_url} target="_blank" rel="noreferrer" style={{ color: '#4f46e5' }}>LangSmith trace →</a></div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Pending approvals — automations paused at a HITL checkpoint ───────────────
// A compiled automation that hits a `checkpoint` step STAGES an approval
// (ad_automation_staged_actions, source=agent_interrupt) and HOLDS its schedule.
// The card lives in the same approvals queue the Cockpit Inbox reads
// (adRules.staged('pending')); we surface it here too so a paused automation can be
// approved right where it was authored. Approve → re-enters the graph from the
// checkpoint and re-arms the schedule; Reject → the automation stays paused.
function PendingApprovals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // id currently being approved/rejected

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adRules.staged('pending');
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = useCallback(async (id, action) => {
    setBusy(id);
    try {
      if (action === 'approve') await adRules.approve(id);
      else await adRules.reject(id);
      // Keep the shared Inbox count (sidebar/cockpit) in sync.
      try { window.dispatchEvent(new Event('meerkats:staged-changed')); } catch {}
      await load();
    } catch (e) {
      // Surface the failure inline rather than silently swallowing it.
      alert(`Failed to ${action}: ${e?.response?.data?.error || e?.message || 'unknown error'}`);
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>Loading pending approvals…</div>;
  }
  if (!items.length) return null; // nothing pending → show only the activity feed below

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#b45309', margin: '0 0 8px' }}>
        Needs your approval ({items.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it) => (
          <div key={it.id}
            style={{ border: '1px solid #fed7aa', background: '#fffbeb', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 14, color: '#111827', lineHeight: 1.5 }}>{it.title}</div>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#9a3412', background: '#ffedd5', padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
                {it.risk === 'high' ? 'HIGH RISK' : it.risk === 'med' ? 'MED RISK' : 'LOW RISK'}
              </span>
            </div>
            {it.origin && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{it.origin}</div>}
            {it.params && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, fontFamily: 'monospace' }}>{it.params}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                disabled={busy === it.id}
                onClick={() => decide(it.id, 'approve')}
                style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#fff', background: busy === it.id ? '#9ca3af' : '#16a34a', border: 'none', borderRadius: 8, cursor: busy === it.id ? 'default' : 'pointer' }}>
                {busy === it.id ? 'Working…' : 'Approve & continue'}
              </button>
              <button
                disabled={busy === it.id}
                onClick={() => decide(it.id, 'reject')}
                style={{ padding: '7px 16px', fontSize: 13, fontWeight: 600, color: '#374151', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: busy === it.id ? 'default' : 'pointer' }}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page shell — Agents / Monitor tabs ───────────────────────────────────────
export default function AgentsPage() {
  const [tab, setTab] = useState('agents');
  return (
    <div className="mk-mock">
      {/* Left-aligned, full-width (override the centered max-width in ag-wrap). */}
      <div className="ag-wrap" style={{ maxWidth: 'none', margin: 0, padding: '26px 30px 48px' }}>
        <div className="ag-head"><h1>Agents</h1></div>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', margin: '12px 0 4px' }}>
          {[{ v: 'agents', label: 'Agents' }, { v: 'monitor', label: 'Agents run history' }, { v: 'activity', label: 'Inbox Activity' }].map((t) => (
            <button key={t.v} onClick={() => setTab(t.v)}
              style={{
                padding: '8px 16px', fontSize: 14, fontWeight: tab === t.v ? 600 : 500,
                borderBottom: tab === t.v ? '2px solid #f97316' : '2px solid transparent',
                color: tab === t.v ? '#f97316' : '#6b7280', marginBottom: -1,
                background: tab === t.v ? '#fff7ed' : 'transparent',
                borderTopLeftRadius: 6, borderTopRightRadius: 6,
              }}>{t.label}</button>
          ))}
        </div>
        {tab === 'agents' ? <AgentsCatalog />
          : tab === 'monitor' ? <HealthDashboard source="run-history" />
          : <div style={{ marginTop: 16 }}><PendingApprovals /><ActivityFeed meerkatsOnly /></div>}
      </div>
    </div>
  );
}
