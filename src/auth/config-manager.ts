import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SnipcssConfig {
  apiKey?: string;
  usageCount: number;
  lastVerified?: string;
  verifiedPro?: boolean;
}

const CONFIG_DIR = join(homedir(), '.snipcss');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: SnipcssConfig = {
  usageCount: 0,
};

export function loadConfig(): SnipcssConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: SnipcssConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

export function getUsageCount(): number {
  return loadConfig().usageCount;
}

export function incrementUsage(): number {
  const config = loadConfig();
  config.usageCount++;
  saveConfig(config);
  return config.usageCount;
}

export function setApiKey(key: string): void {
  const config = loadConfig();
  config.apiKey = key;
  // Clear cached verification when key changes
  delete config.lastVerified;
  delete config.verifiedPro;
  saveConfig(config);
}

export function getApiKey(): string | undefined {
  return loadConfig().apiKey;
}
