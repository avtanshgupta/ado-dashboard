import { useState } from 'react';
import { api } from '../lib/api.js';
import { Sparkles, Send, Plus, Check } from './icons.jsx';

export function AiPlanningPanel({ date, weekStart, onTasksCreated }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);

  async function handleParse(e) {
    e.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setError(null);
    setSuggestions(null);
    try {
      const result = await api.aiParse(input, { today: date });
      setSuggestions(result.tasks);
      setSource(result.source);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function addTask(task) {
    try {
      if (task.type === 'weekly') {
        await api.createWeeklyGoal({ title: task.title, dueDate: task.suggestedDate, description: task.description || '' });
      } else {
        await api.createDailyTask({ title: task.title, date: task.suggestedDate || date, description: task.description || '' });
      }
      setSuggestions((prev) => prev.filter((t) => t !== task));
      onTasksCreated?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addAll() {
    for (const task of suggestions) {
      await addTask(task);
    }
    setSuggestions([]);
    setInput('');
    onTasksCreated?.();
  }

  return (
    <section className="ai-planning-panel">
      <div className="section-header">
        <h2><Sparkles size={18} /> AI Planning Assistant</h2>
        {source && <span className="muted" style={{ fontSize: 12 }}>Powered by: {source}</span>}
      </div>

      <form className="ai-input-form" onSubmit={handleParse}>
        <textarea
          className="ai-input"
          placeholder={'Describe your tasks in natural language…\n\nExamples:\n• "Tomorrow I need to finish CmdHSTR testing, review Avtansh\'s PR, and prepare slides"\n• "Create a weekly plan for this sprint"\n• "Move unfinished tasks to tomorrow"'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
        />
        <button type="submit" className="btn primary" disabled={!input.trim() || loading}>
          {loading ? '…' : <><Send size={14} /> Parse Tasks</>}
        </button>
      </form>

      {error && <div className="ai-error">{error}</div>}

      {suggestions && suggestions.length > 0 && (
        <div className="ai-suggestions">
          <div className="ai-suggestions-header">
            <span>{suggestions.length} task{suggestions.length > 1 ? 's' : ''} parsed</span>
            <button className="btn small primary" onClick={addAll}>
              <Plus size={14} /> Add All
            </button>
          </div>
          {suggestions.map((task, i) => (
            <div key={i} className="ai-suggestion-item">
              <div className="ai-suggestion-info">
                <span className={`ai-type-badge ${task.type}`}>{task.type}</span>
                <span className="ai-suggestion-title">{task.title}</span>
                {task.suggestedDate && <span className="muted">{task.suggestedDate}</span>}
              </div>
              <button className="btn small" onClick={() => addTask(task)}>
                <Check size={14} /> Add
              </button>
            </div>
          ))}
        </div>
      )}

      {suggestions && suggestions.length === 0 && !loading && (
        <p className="muted" style={{ textAlign: 'center', padding: '1rem' }}>
          All tasks added! ✅
        </p>
      )}
    </section>
  );
}
