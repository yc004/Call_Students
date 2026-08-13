function parseStudentNames(value) {
  const names = String(value || '')
    .split(/[\n\r,，、;；\t]+/)
    .map(item => item.trim())
    .filter(Boolean);
  return Array.from(new Set(names));
}

module.exports = { parseStudentNames };
