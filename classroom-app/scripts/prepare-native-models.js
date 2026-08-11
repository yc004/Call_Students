'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const modelDir = path.join(__dirname, '..', 'models', 'onnx');
const manifestPath = path.join(modelDir, 'models.json');
const verifyOnly = process.argv.includes('--verify-only');

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Call-Students-model-preparer' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) return reject(new Error(`too many redirects for ${url}`));
        return resolve(download(new URL(response.headers.location, url).toString(), destination, redirectsLeft - 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`download failed (${response.statusCode}) for ${url}`));
      }
      const output = fs.createWriteStream(destination, { flags: 'wx' });
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
  });
}

function verify(model) {
  const filePath = path.join(modelDir, model.file);
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'missing' };
  const stat = fs.statSync(filePath);
  if (stat.size !== model.bytes) return { ok: false, reason: `size ${stat.size}, expected ${model.bytes}` };
  const digest = sha256(filePath);
  if (digest !== model.sha256) return { ok: false, reason: `sha256 ${digest}, expected ${model.sha256}` };
  return { ok: true };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.mkdirSync(modelDir, { recursive: true });

  for (const model of manifest.models) {
    let result = verify(model);
    if (!result.ok && !verifyOnly) {
      const destination = path.join(modelDir, model.file);
      const partial = `${destination}.part`;
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
      console.log(`[models] downloading ${model.file}`);
      try {
        await download(model.source, partial);
        const downloaded = { ...model, file: path.basename(partial) };
        const partialResult = verify(downloaded);
        if (!partialResult.ok) throw new Error(partialResult.reason);
        fs.renameSync(partial, destination);
      } catch (error) {
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
        throw error;
      }
      result = verify(model);
    }
    if (!result.ok) throw new Error(`${model.file}: ${result.reason}`);
    console.log(`[models] verified ${model.file}`);
  }
}

main().catch(error => {
  console.error(`[models] ${error.message}`);
  process.exitCode = 1;
});
