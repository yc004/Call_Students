const BIOMETRIC_KEY = /(?:face|descriptor|embedding|crop[_-]?base64|biometric|similarity)/i;

export function containsProhibitedBiometricData(value:unknown, depth = 0):boolean {
  // Payloads that exceed the inspection budget are rejected: treating an
  // uninspectable value as safe would let callers hide biometric data deeper.
  if (depth > 8) return true;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return /^data:image\//i.test(value);
  if (Array.isArray(value)) return value.some(item => containsProhibitedBiometricData(item, depth + 1));
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
    (key !== 'faceLanRequired' && BIOMETRIC_KEY.test(key)) || containsProhibitedBiometricData(nested, depth + 1));
}
