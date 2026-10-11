/*
 * Phase 1: Baseline Pilot Test
 * ─────────────────────────────
 * Goal: Establish normal performance metrics under light load.
 * 
 * Run with:  k6 run phase1-baseline.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// ── Configuration ────────────────────────────────────────────
const TARGET = __ENV.TARGET_URL;
if (!TARGET) throw new Error('Set TARGET_URL to the HTTPS CloudFront URL for the deployment under test.');

// Custom metrics
const errorRate = new Rate('errors');
const latency = new Trend('response_time', true);

// ── Test Options ─────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m',  target: 10 },   // Hold at 10 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile < 500ms
    errors: ['rate<0.01'],             // Error rate < 1%
  },
};

// ── Test Scenario ────────────────────────────────────────────
export default function () {
  // 1. Hit the main page
  const mainPage = http.get(`${TARGET}/`);
  check(mainPage, {
    'main page status 200': (r) => r.status === 200,
    'main page has content': (r) => r.body && r.body.length > 0,
  });
  errorRate.add(mainPage.status !== 200);
  latency.add(mainPage.timings.duration);

  // 2. Hit the health endpoint
  const health = http.get(`${TARGET}/health`);
  check(health, {
    'health endpoint status 200': (r) => r.status === 200,
  });
  errorRate.add(health.status !== 200);

  // Small pause between iterations (simulates real user think time)
  sleep(1);
}

// ── Summary Reporter ─────────────────────────────────────────
export function handleSummary(data) {
  const summary = {
    phase: 'Phase 1 - Baseline',
    timestamp: new Date().toISOString(),
    target: TARGET,
    metrics: {
      total_requests: data.metrics.http_reqs?.values?.count || 0,
      rps: (data.metrics.http_reqs?.values?.rate || 0).toFixed(2),
      avg_latency_ms: (data.metrics.http_req_duration?.values?.avg || 0).toFixed(2),
      p50_latency_ms: (data.metrics.http_req_duration?.values?.['p(50)'] || 0).toFixed(2),
      p95_latency_ms: (data.metrics.http_req_duration?.values?.['p(95)'] || 0).toFixed(2),
      p99_latency_ms: (data.metrics.http_req_duration?.values?.['p(99)'] || 0).toFixed(2),
      error_rate: (data.metrics.errors?.values?.rate || 0).toFixed(4),
    },
  };

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'results/phase1-results.json': JSON.stringify(summary, null, 2),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
