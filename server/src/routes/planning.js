/**
 * Planning API routes.
 * Exposes endpoints for the personal planning system backed by Microsoft To Do.
 */
import { Router } from 'express';
import * as planning from '../services/planningService.js';
import * as ai from '../services/aiPlanningService.js';
import { currentUser } from '../lib/context.js';

const router = Router();

// --- Settings ---

router.get('/settings', (req, res) => {
  try {
    const settings = planning.getSettings(currentUser().id);
    res.json(settings);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const settings = planning.updateSettings(currentUser().id, req.body);
    res.json(settings);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Connect (initialize To Do lists) ---

router.post('/connect', async (req, res) => {
  try {
    const result = await planning.ensureLists();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Weekly Goals ---

router.get('/weekly', async (req, res) => {
  try {
    const { weekStart } = req.query;
    const goals = await planning.getWeeklyGoals({ weekStart });
    res.json({ value: goals });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/weekly', async (req, res) => {
  try {
    const { title, dueDate, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const goal = await planning.createWeeklyGoal({ title: title.trim(), dueDate, description });
    res.status(201).json(goal);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/weekly/:id', async (req, res) => {
  try {
    const goal = await planning.updateWeeklyGoal(req.params.id, req.body);
    res.json(goal);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/weekly/:id', async (req, res) => {
  try {
    await planning.deleteWeeklyGoal(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/weekly/:id/breakdown', async (req, res) => {
  try {
    const { dailyTasks } = req.body;
    if (!Array.isArray(dailyTasks) || dailyTasks.length === 0) {
      return res.status(400).json({ error: 'dailyTasks array is required' });
    }
    const created = await planning.breakdownWeeklyGoal(req.params.id, dailyTasks);
    res.status(201).json({ value: created });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Daily Tasks ---

router.get('/daily', async (req, res) => {
  try {
    const { date } = req.query;
    const tasks = await planning.getDailyTasks({ date });
    res.json({ value: tasks });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/daily', async (req, res) => {
  try {
    const { title, date, description, weeklyGoalId } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const task = await planning.createDailyTask({ title: title.trim(), date, description, weeklyGoalId });
    res.status(201).json(task);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/daily/:id', async (req, res) => {
  try {
    const task = await planning.updateDailyTask(req.params.id, req.body);
    res.json(task);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/daily/:id', async (req, res) => {
  try {
    await planning.deleteDailyTask(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/daily/carry-forward', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required' });
    const carried = await planning.carryForwardTasks(fromDate, toDate);
    res.json({ value: carried, count: carried.length });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Summary ---

router.get('/summary', async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await planning.getSummary(date);
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- AI Planning ---

router.get('/ai/status', async (req, res) => {
  try {
    const status = await ai.isAvailable();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/ai/parse', async (req, res) => {
  try {
    const { input, context } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: 'input is required' });
    const result = await ai.parseNaturalLanguage(input, context);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/ai/generate-plan', async (req, res) => {
  try {
    const { input, existingTasks } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: 'input is required' });
    const result = await ai.generateDailyPlan(input, existingTasks || []);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/ai/breakdown', async (req, res) => {
  try {
    const { goalTitle, weekStart } = req.body;
    if (!goalTitle?.trim()) return res.status(400).json({ error: 'goalTitle is required' });
    if (!weekStart) return res.status(400).json({ error: 'weekStart is required' });
    const result = await ai.breakdownGoal(goalTitle, weekStart);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
