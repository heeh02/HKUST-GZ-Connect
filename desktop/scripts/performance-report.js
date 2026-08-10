'use strict';

const PERFORMANCE_REPORT_PREFIX = 'HKUSTGZ_DESKTOP_PERF_JSON ';
const PERFORMANCE_REPORT_SCHEMA = 'hkustgzconnect.desktop-performance.v1';
const MAX_PERFORMANCE_REPORT_BYTES = 16 * 1024;

function performanceReportLine(report, {
  prefix = PERFORMANCE_REPORT_PREFIX,
  maxBytes = MAX_PERFORMANCE_REPORT_BYTES,
} = {}) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new TypeError('performance report must be an object');
  }
  if (report.schema !== PERFORMANCE_REPORT_SCHEMA) {
    throw new Error('performance report schema is invalid');
  }
  const line = `${prefix}${JSON.stringify(report)}`;
  if (line.includes('\n') || Buffer.byteLength(line, 'utf8') > maxBytes) {
    throw new Error('performance report exceeds the bounded one-line contract');
  }
  return line;
}

function writePerformanceReport(report, {
  output = process.stdout,
  prefix,
  maxBytes,
} = {}) {
  const line = performanceReportLine(report, { prefix, maxBytes });
  output.write(`${line}\n`);
  return Buffer.byteLength(line, 'utf8');
}

module.exports = {
  MAX_PERFORMANCE_REPORT_BYTES,
  PERFORMANCE_REPORT_PREFIX,
  PERFORMANCE_REPORT_SCHEMA,
  performanceReportLine,
  writePerformanceReport,
};
