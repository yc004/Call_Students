const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const desktopCss = fs.readFileSync(path.join(__dirname, '..', 'desktop.css'), 'utf8');

test('homework cards and matrix use adaptive desktop theme surfaces', () => {
  assert.match(desktopCss, /\.hw-overview-card\s*\{[\s\S]*?color:\s*var\(--label\);[\s\S]*?background:\s*var\(--surface-solid\);/);
  assert.match(desktopCss, /\.hw-matrix\s*\{[^}]*color:\s*var\(--label\);[^}]*background:\s*var\(--surface-solid\);/);
  assert.match(desktopCss, /\.hw-matrix thead th,[\s\S]*?\.hw-matrix tbody \.hw-matrix-name\s*\{[\s\S]*?background:\s*var\(--surface-solid\);/);
  assert.match(desktopCss, /\.hw-deadline-row th:not\(\.hw-matrix-name\)\s*\{[\s\S]*?background:\s*var\(--primary-soft\) !important;/);
});

test('homework overview keeps readable card widths on wide desktop windows', () => {
  assert.match(desktopCss, /\.hw-overview-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(270px, 380px\)\);/);
  assert.match(desktopCss, /\.hw-table-wrap\s*\{[\s\S]*?max-width:\s*100%;/);
});

test('AI analysis exposes agent activity and locally generated charts', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(html, /id="aiAgentTimeline"/);
  assert.match(html, /id="aiAgentProgressive"/);
  assert.match(html, /id="aiAgentProgressiveCharts"/);
  assert.match(html, /id="aiAgentElapsed"/);
  assert.match(html, /id="aiAgentViewReport"/);
  assert.match(html, /实时分析结果/);
  assert.match(app, /function handleAiAgentActivity\(activity\)/);
  assert.match(app, /function revealAiAgentPreview\(preview\)/);
  assert.match(app, /function showAiAgentSkeletons\(\)/);
  assert.match(app, /function replaceAiSkeleton\(container, node\)/);
  assert.match(app, /function completeAiAgentWorkspace\(\)/);
  assert.match(app, /function renderAiChart\(chart\)/);
  assert.match(desktopCss, /\.ai-chart-grid\s*\{/);
  assert.match(desktopCss, /\.ai-agent-step\s*\{/);
  assert.match(desktopCss, /\.ai-agent-step\.is-entering\s*\{/);
  assert.match(desktopCss, /\.ai-agent-step\.is-leaving\s*\{/);
  assert.match(desktopCss, /linear-gradient\(90deg,transparent/);
  assert.match(desktopCss, /\.ai-report-reveal\.is-entering/);
  assert.match(desktopCss, /\.ai-result-skeleton::after/);
  assert.match(desktopCss, /@keyframes ai-skeleton-sweep/);
  assert.match(desktopCss, /@keyframes ai-chart-bar-grow/);
  assert.match(desktopCss, /@keyframes ai-chart-donut-grow/);
  assert.match(desktopCss, /\.ai-progressive-chart:not\(\.is-entering\) \.ai-bar-row i/);
});
