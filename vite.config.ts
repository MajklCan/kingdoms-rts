import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

function git(command: string): string {
  try {
    return execSync(command, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const gitCommit = git('git rev-parse --short=8 HEAD');
const gitBranch = git('git rev-parse --abbrev-ref HEAD');
const gitStatus = git('git status --porcelain');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __GIT_COMMIT__: JSON.stringify(gitCommit),
    __GIT_BRANCH__: JSON.stringify(gitBranch),
    __GIT_DIRTY__: JSON.stringify(gitStatus !== '' && gitStatus !== 'unknown'),
  },
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, 'src/sim'),
      '@render': path.resolve(__dirname, 'src/render'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@debug': path.resolve(__dirname, 'src/debug'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
