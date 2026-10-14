/** Bounded, context-local metrics and correlated operation spans. */
const MDTelemetry = (() => {
  const STAGES = ['delivery', 'target', 'apply', 'edit'];
  const OUTCOMES = ['success', 'failure', 'noop', 'ignored', 'fallback'];
  const REASONS = [
    'none',
    'send-failed',
    'target-unavailable',
    'unsupported-field',
    'apply-failed',
    'command-failed',
    'result-mismatch',
  ];
  const LIMIT = 1_000_000_000;
  const BUCKETS = [1, 10, 100, 1000];
  /** @type {Map<string, { count: number, durationMs: number, buckets: number[] }>} */
  const metrics = new Map();

  /**
   * Start a span without retaining the operation or any text payload.
   * @param {string} stage Fixed pipeline stage.
   * @param {unknown} operationId Correlation identifier, never a metric label.
   */
  function start(stage, operationId) {
    if (!STAGES.includes(stage)) throw new Error('Unknown telemetry stage');
    const id =
      typeof operationId === 'string' && /^menu-\d{1,6}$/.test(operationId)
        ? operationId
        : 'menu-invalid';
    const startedAt = performance.now();
    let ended = false;
    console.debug('[markdown-helper]', 'span-start', {
      stage,
      operationId: id,
    });
    return {
      /** @param {string} outcome Fixed outcome. @param {string} [reason] Fixed reason. */
      end(outcome, reason = 'none') {
        if (!OUTCOMES.includes(outcome) || !REASONS.includes(reason)) {
          throw new Error('Unknown telemetry label');
        }
        if (ended) return;
        ended = true;
        const elapsed = performance.now() - startedAt;
        const durationMs = Number.isFinite(elapsed)
          ? Math.min(LIMIT, Math.max(0, Math.round(elapsed)))
          : 0;
        const key = `${stage}:${outcome}:${reason}`;
        const metric = metrics.get(key) || {
          count: 0,
          durationMs: 0,
          buckets: Array(BUCKETS.length + 1).fill(0),
        };
        metric.count = Math.min(LIMIT, metric.count + 1);
        metric.durationMs = Math.min(LIMIT, metric.durationMs + durationMs);
        const bucket = BUCKETS.findIndex((bound) => durationMs <= bound);
        const index = bucket < 0 ? BUCKETS.length : bucket;
        metric.buckets[index] = Math.min(LIMIT, metric.buckets[index] + 1);
        metrics.set(key, metric);
        console.debug('[markdown-helper]', 'span-end', {
          stage,
          outcome,
          reason,
          operationId: id,
          durationMs,
        });
      },
    };
  }

  /** Return detached aggregate metrics; operation IDs are never stored here. */
  function snapshot() {
    return Array.from(metrics, ([labels, metric]) => ({
      labels,
      count: metric.count,
      durationMs: metric.durationMs,
      buckets: [...metric.buckets],
    }));
  }
  return { start, snapshot };
})();

if (typeof module !== 'undefined' && module.exports)
  module.exports = MDTelemetry;
