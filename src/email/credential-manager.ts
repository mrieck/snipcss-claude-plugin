import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ImapCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export interface EmailConfig {
  accounts: {
    [label: string]: ImapCredentials;
  };
  defaultAccount?: string;
}

const CONFIG_DIR = join(homedir(), '.snipcss');
const EMAIL_CONFIG_FILE = join(CONFIG_DIR, 'email.json');

const PROVIDER_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
  icloud: { host: 'imap.mail.me.com', port: 993, secure: true },
};

const DEFAULT_CONFIG: EmailConfig = {
  accounts: {},
};

export function getProviderPreset(provider: string): { host: string; port: number; secure: boolean } | undefined {
  return PROVIDER_PRESETS[provider.toLowerCase()];
}

export function loadEmailConfig(): EmailConfig {
  try {
    if (!existsSync(EMAIL_CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, accounts: {} };
    }
    const raw = readFileSync(EMAIL_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG, accounts: {} };
  }
}

export function saveEmailConfig(config: EmailConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(EMAIL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  try {
    chmodSync(EMAIL_CONFIG_FILE, 0o600);
  } catch {
    // chmod may not work on Windows, that's OK
  }
}

export function setAccount(label: string, creds: ImapCredentials): void {
  const config = loadEmailConfig();
  config.accounts[label] = creds;
  if (!config.defaultAccount) {
    config.defaultAccount = label;
  }
  saveEmailConfig(config);
}

export function getAccount(label?: string): ImapCredentials | null {
  const config = loadEmailConfig();
  const accountLabel = label || config.defaultAccount;
  if (!accountLabel) return null;
  return config.accounts[accountLabel] || null;
}

export function removeAccount(label: string): void {
  const config = loadEmailConfig();
  delete config.accounts[label];
  if (config.defaultAccount === label) {
    const remaining = Object.keys(config.accounts);
    config.defaultAccount = remaining.length > 0 ? remaining[0] : undefined;
  }
  saveEmailConfig(config);
}

export function listAccounts(): string[] {
  const config = loadEmailConfig();
  return Object.keys(config.accounts);
}
