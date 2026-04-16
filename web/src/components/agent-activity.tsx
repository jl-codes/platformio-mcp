/**
 * Agent Activity Component
 * Displays real-time MCP tooling operations.
 *
 * Provides:
 * - AgentActivity: React Component
 */
import React from 'react';
import { AgentEvent } from '../app.js';

interface Props {
  activities: AgentEvent[];
}

const AgentActivity: React.FC<Props> = ({ activities }) => {
  return (
    <div className="panel agent-activity-panel">
      <div className="panel-header">
        <h2>Agent Activity</h2>
        <div className="pulse-indicator"></div>
      </div>
      <div className="panel-content scrollable">
        {activities.length === 0 ? (
          <div className="empty-state">Waiting for agent instructions...</div>
        ) : (
          <ul className="activity-list">
            {activities.map((ev, i) => (
              <li key={i} className={`activity-item ${ev.status || (ev.success ? 'success' : 'error')}`}>
                <div className="activity-time">
                  {new Date(ev.timestamp).toLocaleTimeString([], { hour12: false })}
                </div>
                <div className="activity-details">
                  <span className="tool-name">{ev.toolName}</span>
                  <pre className="tool-args">{JSON.stringify(ev.args, null, 2)}</pre>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AgentActivity;
