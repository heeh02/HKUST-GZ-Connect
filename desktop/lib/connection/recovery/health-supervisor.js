'use strict';

function deadline(setTimeoutFn, clearTimeoutFn, timeoutMs) {
  let timer = null;
  const promise = new Promise((resolve) => {
    timer = setTimeoutFn(() => resolve({ deadlineExpired: true }), Math.max(1, timeoutMs));
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return {
    promise,
    cancel: () => { if (timer !== null) clearTimeoutFn(timer); },
  };
}

async function runConcurrentHealthRound({
  generation,
  isGenerationCurrent,
  probe,
  proxyPort,
  proxyHost = '127.0.0.1',
  proxyCredentials = null,
  targets,
  timeoutMs,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (!Number.isInteger(generation) || typeof isGenerationCurrent !== 'function' ||
      typeof probe !== 'function' || !Array.isArray(targets) || targets.length < 2 ||
      !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('invalid health round options');
  }

  // Invoke every probe before awaiting any of them. All targets therefore
  // share one wall-clock budget instead of consuming the timeout sequentially.
  const values = targets.map(() => null);
  const attempts = targets.map((target, index) => Promise.resolve().then(() => probe({
    proxyHost,
    proxyPort,
    proxyCredentials,
    targetHost: target.host,
    targetPort: target.port,
    timeoutMs,
  })).then((value) => {
    values[index] = Boolean(value);
  }, () => {
    values[index] = false;
  }));

  const completed = Promise.all(attempts).then(() => ({ completed: true }));
  const overallDeadline = deadline(setTimeoutFn, clearTimeoutFn, timeoutMs);
  let outcome;
  try {
    outcome = await Promise.race([completed, overallDeadline.promise]);
  } finally {
    overallDeadline.cancel();
  }

  if (!isGenerationCurrent(generation)) {
    return { kind: 'stale', generation, succeededTargets: [], failedTargets: [] };
  }

  const succeededTargets = [];
  const failedTargets = [];
  targets.forEach((target, index) => {
    // An unresolved target at the shared deadline counts as failed. A target
    // that already succeeded remains evidence that the tunnel is alive.
    (values[index] === true ? succeededTargets : failedTargets).push(target.host);
  });

  if (succeededTargets.length === targets.length) {
    return { kind: 'healthy', generation, succeededTargets, failedTargets };
  }
  if (succeededTargets.length > 0) {
    return { kind: 'site-failure', generation, succeededTargets, failedTargets };
  }
  return {
    kind: 'tunnel-failure',
    generation,
    succeededTargets,
    failedTargets,
    deadlineExpired: outcome.deadlineExpired === true,
  };
}

module.exports = { runConcurrentHealthRound };
