'use strict';

const fs = require('node:fs');
const {
  copyTail,
  ensurePrivateDirectory,
  openVerifiedRegular,
  recheckOpenPath,
  replaceWithPrivateFile,
  unsafeLogPath,
  writeAll,
} = require('./private-log-file');

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TAIL_BYTES = 256 * 1024;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_TAIL_LINES = 10_000;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function redactDiagnosticText(value) {
  let text = String(value ?? '');
  text = text.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/giu,
    '$1: [REDACTED]',
  );
  text = text.replace(
    /([?&](?:token|access_token|refresh_token|code|ticket|samlrequest|samlresponse|relaystate|session|sid)=)[^&#\s]*/giu,
    '$1[REDACTED]',
  );
  text = text.replace(
    /\b(password|passwd|pwd|token|access_token|refresh_token|cookie)\b(\s*[=:]\s*)('[^']*'|"[^"]*"|[^\s,;&}]+)/giu,
    '$1$2[REDACTED]',
  );
  return text;
}

class BufferedLogWriter {
  constructor(file, {
    maxBytes = DEFAULT_MAX_BYTES,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    flushIntervalMs = 200,
    redact = redactDiagnosticText,
    onError = null,
  } = {}) {
    this.file = file;
    this.rotatedFile = `${file}.1`;
    this.maxBytes = boundedInteger(maxBytes, DEFAULT_MAX_BYTES, 1024, DEFAULT_MAX_BYTES);
    this.maxBufferBytes = boundedInteger(
      maxBufferBytes,
      DEFAULT_MAX_BUFFER_BYTES,
      1024,
      DEFAULT_MAX_BUFFER_BYTES,
    );
    this.flushIntervalMs = boundedInteger(flushIntervalMs, 200, 10, 60_000);
    this.redact = typeof redact === 'function' ? redact : redactDiagnosticText;
    this.onError = typeof onError === 'function' ? onError : null;
    this.buffer = '';
    this.timer = null;
    this.operation = Promise.resolve();
    this.closed = false;
    this.droppedBytes = 0;
    this.lastError = null;
  }

  flushInBackground() {
    // Disk-full, permission, and unsafe-path failures are recoverable for the
    // application. Keep them observable without allowing a timer-triggered
    // Promise rejection to terminate Electron under strict rejection policy.
    this.flush().catch((error) => {
      this.lastError = error;
      try {
        this.onError?.(error);
      } catch {
        // Diagnostics must never turn an expected log I/O failure into another
        // uncaught exception. The original error remains in lastError.
      }
    });
  }

  append(value) {
    if (this.closed) return false;
    const chunk = this.redact(value);
    if (!chunk) return true;
    this.buffer += chunk;
    const size = Buffer.byteLength(this.buffer);
    if (size > this.maxBufferBytes) {
      const retained = Buffer.from(this.buffer).subarray(size - this.maxBufferBytes).toString('utf8');
      this.droppedBytes += size - Buffer.byteLength(retained);
      this.buffer = retained;
    }
    if (Buffer.byteLength(this.buffer) >= Math.min(64 * 1024, this.maxBufferBytes)) {
      this.flushInBackground();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushInBackground();
      }, this.flushIntervalMs);
      this.timer.unref?.();
    }
    return true;
  }

  takeBuffer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let chunk = this.buffer;
    this.buffer = '';
    if (this.droppedBytes) {
      chunk = `[log writer dropped ${this.droppedBytes} buffered bytes]\n${chunk}`;
      this.droppedBytes = 0;
    }
    return chunk;
  }

  enqueue(operation) {
    const next = this.operation.then(operation, operation);
    this.operation = next.catch(() => {});
    return next;
  }

  async rotateFor(incomingBytes) {
    let opened;
    try {
      opened = await openVerifiedRegular(this.file, fs.constants.O_RDONLY);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    try {
      if (opened.stat.size + incomingBytes <= this.maxBytes) return;
      await replaceWithPrivateFile(this.rotatedFile, async (destination) => {
        await copyTail(opened.handle, opened.stat.size, destination, this.maxBytes);
      });
      await recheckOpenPath(this.file, opened.handle, opened.stat);
    } finally {
      await opened.handle.close().catch(() => {});
    }

    await replaceWithPrivateFile(this.file, async () => {});
  }

  async appendChunk(chunk) {
    await ensurePrivateDirectory(this.file);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.rotateFor(chunk.length);
      const opened = await openVerifiedRegular(
        this.file,
        fs.constants.O_WRONLY | fs.constants.O_APPEND,
        { create: true },
      );
      try {
        if (opened.stat.size + chunk.length > this.maxBytes) continue;
        await writeAll(opened.handle, chunk);
        const written = await opened.handle.stat();
        if (written.size > this.maxBytes) {
          throw unsafeLogPath(this.file, 'grew beyond the fixed size limit during append');
        }
        await recheckOpenPath(this.file, opened.handle, opened.stat);
        return;
      } finally {
        await opened.handle.close().catch(() => {});
      }
    }
    throw unsafeLogPath(this.file, 'changed repeatedly while enforcing the size limit');
  }

  flush() {
    const buffered = this.takeBuffer();
    if (!buffered) return this.operation;
    return this.enqueue(async () => {
      let chunk = Buffer.from(buffered);
      if (chunk.length > this.maxBytes) chunk = chunk.subarray(chunk.length - this.maxBytes);
      await this.appendChunk(chunk);
    });
  }

  reset() {
    this.takeBuffer();
    this.droppedBytes = 0;
    return this.enqueue(async () => {
      await replaceWithPrivateFile(this.file, async () => {});
    });
  }

  async close() {
    if (this.closed) return this.operation;
    this.closed = true;
    await this.flush();
    await this.operation;
  }
}

async function readLogTail(file, { maxBytes = DEFAULT_TAIL_BYTES, maxLines = 300 } = {}) {
  let opened;
  try {
    opened = await openVerifiedRegular(file, fs.constants.O_RDONLY);
    const boundedBytes = boundedInteger(maxBytes, DEFAULT_TAIL_BYTES, 1024, DEFAULT_MAX_BYTES);
    const boundedLines = boundedInteger(maxLines, 300, 1, MAX_TAIL_LINES);
    const length = Math.min(opened.stat.size, boundedBytes);
    const buffer = Buffer.alloc(length);
    let total = 0;
    while (total < length) {
      const { bytesRead } = await opened.handle.read(
        buffer,
        total,
        length - total,
        opened.stat.size - length + total,
      );
      if (bytesRead <= 0) break;
      total += bytesRead;
    }
    await recheckOpenPath(file, opened.handle, opened.stat);

    let text = buffer.subarray(0, total).toString('utf8');
    if (opened.stat.size > total) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) text = text.slice(firstNewline + 1);
    }
    const lines = text.split('\n');
    return lines.slice(-boundedLines).join('\n');
  } catch {
    return '';
  } finally {
    await opened?.handle.close().catch(() => {});
  }
}

module.exports = {
  BufferedLogWriter,
  DEFAULT_MAX_BYTES,
  DEFAULT_TAIL_BYTES,
  readLogTail,
  redactDiagnosticText,
};
