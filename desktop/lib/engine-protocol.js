'use strict';

const ENGINE_API_VERSION = 1;
const MAX_ENGINE_EVENT_BYTES = 16 * 1024;
const MAX_ENGINE_BUFFER_BYTES = 32 * 1024;
const EVENT_TYPES = new Set([
  'hello',
  'state_changed',
  'listener_ready',
  'client_ip_assigned',
  'dns_mode',
  'network_unhealthy',
  'fatal_error',
  'stopped',
]);
const STATES = new Set(['idle', 'connecting', 'authenticating', 'connected', 'stopping', 'stopped']);
const DNS_MODES = new Set([
  'gateway',
  'vpn_profile',
  'gateway_profile',
  'system_fallback',
  'disabled',
]);
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,96}$/u;

function safeToken(value) {
  return typeof value === 'string' && SAFE_TOKEN.test(value) ? value : null;
}

function safeGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeEngineEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!EVENT_TYPES.has(value.type)) return null;
  switch (value.type) {
    case 'hello': {
      if (value.apiVersion !== ENGINE_API_VERSION || !Array.isArray(value.capabilities)) return null;
      const capabilities = [...new Set(value.capabilities.map(safeToken).filter(Boolean))].slice(0, 64);
      if (capabilities.length !== value.capabilities.length) return null;
      return { type: 'hello', apiVersion: ENGINE_API_VERSION, capabilities };
    }
    case 'state_changed': {
      const generation = safeGeneration(value.generation);
      if (!STATES.has(value.state) || generation == null) return null;
      return { type: 'state_changed', state: value.state, generation };
    }
    case 'listener_ready': {
      const port = Number(value.port);
      if (!Number.isInteger(port) || port < 1025 || port > 65535) return null;
      return { type: 'listener_ready', port };
    }
    case 'client_ip_assigned': {
      const family = value.family === 4 || value.family === 6 ? value.family : null;
      if (!family) return null;
      return { type: 'client_ip_assigned', family };
    }
    case 'dns_mode':
      return DNS_MODES.has(value.mode) ? { type: 'dns_mode', mode: value.mode } : null;
    case 'network_unhealthy': {
      const reason = safeToken(value.reason);
      return reason ? { type: 'network_unhealthy', reason } : null;
    }
    case 'fatal_error': {
      const code = safeToken(value.code);
      return code ? { type: 'fatal_error', code } : null;
    }
    case 'stopped': {
      const reason = safeToken(value.reason);
      const generation = safeGeneration(value.generation);
      if (!reason || generation == null) return null;
      return { type: 'stopped', reason, generation };
    }
    default:
      return null;
  }
}

class EngineEventParser {
  constructor({
    maxEventBytes = MAX_ENGINE_EVENT_BYTES,
    maxBufferBytes = MAX_ENGINE_BUFFER_BYTES,
  } = {}) {
    this.maxEventBytes = maxEventBytes;
    this.maxBufferBytes = maxBufferBytes;
    this.buffer = Buffer.alloc(0);
    this.droppedOversizedLine = false;
  }

  feed(value) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''));
    if (!chunk.length) return [];
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxBufferBytes && !this.buffer.includes(0x0a)) {
      this.buffer = Buffer.alloc(0);
      this.droppedOversizedLine = true;
      return [];
    }
    const events = [];
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const rawLine = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (this.droppedOversizedLine) {
        this.droppedOversizedLine = false;
        continue;
      }
      if (!rawLine.length || rawLine.length > this.maxEventBytes) continue;
      try {
        const event = normalizeEngineEvent(JSON.parse(rawLine.toString('utf8')));
        if (event) events.push(event);
      } catch {}
    }
    if (this.buffer.length > this.maxBufferBytes) {
      this.buffer = Buffer.alloc(0);
      this.droppedOversizedLine = true;
    }
    return events;
  }

  reset() {
    this.buffer = Buffer.alloc(0);
    this.droppedOversizedLine = false;
  }
}

module.exports = {
  ENGINE_API_VERSION,
  EVENT_TYPES,
  EngineEventParser,
  MAX_ENGINE_BUFFER_BYTES,
  MAX_ENGINE_EVENT_BYTES,
  normalizeEngineEvent,
};
