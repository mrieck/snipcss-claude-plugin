import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ImapCredentials } from './credential-manager.js';

export interface EmailSummary {
  uid: number;
  subject: string;
  from: string;
  date: string;
  hasHtml: boolean;
}

export interface EmailContent {
  uid: number;
  subject: string;
  from: string;
  date: string;
  html: string;
  text: string;
}

function createClient(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: {
      user: creds.user,
      pass: creds.password,
    },
    logger: false,
  });
}

export async function testConnection(creds: ImapCredentials): Promise<{ success: boolean; error?: string }> {
  const client = createClient(creds);
  try {
    await client.connect();
    await client.logout();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

export async function searchEmails(
  creds: ImapCredentials,
  query: {
    from?: string;
    subject?: string;
    since?: string;
    mailbox?: string;
    limit?: number;
  }
): Promise<EmailSummary[]> {
  const client = createClient(creds);
  const results: EmailSummary[] = [];

  try {
    await client.connect();

    const mailbox = query.mailbox || 'INBOX';
    await client.mailboxOpen(mailbox);

    // Build IMAP search criteria
    const searchCriteria: any = {};
    if (query.from) searchCriteria.from = query.from;
    if (query.subject) searchCriteria.subject = query.subject;
    if (query.since) searchCriteria.since = new Date(query.since);

    // If no criteria provided, just get recent messages
    const criteria = Object.keys(searchCriteria).length > 0 ? searchCriteria : 'ALL';

    const limit = query.limit || 10;

    // Search and fetch envelopes
    const messages: Array<{ uid: number; envelope?: any; bodyStructure?: any }> = [];
    for await (const msg of client.fetch(criteria, { envelope: true, bodyStructure: true, uid: true })) {
      messages.push(msg);
    }

    // Sort by date descending (newest first) and limit
    messages.sort((a, b) => {
      const dateA = a.envelope?.date ? new Date(a.envelope.date).getTime() : 0;
      const dateB = b.envelope?.date ? new Date(b.envelope.date).getTime() : 0;
      return dateB - dateA;
    });

    const limited = messages.slice(0, limit);

    for (const msg of limited) {
      const env = msg.envelope;
      const fromAddr = env?.from?.[0];
      const fromStr = fromAddr
        ? (fromAddr.name ? `${fromAddr.name} <${fromAddr.address}>` : fromAddr.address || 'unknown')
        : 'unknown';

      // Check if message has HTML part
      const hasHtml = bodyStructureHasHtml(msg.bodyStructure);

      results.push({
        uid: msg.uid,
        subject: env?.subject || '(no subject)',
        from: fromStr,
        date: env?.date ? new Date(env.date).toISOString() : 'unknown',
        hasHtml,
      });
    }

    await client.logout();
  } catch (err: any) {
    try { await client.logout(); } catch { /* ignore cleanup errors */ }
    throw new Error(`IMAP search failed: ${err.message || String(err)}`);
  }

  return results;
}

function bodyStructureHasHtml(structure: any): boolean {
  if (!structure) return false;
  if (structure.type === 'text/html') return true;
  if (structure.childNodes) {
    return structure.childNodes.some((child: any) => bodyStructureHasHtml(child));
  }
  return false;
}

export async function getEmailHtml(
  creds: ImapCredentials,
  uid: number,
  mailbox?: string
): Promise<EmailContent> {
  const client = createClient(creds);

  try {
    await client.connect();
    await client.mailboxOpen(mailbox || 'INBOX');

    // Fetch the full message source by UID
    const downloadResult = await client.download(String(uid), undefined, { uid: true });

    if (!downloadResult || !downloadResult.content) {
      throw new Error(`Email with UID ${uid} not found`);
    }

    // Read the stream into a buffer
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResult.content) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawEmail = Buffer.concat(chunks);

    // Parse the MIME message
    const parsed = await simpleParser(rawEmail);

    if (!parsed.html && !parsed.textAsHtml) {
      throw new Error('Email has no HTML content');
    }

    const fromAddr = parsed.from?.value?.[0];
    const fromStr = fromAddr
      ? (fromAddr.name ? `${fromAddr.name} <${fromAddr.address}>` : fromAddr.address || 'unknown')
      : 'unknown';

    await client.logout();

    return {
      uid,
      subject: parsed.subject || '(no subject)',
      from: fromStr,
      date: parsed.date ? parsed.date.toISOString() : 'unknown',
      html: (parsed.html as string) || parsed.textAsHtml || '',
      text: parsed.text || '',
    };
  } catch (err: any) {
    try { await client.logout(); } catch { /* ignore cleanup errors */ }
    throw new Error(`Failed to fetch email: ${err.message || String(err)}`);
  }
}
