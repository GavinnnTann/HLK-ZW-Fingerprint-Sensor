// "Report a problem" → Supabase.
//
// Submissions go straight to PostgREST with the anon key, so there is no SDK
// dependency. The anon key is designed to be public; what actually protects the
// table is the RLS policy (insert-only for anon, no select). See README.md.
//
// Both variables are injected at build time by Vite. When they are absent the
// dialog still works — it falls back to clipboard/download plus a prefilled
// GitHub issue, so a fork with no Supabase project is fully usable.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
const TABLE = 'reports';

export const REPO_URL = 'https://github.com/GavinnnTann/HLK-ZW-Fingerprint-Sensor';

export function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/**
 * Insert one problem report.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function submitReport(report) {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Report submission is not configured for this deployment.' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([report]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Supabase returned ${res.status}. ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** Snapshot of everything useful for diagnosis, attached to every report. */
export function buildDiagnostics({ device, logText }) {
  return {
    module_variant: device.variant || null,
    capacity: device.capacity ?? null,
    sys_params: device.sysParams ?? null,
    template_count: device.count ?? null,
    baud_rate: device.baudRate ?? null,
    stop_bits: device.stopBits ?? null,
    hispeed_search: device.hiSpeedSearch ?? null,
    capabilities: device.capabilities ?? null,
    user_agent: navigator.userAgent,
    app_version: __APP_VERSION__,
    submitted_at: new Date().toISOString(),
    log_lines: logText ? logText.split('\n').length : 0,
  };
}

/** Prefilled GitHub issue URL — the fallback when Supabase is unavailable. */
export function githubIssueUrl({ title, description, logText }) {
  const body = [
    description || '',
    '',
    '### Log',
    '',
    '```',
    (logText || '').slice(-4000),
    '```',
  ].join('\n');
  const params = new URLSearchParams({ title: title || 'Problem report', body });
  return `${REPO_URL}/issues/new?${params}`;
}
