/**
 * MT5 Bridge Supervisor — external watchdog
 * ===========================================
 * Keeps the MT5 bridge (port 3001) alive in sandbox environments where no
 * systemd / pm2 is available. Fixes the observed failure mode: the bridge
 * process dies (sandbox restart, crash) and nothing relaunches it, so
 * /api/health reports mt5Bridge: null until a human intervenes.
 *
 * Strategy — health-probe watchdog (does NOT own the child):
 *   1. Probe GET /heartbeat every PROBE_INTERVAL_MS.
 *      200 = alive + connected, 401 = alive + not connected (by design).
 *      ANY HTTP response counts as alive — guarantees we never double-spawn
 *      onto an occupied port.
 *   2. If the probe throws (ECONNREFUSED / timeout) the bridge is DOWN →
 *      spawn `bun run dev` (output appended to bridge.log) and wait for the
 *      port to answer again.
 *   3. Backoff: failed startups space out exponentially (10s → 120s cap) so
 *      a crash-looping bridge cannot cause a process storm.
 *
 * Run ONE instance, in the background:
 *   cd mini-services/mt5-bridge && setsid nohup bun supervisor.ts >/dev/null 2>&1 &
 *
 * Logging: every event appends to supervisor.log (gitignored via *.log).
 * Killing the supervisor never kills the bridge (children are detached).
 */

import { appendFileSync } from "node:fs";

// ============================================================
// CONFIG
// ============================================================

const BRIDGE_PORT = 3001;
const HEARTBEAT_URL = `http://localhost:${BRIDGE_PORT}/heartbeat`;
const PROBE_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 3_000;
const STARTUP_TIMEOUT_MS = 20_000;
const STARTUP_POLL_MS = 500;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 120_000;
const LOG_FILE = `${import.meta.dir}/supervisor.log`;

// ============================================================
// HELPERS
// ============================================================

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function log(message: string): void {
  const line = `[${new Date().toISOString()}] SUPERVISOR | ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    // Log file unwritable (e.g. read-only fs) — console output is enough.
  }
}

interface ProbeResult {
  up: boolean;
  /** HTTP status of /heartbeat when the port answered. */
  status?: number;
}

async function probeBridge(): Promise<ProbeResult> {
  try {
    const res = await fetch(HEARTBEAT_URL, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { up: true, status: res.status };
  } catch {
    return { up: false };
  }
}

/** Spawn the bridge detached; its stdout/stderr append to bridge.log. */
function spawnBridge(): void {
  Bun.spawn(["bash", "-c", "exec bun run dev >> ./bridge.log 2>&1"], {
    cwd: import.meta.dir,
    stdin: "ignore",
  });
  log(`spawned 'bun run dev' (cwd ${import.meta.dir})`);
}

async function waitForStartup(): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await probeBridge()).up) return true;
    await sleep(STARTUP_POLL_MS);
  }
  return false;
}

// ============================================================
// MAIN LOOP
// ============================================================

let consecutiveFailedStarts = 0;

log(`watchdog started (pid ${process.pid}, probing :${BRIDGE_PORT} every ${PROBE_INTERVAL_MS / 1000}s)`);

while (true) {
  const { up, status } = await probeBridge();

  if (up) {
    if (status !== 200 && status !== 401) {
      // Port is serving something unexpected — log it, but never respawn
      // onto an occupied port.
      log(`heartbeat answered HTTP ${status} (unexpected status, port serving — not restarting)`);
    }
    consecutiveFailedStarts = 0;
  } else {
    log(`bridge DOWN (no HTTP response on :${BRIDGE_PORT}) — respawning`);
    spawnBridge();

    if (await waitForStartup()) {
      log("bridge restarted successfully — heartbeat answered");
      consecutiveFailedStarts = 0;
    } else {
      consecutiveFailedStarts += 1;
      const backoffMs = Math.min(
        MAX_BACKOFF_MS,
        BASE_BACKOFF_MS * 2 ** (consecutiveFailedStarts - 1),
      );
      log(
        `startup probe timed out after ${STARTUP_TIMEOUT_MS / 1000}s ` +
          `(failed start #${consecutiveFailedStarts}) — backing off ${backoffMs / 1000}s`,
      );
      await sleep(backoffMs);
      continue; // Skip the normal interval — backoff already elapsed.
    }
  }

  await sleep(PROBE_INTERVAL_MS);
}
