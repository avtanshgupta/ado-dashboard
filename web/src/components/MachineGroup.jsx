import { Server, ChevronDown, ChevronRight } from './icons.jsx';
import { AgentSessionCard } from './AgentSessionCard.jsx';
import { useState } from 'react';

export function MachineGroup({ group, onEnd }) {
  const [expanded, setExpanded] = useState(true);
  const { machineId, machineName, sessions } = group;
  const activeCount = sessions.filter((s) => s.status === 'active').length;

  return (
    <div className="machine-group">
      <button className="machine-header" onClick={() => setExpanded((e) => !e)}>
        <span className="chevron">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <Server size={16} />
        <span className="machine-name">{machineName || machineId}</span>
        <span className="machine-meta">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {activeCount > 0 && <span className="active-badge">{activeCount} active</span>}
        </span>
      </button>
      {expanded && (
        <div className="machine-sessions">
          {sessions.map((session) => (
            <AgentSessionCard key={session.id} session={session} onEnd={onEnd} />
          ))}
        </div>
      )}
    </div>
  );
}
