import { assertPublicHttpsUrl } from '../lib/ssrf.js';

// D1 — outbound chat notifications (Slack / Microsoft Teams incoming webhooks).
// Plain HTTPS POST, no SDK. Message formatting is pure + unit-testable; the
// network send is best-effort and never throws into the caller.

const SEND_TIMEOUT_MS = 8000;

/** Build a short chat message body from notification items (pure). */
export function formatChatMessage(items, { max = 10 } = {}) {
  const shown = items.slice(0, max);
  const lines = shown.map((i) => `• [${i.repo}] ${i.message}${i.webUrl ? ` — ${i.webUrl}` : ''}`);
  const extra = items.length > max ? `\n…and ${items.length - max} more` : '';
  const header = `*ADO PR Dashboard* — ${items.length} update${items.length === 1 ? '' : 's'}`;
  return `${header}\n${lines.join('\n')}${extra}`;
}

/** True when a Teams webhook URL is a classic O365 connector (not Workflows). */
export function teamsUsesLegacyConnector(url) {
  // Classic Office 365 "Incoming Webhook" connector endpoints. Power Automate
  // "Workflows" webhooks live on *.logic.azure.com and want an Adaptive Card.
  return /webhook\.office\.com|outlook\.office\.com|office365\.com/i.test(url || '');
}

/** Shape the per-provider request body for a webhook. */
export function chatPayload(type, text, url) {
  if (type === 'teams') {
    // Two Teams mechanisms need different payloads:
    //  • Classic O365 connector (…webhook.office.com…) → legacy MessageCard.
    //  • Power Automate "Workflows" (…logic.azure.com…) → Adaptive Card in a
    //    message/attachments envelope.
    // Default to the Adaptive Card (the modern path) for unknown hosts.
    if (teamsUsesLegacyConnector(url)) {
      return {
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: 'ADO PR Dashboard',
        text,
      };
    }
    const lines = text.split('\n').filter((l) => l.trim());
    const body = lines.map((line, i) => ({
      type: 'TextBlock',
      // The header uses *…* emphasis (for Slack); strip it for the Teams card,
      // which already renders the header bold via weight.
      text: i === 0 ? line.replace(/\*/g, '') : line,
      wrap: true,
      weight: i === 0 ? 'Bolder' : 'Default',
      size: i === 0 ? 'Medium' : 'Default',
    }));
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body,
          },
        },
      ],
    };
  }
  return { text }; // Slack (and most generic webhooks)
}

async function postOne(webhook, text) {
  // SSRF guard: only https to a public host, and never follow redirects.
  await assertPublicHttpsUrl(webhook.url);
  const body = chatPayload(webhook.type, text, webhook.url);
  const res = await fetch(webhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook ${webhook.type} responded ${res.status}`);
}

/** Post notification items to every configured chat webhook (best-effort). */
export async function postToChatWebhooks(webhooks, items) {
  if (!webhooks?.length || !items?.length) return;
  const text = formatChatMessage(items);
  await Promise.all(
    webhooks.map((w) =>
      postOne(w, text).catch((e) => console.warn(`[chat] ${w.type} (${w.name}) failed: ${e.message}`))
    )
  );
}

/** Send a test message to a single webhook, throwing on failure (for the UI). */
export async function testWebhook({ url, type }) {
  await postOne(
    { url, type: type === 'teams' ? 'teams' : 'slack', name: 'Test' },
    formatChatMessage([{ repo: 'Test', message: 'Test message from the ADO PR Dashboard — your webhook is working. 🎉', webUrl: '' }])
  );
}
