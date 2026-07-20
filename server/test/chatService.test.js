import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChatMessage, chatPayload } from '../src/services/chatService.js';

test('formatChatMessage lists items and truncates', () => {
  const items = Array.from({ length: 12 }, (_, i) => ({ repo: 'R', message: `msg ${i}`, webUrl: `http://x/${i}` }));
  const text = formatChatMessage(items);
  assert.match(text, /12 updates/);
  assert.match(text, /and 2 more/);
  assert.match(text, /\[R\] msg 0/);
});

test('chatPayload picks the right Teams format by URL', () => {
  assert.deepEqual(chatPayload('slack', 'hi'), { text: 'hi' });

  // Workflows webhook (logic.azure.com) → Adaptive Card envelope.
  const wf = chatPayload('teams', '*ADO PR Dashboard*\n• [Linux] a new comment', 'https://prod-1.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke');
  assert.equal(wf.type, 'message');
  assert.equal(wf.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(wf.attachments[0].content.body[0].text, 'ADO PR Dashboard'); // header un-wrapped from *…*
  assert.equal(wf.attachments[0].content.body[1].text, '• [Linux] a new comment');

  // Legacy O365 connector (webhook.office.com) → MessageCard.
  const legacy = chatPayload('teams', 'hi', 'https://acme.webhook.office.com/webhookb2/xyz');
  assert.equal(legacy['@type'], 'MessageCard');
  assert.equal(legacy.text, 'hi');

  // Unknown host defaults to the modern Adaptive Card.
  const unknown = chatPayload('teams', 'hi', 'https://example.com/hook');
  assert.equal(unknown.type, 'message');
});
