import fs from 'fs';
import path from 'path';

const IS_PLATFORM = process.env.APIFY_IS_AT_HOME === '1';

let logStream: fs.WriteStream | null = null;
let latestStream: fs.WriteStream | null = null;

export async function initLogger(logsDir: string): Promise<void> {
  if (IS_PLATFORM) return;
  fs.mkdirSync(logsDir, { recursive: true });

  const ts = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
  const datedPath = path.join(logsDir, `${ts}.log`);
  const latestPath = path.join(logsDir, 'latest.log');

  logStream = fs.createWriteStream(datedPath, { flags: 'a' });
  latestStream = fs.createWriteStream(latestPath, { flags: 'w' });

  const header = `[${new Date().toISOString()}] LOG_FILE path=${datedPath}\n`;
  logStream.write(header);
  latestStream.write(header);
}

export function log(message: string): void {
  if (IS_PLATFORM || (!logStream && !latestStream)) return;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  logStream?.write(line);
  latestStream?.write(line);
}

export async function closeLogger(): Promise<void> {
  if (IS_PLATFORM) return;
  await Promise.all([
    logStream && new Promise<void>((r) => logStream!.end(r)),
    latestStream && new Promise<void>((r) => latestStream!.end(r)),
  ]);
  logStream = null;
  latestStream = null;
}
