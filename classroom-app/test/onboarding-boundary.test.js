const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('classroom onboarding is limited to the initial homeroom binding', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'renderer/onboarding/onboarding.js'), 'utf8');

  assert.match(main, /function createOnboardingWindow\(\)\s*\{[\s\S]*?if \(isHomeroomBound\(\)\)/);
  assert.match(main, /if \(!isHomeroomBound\(\)\)\s*\{\s*createOnboardingWindow\(\)/);
  assert.doesNotMatch(preload, /approvePendingTeacher|rejectPendingTeacher|transferHomeroomTeacher/);
  assert.doesNotMatch(onboarding, /approvePendingTeacher|rejectPendingTeacher|transferHomeroomTeacher/);
});
