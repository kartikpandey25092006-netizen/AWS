/*
 * Phase 2: Scaling / Ramp Test
 * ────────────────────────────
 * Goal: Find the breaking point. Ramp from 10 → 500 concurrent users.
 *       Monitor when latency degrades and errors appear.
 * 
 * Run with:  k6 run phase2-ramp.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Configuration ────────────────────────────────────────────
const TARGET = __ENV.TARGET_URL;
if (!TARGET) throw new Error('Set TARGET_URL to the HTTPS CloudFront URL for the deployment under test.');
const MAX_VUS = Number(__ENV.MAX_VUS || 25);
if (!Number.isInteger(MAX_VUS) || MAX_VUS < 5 || MAX_VUS > 100) {
  throw new Error('MAX_VUS must be an integer between 5 and 100.');
}

// Custom metrics
const errorRate = new Rate('errors');
const timeouts = new Counter('timeouts');

// ── Test Options ─────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s',  target: 5 },
    { duration: '1m',   target: Math.ceil(MAX_VUS / 2) },
    { duration: '1m',   target: MAX_VUS },
    { duration: '1m',   target: MAX_VUS },
    { duration: '1m',   target: 0 },     // Cool down
  ],
  thresholds: {
    // These thresholds are intentionally loose — we WANT to find the breaking point
    http_req_duration: ['p(99)<5000'],    // 99th percentile < 5s
    errors: ['rate<0.5'],                // Allow up to 50% errors at peak
  },
  // Prevent k6 from opening too many sockets on your Mac
  batch: 20,
  batchPerHost: 20,
};

// ── Test Scenario ────────────────────────────────────────────
export default function () {
  const params = {
    timeout: '10s',  // Don't hang forever on slow responses
  };

  const res = http.get(`${TARGET}/`, params);

  const passed = check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 2s':  (r) => r.timings.duration < 2000,
  });

  errorRate.add(!passed);

  if (res.timings.duration >= 10000) {
    timeouts.add(1);
  }

  // Minimal think time at high concurrency to maximize pressure
  sleep(0.1);
}

// ── Summary Reporter ─────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    phase: 'Phase 2 - Scaling Ramp',
    timestamp: new Date().toISOString(),
    target: TARGET,
    metrics: {
      total_requests: data.metrics.http_reqs?.values?.count || 0,
      peak_rps: (data.metrics.http_reqs?.values?.rate || 0).toFixed(2),
      avg_latency_ms: (data.metrics.http_req_duration?.values?.avg || 0).toFixed(2),
      p50_latency_ms: (data.metrics.http_req_duration?.values?.['p(50)'] || 0).toFixed(2),
      p95_latency_ms: (data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2),
      p99_latency_ms: (data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2),
      max_latency_ms: (data.metrics.http_req_duration?.values?.max || 0).toFixed(2),
      error_rate: (data.metrics.errors?.values?.rate || 0).toFixed(4),
      total_timeouts: data.metrics.timeouts?.values?.count || 0,
    },
  };

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/phase2-results.json': JSON.stringify(summary, null, 2),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
