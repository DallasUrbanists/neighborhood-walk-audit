import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('keeps the interface zoomable and exposes mobile map safeguards', async () => {
  const [html, css, javascript] = await Promise.all([
    fs.readFile('public/index.html', 'utf8'),
    fs.readFile('public/styles.css', 'utf8'),
    fs.readFile('public/app.js', 'utf8')
  ]);

  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i);
  assert.match(css, /--tap:\s*3\.25rem/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /\.map-crosshair/);
  assert.match(javascript, /Add corner/);
  assert.match(javascript, /enableHighAccuracy:\s*true/);
  assert.match(javascript, /Saved on phone/);
  assert.match(javascript, /touchZoom:\s*true/);
});
