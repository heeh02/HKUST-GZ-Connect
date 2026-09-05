(function initializeCampusDataModules(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.campusDataModules = api;
})(typeof self !== 'undefined' ? self : globalThis, function campusDataModulesFactory() {
  'use strict';

  const MODULES = Object.freeze({
    schedule: { body: 'scheduleBody', sourceId: 'official-portal', sourceUrl: 'https://myportal.hkust-gz.edu.cn/' },
    loans: { body: 'loansBody', sourceId: 'library', sourceUrl: 'https://library.hkust-gz.edu.cn/' },
    news: { body: 'newsBody', sourceId: 'home', sourceUrl: 'https://www.hkust-gz.edu.cn/' },
  });
  const ACCEPTED_STATES = new Set([
    'not-authenticated', 'authenticating', 'loading', 'ready', 'empty', 'forbidden',
    'session-expired', 'source-unavailable', 'tunnel-required', 'failed',
  ]);
  const WEEK_SLOT_START = 8 * 60;
  const WEEK_SLOT_MINUTES = 120;
  const WEEK_SLOT_COUNT = 7;
  const SCHEDULE_AUTO_REFRESH_MS = 24 * 60 * 60 * 1_000;

  function weekRange(now = Date.now(), campusTime = false) {
    if (campusTime) {
      const offset = 8 * 60 * 60 * 1000;
      const day = new Date(now + offset);
      if (!Number.isFinite(day.getTime())) throw new TypeError('week timestamp is invalid');
      day.setUTCHours(0, 0, 0, 0);
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      const start = day.getTime() - offset;
      return Object.freeze({ start, end: start + 7 * 86_400_000,
        days: Object.freeze(Array.from({ length: 7 }, (_, i) => start + i * 86_400_000)) });
    }
    const start = new Date(now);
    if (!Number.isFinite(start.getTime())) throw new TypeError('week timestamp is invalid');
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return day.getTime();
    });
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return Object.freeze({ start: start.getTime(), end: end.getTime(), days: Object.freeze(days) });
  }

  function sameLocalDay(left, right, campusTime = false) {
    if (campusTime) return Math.floor((left + 28_800_000) / 86_400_000) ===
      Math.floor((right + 28_800_000) / 86_400_000);
    const a = new Date(left);
    const b = new Date(right);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function scheduleWeekModel(entries, now = Date.now(), campusTime = false) {
    const range = weekRange(now, campusTime);
    const items = Array.isArray(entries) ? entries : [];
    const intersecting = items.filter((entry) => Number.isFinite(entry?.startsAt) &&
      Number.isFinite(entry?.endsAt) && entry.endsAt > entry.startsAt &&
      Number.isFinite(new Date(entry.startsAt).getTime()) &&
      Number.isFinite(new Date(entry.endsAt).getTime()) &&
      entry.startsAt < range.end && entry.endsAt > range.start);
    const segments = intersecting.flatMap((entry) => range.days.flatMap((dayStart, day) => {
      const dayEnd = range.days[day + 1] ?? range.end;
      const segmentStart = Math.max(entry.startsAt, dayStart);
      const segmentEnd = Math.min(entry.endsAt, dayEnd);
      if (segmentEnd <= segmentStart) return [];
      const start = new Date(segmentStart + (campusTime ? 28_800_000 : 0));
      const end = new Date(segmentEnd + (campusTime ? 28_800_000 : 0));
      const minutes = (date) => campusTime ? date.getUTCHours() * 60 + date.getUTCMinutes()
        : date.getHours() * 60 + date.getMinutes();
      const startMinutes = minutes(start);
      const endMinutes = segmentEnd === dayEnd ? 24 * 60
        : minutes(end);
      return [{ entry, day, startMinutes, endMinutes, segmentStart, segmentEnd }];
    }));
    const slotStart = Math.floor(Math.min(WEEK_SLOT_START,
      ...segments.map(({ startMinutes }) => startMinutes)) / WEEK_SLOT_MINUTES) * WEEK_SLOT_MINUTES;
    const slotEnd = Math.ceil(Math.max(WEEK_SLOT_START + WEEK_SLOT_COUNT * WEEK_SLOT_MINUTES,
      ...segments.map(({ endMinutes }) => endMinutes)) / WEEK_SLOT_MINUTES) * WEEK_SLOT_MINUTES;
    const slotCount = (slotEnd - slotStart) / WEEK_SLOT_MINUTES;
    const events = segments.map(({ startMinutes, endMinutes, ...segment }) => {
      const slot = Math.floor((startMinutes - slotStart) / WEEK_SLOT_MINUTES);
      const endSlot = Math.max(slot + 1, Math.ceil((endMinutes - slotStart) / WEEK_SLOT_MINUTES));
      return Object.freeze({ ...segment, slot, span: endSlot - slot });
    }).sort((left, right) => left.segmentStart - right.segmentStart);
    return Object.freeze({ ...range, slotStart, slotCount,
      events: Object.freeze(events), eventCount: intersecting.length });
  }

  function create({ document: doc, api, translate, escapeHtml, openDeepLink, onCatalog = null } = {}) {
    if (!doc || !api || typeof translate !== 'function' || typeof escapeHtml !== 'function' ||
        typeof openDeepLink !== 'function') {
      throw new TypeError('campus data module dependencies are incomplete');
    }
    const $ = (id) => doc.getElementById(id);
    const publishCatalog = typeof onCatalog === 'function' ? onCatalog : () => {};
    let loaded = false;
    let inflight = null;
    let snapshot = null;
    let lastLoadedAt = 0;
    let scheduleRefreshTimer = null;

    const locale = () => String(doc.documentElement.lang || '').toLowerCase().startsWith('en')
      ? 'en' : 'zh-CN';
    const formatDate = (value) => new Intl.DateTimeFormat(locale(), {
      month: 'short', day: 'numeric',
    }).format(new Date(value));

    function validModule(module) {
      return module && typeof module === 'object' && ACCEPTED_STATES.has(module.state) &&
        Array.isArray(module.items);
    }

    function stateCopy(state, moduleId) {
      if (state === 'source-unavailable' &&
          snapshot?.modules?.[moduleId]?.source === 'myportal-session') {
        return ['workspace.portalSessionUnavailable', 'workspace.portalSessionUnavailableHint', 'retry'];
      }
      const common = {
        'not-authenticated': ['workspace.portalSignedOut', 'workspace.portalSignedOutHint', 'login'],
        authenticating: ['workspace.portalAuthenticating', 'workspace.portalAuthenticatingHint', null],
        loading: ['workspace.portalLoading', 'workspace.portalLoadingHint', null],
        forbidden: ['workspace.portalForbidden', 'workspace.portalForbiddenHint', 'source'],
        'session-expired': ['workspace.portalExpired', 'workspace.portalExpiredHint', 'login'],
        'source-unavailable': ['workspace.portalSourcePending', 'workspace.portalSourcePendingHint', 'source'],
        'tunnel-required': ['workspace.portalTunnelRequired', 'workspace.portalTunnelRequiredHint', 'source'],
        failed: ['workspace.portalFailed', 'workspace.portalFailedHint', 'retry'],
        empty: [`workspace.${moduleId}Empty`, `workspace.${moduleId}EmptyHint`, 'source'],
      };
      return common[state] || common['source-unavailable'];
    }

    function actionHtml(action, moduleId) {
      if (!action) return '';
      const key = action === 'login' ? 'workspace.portalLogin'
        : action === 'retry' ? 'workspace.portalRetry'
          : `workspace.${moduleId}Source`;
      return `<button class="module-link" type="button" data-campus-data-action="${action}" data-module-id="${moduleId}">${escapeHtml(translate(key))}</button>`;
    }

    function entryShell(entry, content, extraClass = '') {
      if (!entry.url) return `<div class="data-row${extraClass}">${content}</div>`;
      return `<button class="data-row${extraClass}" type="button" data-entry-url="${escapeHtml(entry.url)}">${content}</button>`;
    }

    function stateHtml(module, moduleId) {
      const [titleKey, hintKey, action] = stateCopy(module.state, moduleId);
      const stateClass = ['loading', 'authenticating'].includes(module.state) ? ' is-loading' : '';
      return `<div class="module-state${stateClass}">`
        + `<span class="module-state-mark" aria-hidden="true"></span>`
        + `<div class="module-state-copy"><p class="module-note">${escapeHtml(translate(titleKey))}</p>`
        + `<p class="module-hint">${escapeHtml(translate(hintKey))}</p>`
        + actionHtml(action, moduleId) + '</div></div>';
    }

    function scheduleHtml(module) {
      if (!['ready', 'empty'].includes(module.state)) return stateHtml(module, 'schedule');
      const now = Date.now();
      const campusTime = module.source === 'myportal-calendar';
      const model = scheduleWeekModel(module.state === 'ready' ? module.items : [], now, campusTime);
      const format = (value, options) => new Intl.DateTimeFormat(locale(), {
        ...options, ...(campusTime ? { timeZone: 'Asia/Shanghai' } : {}),
      }).format(new Date(value));
      const formatDate = value => format(value, { month: 'short', day: 'numeric' });
      const formatWeekday = value => format(value, { weekday: 'short' });
      const formatTime = value => format(value, { hour: '2-digit', minute: '2-digit', hour12: false });
      const lastDay = model.days.at(-1);
      const weekLabel = translate('workspace.scheduleWeekRange', {
        start: formatDate(model.start), end: formatDate(lastDay),
      });
      const headers = model.days.map((day) => {
        const today = sameLocalDay(day, now, campusTime);
        return `<div class="week-day-head${today ? ' is-today' : ''}" role="columnheader"${today ? ' aria-current="date"' : ''}>`
          + `<span>${escapeHtml(formatWeekday(day))}</span><strong>${escapeHtml(formatDate(day))}</strong></div>`;
      }).join('');
      const lanes = model.days.map((day, index) => (
        `<div class="week-day-lane${sameLocalDay(day, now, campusTime) ? ' is-today' : ''}" data-day="${index}" aria-hidden="true"></div>`
      )).join('');
      const times = Array.from({ length: model.slotCount }, (_, index) => {
        const hour = String(model.slotStart / 60 + index * 2).padStart(2, '0');
        return `<time class="week-time" data-slot="${index}" aria-hidden="true">${hour}:00</time>`;
      }).join('');
      const events = model.days.map((_, index) => {
        const dayEvents = model.events.filter(({ day }) => day === index)
          .map(({ entry, day, slot, span, segmentStart, segmentEnd }) => {
        const endLabel = segmentEnd === (model.days[day + 1] ?? model.end) ? '24:00' : formatTime(segmentEnd);
        const content = `<time>${escapeHtml(`${formatTime(segmentStart)}–${endLabel}`)}</time>`
          + `<strong>${escapeHtml(entry.title)}</strong>`
          + (entry.location ? `<small>${escapeHtml(entry.location)}</small>` : '');
        const label = `${formatTime(segmentStart)}–${endLabel} ${entry.title}${entry.location ? ` · ${entry.location}` : ''}`;
        const attrs = `class="week-event" data-day="${day}" data-slot="${slot}" data-span="${span}"`
          + ` title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"`;
        return entry.url
          ? `<button type="button" ${attrs} data-entry-url="${escapeHtml(entry.url)}">${content}</button>`
          : `<div ${attrs} role="gridcell">${content}</div>`;
          }).join('');
        return `<div class="week-event-day" data-day="${index}">${dayEvents}</div>`;
      }).join('');
      const empty = model.events.length ? ''
        : `<div class="week-empty" role="status"><strong>${escapeHtml(translate('workspace.scheduleWeekEmpty'))}</strong>`
          + `<span>${escapeHtml(translate('workspace.scheduleWeekEmptyHint'))}</span></div>`;
      return `<div class="week-summary"><strong>${escapeHtml(weekLabel)}</strong>`
        + `<span>${escapeHtml(translate('workspace.scheduleWeekCount', { count: model.eventCount }))}</span></div>`
        + `<div class="week-scroll" tabindex="0" aria-label="${escapeHtml(translate('workspace.scheduleWeekTable'))}">`
        + `<div class="week-table" role="grid"><div class="week-head" role="row">`
        + `<div class="week-time-head" role="columnheader">${escapeHtml(translate('workspace.scheduleTime'))}</div>${headers}</div>`
        + `<div class="week-body" data-slot-count="${model.slotCount}">${lanes}${times}${events}${empty}</div></div></div>`
        + actionHtml('source', 'schedule');
    }

    function loansHtml(module) {
      if (module.state !== 'ready') return stateHtml(module, 'loans');
      const now = Date.now();
      const dueSoon = module.items.filter(({ dueAt }) => dueAt >= now && dueAt - now <= 3 * 86_400_000).length;
      return `<div class="data-summary"><strong>${escapeHtml(translate('workspace.loansSummary', { count: module.items.length }))}</strong>`
        + (dueSoon ? `<span>${escapeHtml(translate('workspace.loansDueSoon', { count: dueSoon }))}</span>` : '') + '</div>'
        + `<div class="data-list">${module.items.slice(0, 2).map((entry) => entryShell(entry,
          `<span><strong>${escapeHtml(entry.title)}</strong><small>${escapeHtml(translate('workspace.loanDue', { date: formatDate(entry.dueAt) }))}</small></span>`,
        )).join('')}</div>`
        + actionHtml('source', 'loans');
    }

    function newsHtml(module) {
      if (module.state !== 'ready') return stateHtml(module, 'news');
      return `<div class="data-list news-list">${module.items.slice(0, 3).map((entry) => entryShell(entry,
        `<span class="news-unread${entry.unread ? ' is-unread' : ''}" aria-label="${escapeHtml(entry.unread ? translate('workspace.newsUnread') : '')}"></span>`
        + `<span><strong>${escapeHtml(entry.title)}</strong></span><time>${escapeHtml(formatDate(entry.publishedAt))}</time>`,
      )).join('')}</div>`
        + actionHtml('source', 'news');
    }

    function renderModule(moduleId, module) {
      const config = MODULES[moduleId];
      const body = $(config.body);
      const shell = body?.closest('.module');
      if (!body || !shell) return;
      const safe = validModule(module) ? module : { state: 'source-unavailable', items: [] };
      shell.dataset.state = safe.state;
      body.innerHTML = moduleId === 'schedule' ? scheduleHtml(safe)
        : moduleId === 'loans' ? loansHtml(safe) : newsHtml(safe);
    }

    function render() {
      for (const moduleId of Object.keys(MODULES)) {
        const module = snapshot?.modules?.[moduleId] || {
          state: loaded ? 'source-unavailable' : 'loading', items: [],
        };
        renderModule(moduleId, module);
      }
    }

    function setScheduleRefreshBusy(busy) {
      const button = $('scheduleRefresh');
      if (!button) return;
      button.disabled = busy;
      button.textContent = translate(busy
        ? 'workspace.scheduleRefreshing' : 'workspace.scheduleRefresh');
    }

    function scheduleNextRefresh() {
      if (scheduleRefreshTimer !== null) clearTimeout(scheduleRefreshTimer);
      scheduleRefreshTimer = null;
      if (!loaded || snapshot?.sessionState !== 'authenticated') return;
      const fetchedAt = snapshot?.modules?.schedule?.fetchedAt || lastLoadedAt || Date.now();
      const delay = Math.max(1_000, SCHEDULE_AUTO_REFRESH_MS - (Date.now() - fetchedAt));
      scheduleRefreshTimer = setTimeout(() => {
        scheduleRefreshTimer = null;
        void refreshSchedule();
      }, delay);
    }

    async function load(force = false) {
      if (inflight) return inflight;
      const method = force ? api.refreshCampusData : api.getCampusData;
      if (typeof method !== 'function') {
        loaded = true;
        render();
        return null;
      }
      snapshot = { modules: Object.fromEntries(Object.keys(MODULES).map((id) => [id, {
        state: 'loading', items: [],
      }])) };
      setScheduleRefreshBusy(true);
      render();
      inflight = Promise.resolve(method.call(api)).then((value) => {
        snapshot = value;
        loaded = true;
        lastLoadedAt = Date.now();
        publishCatalog(value?.catalog || null);
        render();
        return value;
      }).catch(() => {
        snapshot = { modules: Object.fromEntries(Object.keys(MODULES).map((id) => [id, {
          state: 'failed', items: [],
        }])) };
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return null;
      }).finally(() => {
        inflight = null;
        setScheduleRefreshBusy(false);
        scheduleNextRefresh();
      });
      return inflight;
    }

    async function refreshSchedule() {
      if (inflight) await inflight;
      if (typeof api.refreshCampusSchedule !== 'function') return load(true);
      const previous = snapshot;
      snapshot = {
        ...(previous || {}),
        modules: {
          ...(previous?.modules || {}),
          schedule: { state: 'loading', source: 'myportal-calendar', items: [] },
        },
      };
      setScheduleRefreshBusy(true);
      renderModule('schedule', snapshot.modules.schedule);
      const operation = Promise.resolve(api.refreshCampusSchedule()).then((value) => {
        snapshot = value;
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return value;
      }).catch(() => {
        snapshot = {
          ...(previous || {}),
          modules: {
            ...(previous?.modules || {}),
            schedule: { state: 'failed', source: 'myportal-calendar', items: [] },
          },
        };
        loaded = true;
        lastLoadedAt = Date.now();
        render();
        return null;
      }).finally(() => {
        if (inflight === operation) inflight = null;
        setScheduleRefreshBusy(false);
        scheduleNextRefresh();
      });
      inflight = operation;
      return operation;
    }

    function activate(target) {
      const entryUrl = target.closest('[data-entry-url]')?.dataset.entryUrl;
      if (entryUrl) { openDeepLink(null, entryUrl); return; }
      const action = target.closest('[data-campus-data-action]');
      if (!action) return;
      const moduleId = action.dataset.moduleId;
      if (action.dataset.campusDataAction === 'retry') {
        void (moduleId === 'schedule' ? refreshSchedule() : load(true));
        return;
      }
      if (action.dataset.campusDataAction === 'login') {
        openDeepLink('official-portal', 'https://myportal.hkust-gz.edu.cn/');
        return;
      }
      const config = MODULES[moduleId];
      if (config) openDeepLink(config.sourceId, config.sourceUrl);
    }

    function start() {
      for (const { body } of Object.values(MODULES)) {
        $(body)?.closest('.module')?.addEventListener('click', (event) => activate(event.target));
      }
      $('scheduleRefresh')?.addEventListener('click', () => { void refreshSchedule(); });
      doc.addEventListener('app-locale-changed', render);
      render();
      return true;
    }

    function ensureLoaded() {
      if (!loaded) return load(false);
      const scheduleState = snapshot?.modules?.schedule?.state;
      const sessionRecovery = snapshot?.sessionState !== 'authenticated' ||
        ['not-authenticated', 'session-expired'].includes(scheduleState);
      if (sessionRecovery) return load(true);
      const fetchedAt = snapshot?.modules?.schedule?.fetchedAt || lastLoadedAt;
      if (Date.now() - fetchedAt >= SCHEDULE_AUTO_REFRESH_MS) return refreshSchedule();
      scheduleNextRefresh();
      return Promise.resolve(snapshot);
    }

    return Object.freeze({
      ensureLoaded,
      load,
      refreshSchedule,
      render,
      snapshot: () => snapshot,
      start,
    });
  }

  return Object.freeze({ create, scheduleWeekModel, weekRange });
});
