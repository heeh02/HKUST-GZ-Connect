'use strict';

const RECOVERY_DEBOUNCE_MS = 1500;

function validLifecycleIntent(value) {
  return value !== null && value !== undefined;
}

class ConnectivityRecovery {
  constructor({
    invalidate,
    getLifecycleIntent,
    shouldReconnect,
    reconnect,
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
    debounceMs = RECOVERY_DEBOUNCE_MS,
  } = {}) {
    if (typeof invalidate !== 'function' || typeof getLifecycleIntent !== 'function' ||
        typeof shouldReconnect !== 'function' || typeof reconnect !== 'function' ||
        typeof setTimer !== 'function' || typeof clearTimer !== 'function') {
      throw new TypeError('connectivity recovery callbacks are required');
    }
    if (!Number.isFinite(debounceMs) || debounceMs < 0) {
      throw new TypeError('connectivity recovery debounce must be non-negative');
    }
    this.invalidate = invalidate;
    this.getLifecycleIntent = getLifecycleIntent;
    this.shouldReconnect = shouldReconnect;
    this.reconnect = reconnect;
    this.setTimer = setTimer;
    this.clearTimerFn = clearTimer;
    this.debounceMs = debounceMs;

    this.suspended = false;
    this.offline = false;
    this.pending = false;
    this.pendingIntent = null;
    this.timerRecord = null;
    this.recoveryRecord = null;
    this.epoch = 0;
    this.disposed = false;
  }

  currentIntent(explicitIntent) {
    if (validLifecycleIntent(explicitIntent)) return explicitIntent;
    try { return this.getLifecycleIntent(); } catch { return null; }
  }

  isCurrentIntent(intent) {
    if (!validLifecycleIntent(intent)) return false;
    try { return Object.is(this.getLifecycleIntent(), intent); } catch { return false; }
  }

  cancelTimer() {
    if (!this.timerRecord) return;
    try { this.clearTimerFn(this.timerRecord.timer); } catch {}
    this.timerRecord = null;
  }

  markUnavailable(reason, explicitIntent) {
    if (this.disposed) return false;
    const intent = this.currentIntent(explicitIntent);
    if (!validLifecycleIntent(intent) || !this.isCurrentIntent(intent)) return false;

    // Incrementing the epoch also defeats a timer whose callback was already
    // queued just before clearTimeout ran.
    this.epoch += 1;
    this.cancelTimer();
    const sameOutage = this.pending && Object.is(this.pendingIntent, intent);
    this.pending = true;
    this.pendingIntent = intent;
    if (!sameOutage) {
      try { this.invalidate(reason, intent); } catch {}
    }
    return true;
  }

  suspend(explicitIntent) {
    if (this.disposed) return false;
    this.suspended = true;
    return this.markUnavailable('suspend', explicitIntent);
  }

  resume(explicitIntent) {
    if (this.disposed) return false;
    this.suspended = false;
    return this.scheduleIfReady('resume', explicitIntent);
  }

  networkOffline(explicitIntent) {
    if (this.disposed) return false;
    this.offline = true;
    return this.markUnavailable('network-offline', explicitIntent);
  }

  networkOnline(explicitIntent) {
    if (this.disposed) return false;
    this.offline = false;
    return this.scheduleIfReady('network-online', explicitIntent);
  }

  scheduleIfReady(reason, explicitIntent) {
    if (this.disposed || !this.pending || this.suspended || this.offline) return false;
    const intent = this.currentIntent(explicitIntent);
    if (!Object.is(intent, this.pendingIntent) || !this.isCurrentIntent(intent)) {
      this.cancelPending();
      return false;
    }
    if (this.timerRecord && Object.is(this.timerRecord.intent, intent)) return true;

    this.epoch += 1;
    const record = {
      epoch: this.epoch,
      intent,
      reason,
      timer: null,
    };
    record.timer = this.setTimer(() => {
      if (this.timerRecord !== record) return undefined;
      this.timerRecord = null;
      return this.attemptRecovery(record);
    }, this.debounceMs);
    this.timerRecord = record;
    return true;
  }

  async attemptRecovery(record) {
    if (this.disposed || record.epoch !== this.epoch || !this.pending ||
        this.suspended || this.offline || !Object.is(this.pendingIntent, record.intent) ||
        !this.isCurrentIntent(record.intent)) {
      if (!this.disposed && record.epoch === this.epoch &&
          Object.is(this.pendingIntent, record.intent)) this.cancelPending();
      return false;
    }

    let allowed = false;
    try { allowed = await this.shouldReconnect(record.intent); } catch { allowed = false; }
    if (!allowed || this.disposed || record.epoch !== this.epoch || !this.pending ||
        this.suspended || this.offline || !Object.is(this.pendingIntent, record.intent) ||
        !this.isCurrentIntent(record.intent)) {
      if (record.epoch === this.epoch) this.cancelPending();
      return false;
    }

    // Consume the outage before invoking reconnect so duplicate resume/online
    // events cannot start a second recovery while the first is in flight.
    this.pending = false;
    this.pendingIntent = null;
    const recovery = { epoch: record.epoch, intent: record.intent, reason: record.reason };
    this.recoveryRecord = recovery;
    try {
      await this.reconnect(record.intent, record.reason);
      return true;
    } catch {
      return false;
    } finally {
      if (this.recoveryRecord === recovery) this.recoveryRecord = null;
    }
  }

  cancelPending() {
    this.epoch += 1;
    this.cancelTimer();
    this.pending = false;
    this.pendingIntent = null;
  }

  // Main calls cancel on explicit disconnect and before quit. It deliberately
  // does not change the physical suspended/offline flags; only a matching OS
  // event should claim that connectivity has returned.
  cancel() {
    if (this.disposed) return;
    this.cancelPending();
    this.recoveryRecord = null;
  }

  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
  }

  snapshot() {
    return {
      suspended: this.suspended,
      offline: this.offline,
      pending: this.pending,
      pendingIntent: this.pendingIntent,
      recoveryInFlight: this.recoveryRecord !== null,
      timerScheduled: this.timerRecord !== null,
    };
  }
}

module.exports = { ConnectivityRecovery, RECOVERY_DEBOUNCE_MS };
