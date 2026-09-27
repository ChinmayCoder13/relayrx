// Vite and tsx accept extensionless imports that native Node ESM cannot load.
// Compile the complete API graph and invoke its emitted JS without a TS loader.
import ts from 'typescript';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = mkdtempSync(join(root, '.server-check-'));
const host = {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic(diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  },
};

try {
  const config = ts.getParsedCommandLineOfConfigFile(join(root, 'tsconfig.server.json'), {
    noEmit: false, incremental: false, rootDir: root, outDir: output,
  }, host);
  if (!config) throw new Error('Could not load server TypeScript configuration.');
  const program = ts.createProgram(config.fileNames, config.options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }));
    process.exitCode = 1;
  } else {
    const emitted = program.emit();
    if (emitted.emitSkipped) throw new Error('Server JavaScript was not emitted.');
    const script = `
      import assert from 'node:assert/strict';
      const entries = ${JSON.stringify(['api/copilot.js', 'api/workspace.js'].map(path => pathToFileURL(join(output, path)).href))};
      for (const url of entries) {
        const { default: handler } = await import(url);
        assert.equal(typeof handler, 'function');
        let status, body;
        const headers = {};
        const response = {
          status(code) { status = code; return response; },
          json(value) { body = value; },
          setHeader(name, value) { headers[name] = value; },
        };
        const isCopilot = url.endsWith('/copilot.js');
        const request = { method: isCopilot ? 'POST' : 'GET', headers: {} };
        if (isCopilot) {
          const { createCase } = await import(new URL('../src/domain/seed.js', url));
          const { copilotKey } = await import(new URL('../src/domain/copilot.js', url));
          const c = createCase('Synthetic', 'Example', 'No refills remaining');
          request.headers['content-type'] = 'application/json';
          request.body = { case: c, role: 'staff', question: 'Why is this blocked?', snapshotKey: copilotKey(c, 'staff'), history: [] };
        }
        const originalLog = console.error;
        try { console.error = () => {}; await handler(request, response); }
        finally { console.error = originalLog; }
        assert.equal(status, isCopilot ? 200 : 503);
        if (isCopilot) { assert.equal(body.provider, 'Logic Engine'); assert.match(body.text, /Offline Mode: Logic Engine Backup/); }
        else assert.match(body.error, /not configured/);
        assert.match(headers['Cache-Control'], /no-store/);
        if (isCopilot) assert.equal(body.code, 'GEMINI_NOT_CONFIGURED');
      }
      console.log('Native Node ESM check passed: both deployed API entry points load and return controlled responses.');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, GEMINI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', VITE_DATA_MODE: 'demo', DEMO_COPILOT_ENABLED: 'true' },
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
