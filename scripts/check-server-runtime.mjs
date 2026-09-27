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
        await handler({ method: isCopilot ? 'POST' : 'GET', headers: {} }, response);
        assert.equal(status, 503);
        assert.match(body.error, /not configured/);
        assert.match(headers['Cache-Control'], /no-store/);
        if (isCopilot) assert.equal(body.code, 'GEMINI_NOT_CONFIGURED');
      }
      console.log('Native Node ESM check passed: both deployed API entry points load and return controlled responses.');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, GEMINI_API_KEY: '', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
