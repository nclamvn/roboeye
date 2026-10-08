export type MetricState = 'IDLE' | 'LOADING' | 'READY' | 'RUNNING' | 'RECOVERING' | 'DEGRADED';
export type MetricFault = 'load-error' | 'infer-error' | 'module-error' | 'load-timeout' | 'infer-timeout';
/** Recovery is a bounded lifecycle decision, never permission to publish stale
 * depth. Successful warmup does not erase the rolling retry budget. */
export class MetricLifecycle {
  state: MetricState = 'IDLE';
  generation = 0;
  private retries: number[] = [];
  private events: Array<{ at: number; generation: number; state: MetricState; fault: MetricFault | null }> = [];
  private droppedEvents = 0;
  private failures = 0;
  private firstFailure: { at: number; fault: MetricFault } | null = null;
  private move(state: MetricState, at: number, fault: MetricFault | null = null) {
    this.state = state; this.events.push({ at, generation: this.generation, state, fault });
    if (this.events.length > 32) { this.events.shift(); this.droppedEvents++; }
  }
  cancel(at: number) { this.generation++; this.move('IDLE', at); }
  loading(at: number) { this.move('LOADING', at); }
  ready(at: number) { this.move('READY', at); }
  running(at: number) { this.move('RUNNING', at); }
  completed(at: number) { if (this.state === 'RUNNING') this.move('READY', at); }
  recover(at: number, fault: MetricFault, enabled = true) {
    this.failures++; this.firstFailure ??= { at, fault };
    this.retries = this.retries.filter(time => at >= time && at - time < 60_000);
    if (!enabled || this.retries.length >= 2) { this.move('DEGRADED', at, fault); return null; }
    const delayMs = this.retries.length ? 3000 : 1000;
    this.retries.push(at); this.move('RECOVERING', at, fault);
    return { generation: this.generation, delayMs };
  }
  canRestart(generation: number) { return this.state === 'RECOVERING' && this.generation === generation; }
  report() {
    return { scope: 'page-runtime lifecycle; retry budget is not reset by source/clip changes', state: this.state, generation: this.generation, failures: this.failures,
      firstFailure: this.firstFailure, retryBudget: { max: 2, windowMs: 60_000, scheduledAt: [...this.retries] },
      events: this.events.map(e => ({ ...e })), droppedEvents: this.droppedEvents, maxEvents: 32 };
  }
}
