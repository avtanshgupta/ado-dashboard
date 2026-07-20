/**
 * AI Planning Service — GitHub Copilot API integration.
 * Parses natural language into structured tasks using GitHub Copilot's
 * chat completions API. Falls back to rule-based parsing when unavailable.
 */

const COPILOT_API_BASE = 'https://api.github.com/copilot';
const COPILOT_MODELS_URL = 'https://api.github.com/copilot/models';

// GitHub Copilot token is provided via environment or user config
function getCopilotToken() {
  return process.env.GITHUB_COPILOT_TOKEN || process.env.GITHUB_TOKEN || null;
}

const SYSTEM_PROMPT = `You are a planning assistant for a software engineer. Your job is to parse natural language input into structured task items.

Rules:
- Extract individual actionable tasks from the input
- Classify each as "daily" or "weekly" based on scope/complexity
- If a date is mentioned (e.g. "tomorrow", "Monday", "this week"), include it
- If a task sounds like a large objective spanning multiple days, mark it "weekly"
- Return ONLY valid JSON, no markdown fences, no explanation

Output format:
[
  { "title": "string", "type": "daily" | "weekly", "suggestedDate": "YYYY-MM-DD" | null, "description": "" }
]`;

const BREAKDOWN_PROMPT = `You are a planning assistant. Break down the following weekly goal into daily tasks spread across the work week (Monday-Friday).

Rules:
- Create 3-5 concrete daily tasks
- Each task should be a single actionable item
- Assign dates starting from the given Monday
- Return ONLY valid JSON, no markdown fences

Output format:
[
  { "title": "string", "date": "YYYY-MM-DD", "description": "" }
]`;

/** Check if GitHub Copilot API is reachable and configured. */
export async function isAvailable() {
  const token = getCopilotToken();
  if (!token) return { available: false, reason: 'no_token' };

  try {
    const res = await fetch(COPILOT_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (res.ok) return { available: true, reason: null };
    if (res.status === 401) return { available: false, reason: 'auth_failed' };
    return { available: false, reason: `http_${res.status}` };
  } catch (err) {
    return { available: false, reason: 'network_error' };
  }
}

/** Call GitHub Copilot chat completions. */
async function copilotComplete(systemMessage, userMessage) {
  const token = getCopilotToken();
  if (!token) return null;

  try {
    const res = await fetch(`${COPILOT_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: userMessage },
        ],
        model: 'gpt-4o',
        temperature: 0.3,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    // Parse JSON from response (strip markdown fences if present)
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/** Rule-based fallback: split on newlines, commas, "and". */
function ruleBasedParse(input) {
  // Split on newlines first
  let items = input.split(/\n/).map((s) => s.trim()).filter(Boolean);
  // If single line, split on commas and " and "
  if (items.length === 1) {
    items = items[0].split(/,\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  }
  // Clean up common prefixes
  return items.map((item) => {
    const title = item
      .replace(/^[-•*]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .replace(/^\[[ x]?\]\s*/i, '')
      .trim();
    if (!title) return null;
    return { title, type: 'daily', suggestedDate: null, description: '' };
  }).filter(Boolean);
}

/**
 * Parse natural language input into structured tasks.
 * Uses GitHub Copilot API if available, falls back to rule-based parsing.
 */
export async function parseNaturalLanguage(input, context = {}) {
  if (!input || typeof input !== 'string' || !input.trim()) {
    return { tasks: [], source: 'none' };
  }

  // Try Copilot API
  const today = context.today || new Date().toISOString().split('T')[0];
  const enrichedInput = `Today is ${today}.\n\nUser input: "${input}"`;
  const aiResult = await copilotComplete(SYSTEM_PROMPT, enrichedInput);

  if (Array.isArray(aiResult) && aiResult.length > 0) {
    return { tasks: aiResult, source: 'copilot' };
  }

  // Fallback to rule-based
  const tasks = ruleBasedParse(input);
  return { tasks, source: 'rule_based' };
}

/**
 * Generate a daily plan from a prompt. Can incorporate existing context
 * (e.g. "Generate a daily plan from my open ADO items").
 */
export async function generateDailyPlan(input, existingTasks = []) {
  const today = new Date().toISOString().split('T')[0];
  let prompt = `Today is ${today}.\n\nUser request: "${input}"`;
  if (existingTasks.length > 0) {
    prompt += `\n\nExisting tasks for context:\n${existingTasks.map((t) => `- ${t.title} (${t.status})`).join('\n')}`;
  }

  const aiResult = await copilotComplete(SYSTEM_PROMPT, prompt);
  if (Array.isArray(aiResult) && aiResult.length > 0) {
    return { tasks: aiResult, source: 'copilot' };
  }

  return parseNaturalLanguage(input);
}

/**
 * AI-suggested breakdown of a weekly goal into daily tasks.
 */
export async function breakdownGoal(goalTitle, weekStart) {
  const prompt = `Weekly goal: "${goalTitle}"\nWeek starting: ${weekStart} (Monday)`;
  const aiResult = await copilotComplete(BREAKDOWN_PROMPT, prompt);

  if (Array.isArray(aiResult) && aiResult.length > 0) {
    return { tasks: aiResult, source: 'copilot' };
  }

  // Fallback: create generic daily tasks
  const tasks = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    tasks.push({
      title: `Work on: ${goalTitle} (Day ${i + 1})`,
      date: d.toISOString().split('T')[0],
      description: '',
    });
  }
  return { tasks, source: 'rule_based' };
}
