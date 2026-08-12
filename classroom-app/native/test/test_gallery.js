'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  AdaptiveGalleryManager,
  LEGACY_EMBEDDING_MODEL,
  SFACE_EMBEDDING_MODEL,
} = require('../../face-gallery');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'call-students-gallery-'));
const galleryPath = path.join(tempDir, 'gallery.json');

try {
  const descriptor = Array.from({ length: 128 }, (_, index) => index / 128);
  fs.writeFileSync(galleryPath, JSON.stringify({
    students: [{
      id: 'student-1',
      name: '测试学生',
      registeredDescriptors: [descriptor],
      adaptiveDescriptors: [],
    }],
  }));

  const migrated = new AdaptiveGalleryManager(galleryPath, SFACE_EMBEDDING_MODEL);
  migrated.load();
  const metadata = migrated.getMetadata();
  assert.strictEqual(metadata.embeddingModel, SFACE_EMBEDDING_MODEL);
  assert.strictEqual(metadata.migration.from, LEGACY_EMBEDDING_MODEL);
  assert.strictEqual(metadata.migration.required, true);
  assert.strictEqual(migrated.getAllStudentIds().length, 0);
  assert.strictEqual(migrated.getConfig().recognitionThreshold, 0.363);
  assert.ok(metadata.migration.backupPath);
  assert.ok(fs.existsSync(metadata.migration.backupPath));

  const backup = JSON.parse(fs.readFileSync(metadata.migration.backupPath, 'utf8'));
  assert.strictEqual(backup.students.length, 1);
  assert.strictEqual(backup.students[0].id, 'student-1');

  const persisted = JSON.parse(fs.readFileSync(galleryPath, 'utf8'));
  assert.strictEqual(persisted.embeddingModel, SFACE_EMBEDDING_MODEL);
  assert.strictEqual(persisted.students.length, 0);

  const reloaded = new AdaptiveGalleryManager(galleryPath, SFACE_EMBEDDING_MODEL);
  reloaded.load();
  assert.strictEqual(reloaded.getMetadata().migration.required, true);
  assert.strictEqual(reloaded.getAllStudentIds().length, 0);

  const matchingPath = path.join(tempDir, 'matching-gallery.json');
  const enrolledDescriptor = Array.from({ length: 128 }, (_, index) => index === 0 ? 1 : 0);
  const otherDescriptor = Array.from({ length: 128 }, (_, index) => index === 1 ? 1 : 0);
  fs.writeFileSync(matchingPath, JSON.stringify({
    embeddingModel: SFACE_EMBEDDING_MODEL,
    students: [{
      id: 'student-known',
      name: '已标注学生',
      registeredDescriptors: [enrolledDescriptor],
      adaptiveDescriptors: [],
    }],
  }));
  const matching = new AdaptiveGalleryManager(matchingPath, SFACE_EMBEDDING_MODEL);
  matching.load();
  const knownMatch = matching.findBestMatch(new Float32Array(enrolledDescriptor));
  assert.strictEqual(knownMatch.studentId, 'student-known');
  assert.strictEqual(knownMatch.name, '已标注学生');
  assert.ok(knownMatch.similarity > 0.999);
  assert.ok(matching.findBestMatch(new Float32Array(otherDescriptor)).similarity < matching.getConfig().recognitionThreshold);

  console.log('[test] gallery migration, reload, and known-face matching passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
