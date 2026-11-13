import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
const SCREENSHOT_DIR = path.resolve('screenshots');

function startPreviewServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => reject(new Error('Preview server startup timeout')), 15000);
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text.includes(String(PORT))) {
        clearTimeout(timer);
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Preview server exited early with code ${code}`));
    });
  });
}

async function captureStable(page, filename) {
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__LUNA_DEBUG__.setPaused(true));
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, filename),
    animations: 'disabled',
    timeout: 20000,
  });
  await page.evaluate(() => window.__LUNA_DEBUG__.setPaused(false));
}

async function main() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const server = await startPreviewServer();
  const executablePath = fs.existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : '/usr/bin/google-chrome';

  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
      ],
    });

    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];

    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') {
        errors.push(`console.error: ${text}`);
      } else if (
        text.includes('THREE.WebGLProgram: Shader Error') ||
        text.includes('WebGL: INVALID_')
      ) {
        errors.push(`webgl.warning: ${text}`);
      }
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__LUNA_DEBUG__?.isReady), { timeout: 25000 });

    const initialInfo = await page.evaluate(() => window.__LUNA_DEBUG__.getRenderInfo());
    console.log('Initial render info:', JSON.stringify(initialInfo));

    await captureStable(page, '01-overview.png');

    await page.evaluate(() => window.__LUNA_DEBUG__.setCameraPreset('waterfall-sanctuary', false));
    await captureStable(page, '02-waterfall.png');

    await page.evaluate(() => {
      window.__LUNA_DEBUG__.setCameraPreset('valley-overview', false);
      window.__LUNA_DEBUG__.setWeather('moonlight');
    });
    await captureStable(page, '03-moonlight.png');

    // Exercise quality tiers, Eco Mode, and click interaction
    await page.evaluate(() => {
      window.__LUNA_DEBUG__.setQuality('low');
      window.__LUNA_DEBUG__.setEcoMode(true);
    });
    await page.waitForTimeout(250);
    await page.mouse.click(480, 320);
    await page.waitForTimeout(250);

    // Check VRAM disposal leak
    const afterDispose = await page.evaluate(() => {
      window.__LUNA_DEBUG__.disposeScene();
      return window.__LUNA_DEBUG__.getRenderInfo();
    });
    console.log('After dispose info:', JSON.stringify(afterDispose));

    if (afterDispose.geometries > 2 || afterDispose.textures > 6) {
      throw new Error(
        `Potential VRAM leak after dispose: geometries=${afterDispose.geometries}, textures=${afterDispose.textures}`,
      );
    }

    if (errors.length > 0) {
      throw new Error(`Console/WebGL errors detected:\n${errors.join('\n')}`);
    }

    console.log('Smoke test PASSED cleanly.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
