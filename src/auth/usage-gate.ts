import { loadConfig, saveConfig, incrementUsage } from './config-manager.js';

const VERIFY_URL = 'https://templates.snipcss.com/api/verify_claude_skill';
const FREE_LIMIT = 25;
const CACHE_HOURS = 24;

export interface AccessResult {
  allowed: boolean;
  message?: string;
  isPro?: boolean;
  remaining?: number;
}

export async function verifyApiKey(apiKey: string): Promise<{ isPro: boolean; email?: string; error?: string }> {
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    const data = await res.json();
    if (data.success && data.is_pro) {
      return { isPro: true, email: data.email };
    }
    return { isPro: false, error: data.error || 'Not a Pro account' };
  } catch (err: any) {
    return { isPro: false, error: `Verification failed: ${err.message}` };
  }
}

export async function checkAccess(): Promise<AccessResult> {
  const config = loadConfig();

  // If user has an API key, try to verify Pro status
  if (config.apiKey) {
    // Check if we have a cached verification that's still fresh
    if (config.lastVerified && config.verifiedPro) {
      const verifiedAt = new Date(config.lastVerified).getTime();
      const now = Date.now();
      const hoursSince = (now - verifiedAt) / (1000 * 60 * 60);
      if (hoursSince < CACHE_HOURS) {
        return { allowed: true, isPro: true };
      }
    }

    // Verify with the API
    const result = await verifyApiKey(config.apiKey);
    if (result.isPro) {
      config.verifiedPro = true;
      config.lastVerified = new Date().toISOString();
      saveConfig(config);
      return { allowed: true, isPro: true };
    }

    // Key exists but not Pro — clear cached status and fall through to free tier
    config.verifiedPro = false;
    delete config.lastVerified;
    saveConfig(config);
  }

  // Free tier: check usage count
  if (config.usageCount < FREE_LIMIT) {
    const newCount = incrementUsage();
    const remaining = FREE_LIMIT - newCount;
    return {
      allowed: true,
      isPro: false,
      remaining,
      message: remaining <= 3
        ? `${remaining} free extraction${remaining === 1 ? '' : 's'} remaining. Get unlimited extractions with SnipCSS Pro: https://www.snipcss.com/pricing`
        : undefined,
    };
  }

  // Over the free limit
  return {
    allowed: false,
    isPro: false,
    remaining: 0,
    message:
      'You have used all 25 free extractions. To continue, upgrade to SnipCSS Pro at https://www.snipcss.com/pricing and then set your API key using the set_api_key tool. Your API key can be found on your dashboard at https://www.snipcss.com/dashboard',
  };
}
