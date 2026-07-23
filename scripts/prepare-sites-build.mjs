import {copyFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const serverDirectory = path.join(projectRoot, 'dist', 'server');

await mkdir(serverDirectory, {recursive: true});
await copyFile(
  path.join(projectRoot, 'hosting', 'worker.js'),
  path.join(serverDirectory, 'index.js'),
);
