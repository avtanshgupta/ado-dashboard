/**
 * Planning Service — Microsoft To Do integration.
 * Tasks are stored in dedicated To Do lists ("🎯 Daily Plan", "📅 Weekly Goals").
 * Local user config stores only planning preferences (mode, settings).
 */
import { graphGet, graphPost, graphPatch, graphDelete, GraphError } from '../lib/graphClient.js';
import { currentUser } from '../lib/context.js';
import { loadUserConfig, saveUserConfig } from '../lib/userConfig.js';

const DAILY_LIST_NAME = '🎯 Daily Plan';
const WEEKLY_LIST_NAME = '📅 Weekly Goals';

// --- Planning Settings (stored in user config JSON) ---

const PLANNING_CONFIG_KEY = 'planning';

const DEFAULT_SETTINGS = {
  planningMode: 'daily_weekly', // daily_only | weekly_only | daily_weekly
  defaultDailyDueTime: '17:00',
  defaultWeeklyDueDay: 'friday',
  aiAssistantEnabled: true,
};

export function getSettings(userId) {
  const cfg = loadUserConfig(userId);
  return { ...DEFAULT_SETTINGS, ...(cfg[PLANNING_CONFIG_KEY] || {}) };
}

export function updateSettings(userId, settings) {
  const valid = {};
  if (settings.planningMode !== undefined) {
    const allowed = ['daily_only', 'weekly_only', 'daily_weekly'];
    if (!allowed.includes(settings.planningMode)) {
      throw Object.assign(new Error(`planningMode must be one of: ${allowed.join(', ')}`), { status: 400 });
    }
    valid.planningMode = settings.planningMode;
  }
  if (settings.defaultDailyDueTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(settings.defaultDailyDueTime)) {
      throw Object.assign(new Error('defaultDailyDueTime must be HH:MM format'), { status: 400 });
    }
    valid.defaultDailyDueTime = settings.defaultDailyDueTime;
  }
  if (settings.defaultWeeklyDueDay !== undefined) {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    if (!days.includes(settings.defaultWeeklyDueDay)) {
      throw Object.assign(new Error(`defaultWeeklyDueDay must be a day of the week`), { status: 400 });
    }
    valid.defaultWeeklyDueDay = settings.defaultWeeklyDueDay;
  }
  if (settings.aiAssistantEnabled !== undefined) {
    valid.aiAssistantEnabled = Boolean(settings.aiAssistantEnabled);
  }

  const cfg = loadUserConfig(userId);
  const merged = { ...DEFAULT_SETTINGS, ...(cfg[PLANNING_CONFIG_KEY] || {}), ...valid };
  saveUserConfig(userId, { [PLANNING_CONFIG_KEY]: merged });
  return merged;
}

// --- To Do List Management ---

async function findOrCreateList(displayName) {
  const res = await graphGet('/me/todo/lists', { useCache: false });
  const lists = res?.value || [];
  let list = lists.find((l) => l.displayName === displayName);
  if (!list) {
    list = await graphPost('/me/todo/lists', { displayName });
  }
  return list;
}

async function getDailyListId() {
  const list = await findOrCreateList(DAILY_LIST_NAME);
  return list.id;
}

async function getWeeklyListId() {
  const list = await findOrCreateList(WEEKLY_LIST_NAME);
  return list.id;
}

/** Ensure both planning lists exist. Called on first connect. */
export async function ensureLists() {
  const daily = await findOrCreateList(DAILY_LIST_NAME);
  const weekly = await findOrCreateList(WEEKLY_LIST_NAME);
  return { dailyListId: daily.id, weeklyListId: weekly.id };
}

// --- Status Mapping ---
// To Do has: notStarted, inProgress, completed, waitingOnOthers, deferred
// We map: planned=notStarted, in_progress=inProgress, blocked=waitingOnOthers, done=completed

function toTodoStatus(dashboardStatus) {
  switch (dashboardStatus) {
    case 'in_progress': return 'inProgress';
    case 'blocked': return 'waitingOnOthers';
    case 'done': return 'completed';
    default: return 'notStarted';
  }
}

function fromTodoStatus(todoStatus) {
  switch (todoStatus) {
    case 'inProgress': return 'in_progress';
    case 'waitingOnOthers': return 'blocked';
    case 'completed': return 'done';
    default: return 'planned';
  }
}

function mapTaskFromTodo(task) {
  return {
    id: task.id,
    title: task.title,
    status: fromTodoStatus(task.status),
    description: task.body?.content || '',
    dueDate: task.dueDateTime?.dateTime?.split('T')[0] || null,
    completedDate: task.completedDateTime?.dateTime?.split('T')[0] || null,
    createdAt: task.createdDateTime,
    updatedAt: task.lastModifiedDateTime,
    categories: task.categories || [],
    linkedResources: task.linkedResources || [],
    importance: task.importance,
  };
}

// --- Weekly Goals ---

export async function getWeeklyGoals({ weekStart } = {}) {
  const listId = await getWeeklyListId();
  let filter = '';
  if (weekStart) {
    const weekEnd = getWeekEnd(weekStart);
    filter = `dueDateTime/dateTime ge '${weekStart}T00:00:00Z' and dueDateTime/dateTime le '${weekEnd}T23:59:59Z'`;
  }
  const query = filter ? { $filter: filter, $top: 100 } : { $top: 100 };
  const res = await graphGet(`/me/todo/lists/${listId}/tasks`, { query, useCache: false });
  return (res?.value || []).map(mapTaskFromTodo);
}

export async function createWeeklyGoal({ title, dueDate, description }) {
  const listId = await getWeeklyListId();
  const body = {
    title,
    ...(dueDate ? { dueDateTime: { dateTime: `${dueDate}T17:00:00`, timeZone: 'UTC' } } : {}),
    ...(description ? { body: { content: description, contentType: 'text' } } : {}),
  };
  const task = await graphPost(`/me/todo/lists/${listId}/tasks`, body);
  return mapTaskFromTodo(task);
}

export async function updateWeeklyGoal(taskId, updates) {
  const listId = await getWeeklyListId();
  const body = {};
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.status !== undefined) body.status = toTodoStatus(updates.status);
  if (updates.dueDate !== undefined) {
    body.dueDateTime = updates.dueDate
      ? { dateTime: `${updates.dueDate}T17:00:00`, timeZone: 'UTC' }
      : null;
  }
  if (updates.description !== undefined) {
    body.body = { content: updates.description, contentType: 'text' };
  }
  const task = await graphPatch(`/me/todo/lists/${listId}/tasks/${taskId}`, body);
  return mapTaskFromTodo(task);
}

export async function deleteWeeklyGoal(taskId) {
  const listId = await getWeeklyListId();
  await graphDelete(`/me/todo/lists/${listId}/tasks/${taskId}`);
}

// --- Daily Tasks ---

export async function getDailyTasks({ date } = {}) {
  const listId = await getDailyListId();
  let filter = '';
  if (date) {
    filter = `dueDateTime/dateTime ge '${date}T00:00:00Z' and dueDateTime/dateTime le '${date}T23:59:59Z'`;
  }
  const query = filter ? { $filter: filter, $top: 200 } : { $top: 200 };
  const res = await graphGet(`/me/todo/lists/${listId}/tasks`, { query, useCache: false });
  return (res?.value || []).map(mapTaskFromTodo);
}

export async function createDailyTask({ title, date, description, weeklyGoalId }) {
  const listId = await getDailyListId();
  const body = {
    title,
    ...(date ? { dueDateTime: { dateTime: `${date}T17:00:00`, timeZone: 'UTC' } } : {}),
    ...(description ? { body: { content: description, contentType: 'text' } } : {}),
    ...(weeklyGoalId ? {
      linkedResources: [{
        webUrl: `ado-dashboard://weekly-goal/${weeklyGoalId}`,
        applicationName: 'ADO Dashboard',
        displayName: 'Linked Weekly Goal',
      }],
    } : {}),
  };
  const task = await graphPost(`/me/todo/lists/${listId}/tasks`, body);
  return mapTaskFromTodo(task);
}

export async function updateDailyTask(taskId, updates) {
  const listId = await getDailyListId();
  const body = {};
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.status !== undefined) body.status = toTodoStatus(updates.status);
  if (updates.date !== undefined) {
    body.dueDateTime = updates.date
      ? { dateTime: `${updates.date}T17:00:00`, timeZone: 'UTC' }
      : null;
  }
  if (updates.description !== undefined) {
    body.body = { content: updates.description, contentType: 'text' };
  }
  const task = await graphPatch(`/me/todo/lists/${listId}/tasks/${taskId}`, body);
  return mapTaskFromTodo(task);
}

export async function deleteDailyTask(taskId) {
  const listId = await getDailyListId();
  await graphDelete(`/me/todo/lists/${listId}/tasks/${taskId}`);
}

/** Carry forward incomplete tasks from one day to another. */
export async function carryForwardTasks(fromDate, toDate) {
  const tasks = await getDailyTasks({ date: fromDate });
  const incomplete = tasks.filter((t) => t.status !== 'done');
  const carried = [];
  for (const task of incomplete) {
    const updated = await updateDailyTask(task.id, {
      date: toDate,
    });
    // Add "Carried" category
    const listId = await getDailyListId();
    const categories = [...new Set([...(task.categories || []), 'Carried'])];
    await graphPatch(`/me/todo/lists/${listId}/tasks/${task.id}`, { categories });
    carried.push({ ...updated, categories });
  }
  return carried;
}

/** Break a weekly goal into daily tasks. */
export async function breakdownWeeklyGoal(goalId, dailyTasks) {
  const created = [];
  for (const dt of dailyTasks) {
    const task = await createDailyTask({
      title: dt.title,
      date: dt.date,
      description: dt.description || '',
      weeklyGoalId: goalId,
    });
    created.push(task);
  }
  return created;
}

// --- Summary ---

export async function getSummary(date) {
  const today = date || new Date().toISOString().split('T')[0];
  const dailyTasks = await getDailyTasks({ date: today });
  const weekStart = getWeekStart(today);
  const weeklyGoals = await getWeeklyGoals({ weekStart });

  return {
    date: today,
    daily: {
      total: dailyTasks.length,
      planned: dailyTasks.filter((t) => t.status === 'planned').length,
      inProgress: dailyTasks.filter((t) => t.status === 'in_progress').length,
      blocked: dailyTasks.filter((t) => t.status === 'blocked').length,
      done: dailyTasks.filter((t) => t.status === 'done').length,
    },
    weekly: {
      total: weeklyGoals.length,
      planned: weeklyGoals.filter((t) => t.status === 'planned').length,
      inProgress: weeklyGoals.filter((t) => t.status === 'in_progress').length,
      blocked: weeklyGoals.filter((t) => t.status === 'blocked').length,
      done: weeklyGoals.filter((t) => t.status === 'done').length,
    },
  };
}

// --- Helpers ---

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6); // Sunday
  return d.toISOString().split('T')[0];
}
