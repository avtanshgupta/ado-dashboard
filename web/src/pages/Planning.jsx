import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { TaskCard } from '../components/TaskCard.jsx';
import { WeeklyGoalCard } from '../components/WeeklyGoalCard.jsx';
import { AiPlanningPanel } from '../components/AiPlanningPanel.jsx';
import { PlanSummaryCards } from '../components/PlanSummaryCards.jsx';
import { Target, Calendar, AlertCircle, CheckCircle2, Plus, ArrowRight } from '../components/icons.jsx';

function today() {
  return new Date().toISOString().split('T')[0];
}

function getWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

export function Planning() {
  const [summary, setSummary] = useState(null);
  const [dailyTasks, setDailyTasks] = useState([]);
  const [weeklyGoals, setWeeklyGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [graphConnected, setGraphConnected] = useState(true);
  const [newDailyTitle, setNewDailyTitle] = useState('');
  const [newWeeklyTitle, setNewWeeklyTitle] = useState('');

  const date = today();
  const weekStart = getWeekStart(date);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d, w] = await Promise.all([
        api.planningSummary(date),
        api.dailyTasks(date),
        api.weeklyGoals(weekStart),
      ]);
      setSummary(s);
      setDailyTasks(d.value || []);
      setWeeklyGoals(w.value || []);
      setGraphConnected(true);
    } catch (e) {
      if (e.status === 401 && e.message?.includes('Graph')) {
        setGraphConnected(false);
      } else {
        setError(e);
      }
    } finally {
      setLoading(false);
    }
  }, [date, weekStart]);

  useEffect(() => { load(); }, [load]);

  async function handleConnect() {
    try {
      await api.planningConnect();
      setGraphConnected(true);
      load();
    } catch (e) {
      setError(e);
    }
  }

  async function handleCreateDaily(e) {
    e.preventDefault();
    if (!newDailyTitle.trim()) return;
    await api.createDailyTask({ title: newDailyTitle.trim(), date });
    setNewDailyTitle('');
    load();
  }

  async function handleCreateWeekly(e) {
    e.preventDefault();
    if (!newWeeklyTitle.trim()) return;
    const friday = new Date(weekStart);
    friday.setDate(friday.getDate() + 4);
    await api.createWeeklyGoal({ title: newWeeklyTitle.trim(), dueDate: friday.toISOString().split('T')[0] });
    setNewWeeklyTitle('');
    load();
  }

  async function handleUpdateTask(taskId, updates) {
    await api.updateDailyTask(taskId, updates);
    load();
  }

  async function handleUpdateGoal(goalId, updates) {
    await api.updateWeeklyGoal(goalId, updates);
    load();
  }

  async function handleDeleteTask(taskId) {
    await api.deleteDailyTask(taskId);
    load();
  }

  async function handleDeleteGoal(goalId) {
    await api.deleteWeeklyGoal(goalId);
    load();
  }

  async function handleCarryForward() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await api.carryForwardTasks(date, tomorrow.toISOString().split('T')[0]);
    load();
  }

  async function handleAiTasksCreated() {
    load();
  }

  if (!graphConnected) {
    return (
      <div className="page planning-page">
        <h1>📋 Planning</h1>
        <div className="card" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
          <h2>Connect Microsoft To Do</h2>
          <p className="muted" style={{ margin: '1rem 0' }}>
            The planning system uses Microsoft To Do to store your tasks.
            Connect your account to get started.
          </p>
          <p className="muted" style={{ fontSize: 13, margin: '0.5rem 0 1.5rem' }}>
            Requires: <code>az account get-access-token --resource https://graph.microsoft.com</code>
          </p>
          <button className="btn primary" onClick={handleConnect}>Connect To Do</button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="page"><Loading label="Loading planning data…" /></div>;
  if (error) return <div className="page"><ErrorBox error={error} onRetry={load} /></div>;

  const blocked = dailyTasks.filter((t) => t.status === 'blocked');
  const active = dailyTasks.filter((t) => t.status !== 'done' && t.status !== 'blocked');
  const completed = dailyTasks.filter((t) => t.status === 'done');

  return (
    <div className="page planning-page">
      <div className="page-header">
        <h1>📋 Planning</h1>
        <button className="btn small" onClick={handleCarryForward} title="Move incomplete tasks to tomorrow">
          <ArrowRight size={14} /> Carry Forward
        </button>
      </div>

      {summary && <PlanSummaryCards summary={summary} />}

      <div className="planning-grid">
        {/* Daily Tasks */}
        <section className="planning-section">
          <div className="section-header">
            <h2><Target size={18} /> Daily Plan — {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
          </div>

          <form className="quick-add" onSubmit={handleCreateDaily}>
            <input
              placeholder="Add a task for today…"
              value={newDailyTitle}
              onChange={(e) => setNewDailyTitle(e.target.value)}
            />
            <button type="submit" className="btn small primary" disabled={!newDailyTitle.trim()}>
              <Plus size={14} /> Add
            </button>
          </form>

          {active.length === 0 && blocked.length === 0 && completed.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
              No tasks for today. Add one above or use the AI assistant below.
            </p>
          )}

          {active.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onUpdate={(updates) => handleUpdateTask(task.id, updates)}
              onDelete={() => handleDeleteTask(task.id)}
            />
          ))}

          {blocked.length > 0 && (
            <>
              <h3 className="subsection-title"><AlertCircle size={15} /> Blocked ({blocked.length})</h3>
              {blocked.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onUpdate={(updates) => handleUpdateTask(task.id, updates)}
                  onDelete={() => handleDeleteTask(task.id)}
                />
              ))}
            </>
          )}

          {completed.length > 0 && (
            <>
              <h3 className="subsection-title"><CheckCircle2 size={15} /> Completed ({completed.length})</h3>
              {completed.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onUpdate={(updates) => handleUpdateTask(task.id, updates)}
                  onDelete={() => handleDeleteTask(task.id)}
                />
              ))}
            </>
          )}
        </section>

        {/* Weekly Goals */}
        <section className="planning-section">
          <div className="section-header">
            <h2><Calendar size={18} /> Weekly Goals</h2>
          </div>

          <form className="quick-add" onSubmit={handleCreateWeekly}>
            <input
              placeholder="Add a weekly goal…"
              value={newWeeklyTitle}
              onChange={(e) => setNewWeeklyTitle(e.target.value)}
            />
            <button type="submit" className="btn small primary" disabled={!newWeeklyTitle.trim()}>
              <Plus size={14} /> Add
            </button>
          </form>

          {weeklyGoals.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
              No weekly goals set. Add one to guide your daily planning.
            </p>
          )}

          {weeklyGoals.map((goal) => (
            <WeeklyGoalCard
              key={goal.id}
              goal={goal}
              onUpdate={(updates) => handleUpdateGoal(goal.id, updates)}
              onDelete={() => handleDeleteGoal(goal.id)}
            />
          ))}
        </section>
      </div>

      {/* AI Planning Assistant */}
      <AiPlanningPanel date={date} weekStart={weekStart} onTasksCreated={handleAiTasksCreated} />
    </div>
  );
}
