/**
 * Build Terminal Component
 * Renders compiler diagnostics and build spool outputs.
 *
 * Provides:
 * - BuildTerminal: React Component
 */
import React, { useEffect, useRef } from 'react';
import { LogEvent } from '../app.js';

interface Props {
  logs: LogEvent[];
  logFile?: string;
}

const BuildTerminal: React.FC<Props> = ({ logs, logFile }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAutoScrollFastened, setIsAutoScrollFastened] = React.useState(true);

  useEffect(() => {
    if (isAutoScrollFastened && bottomRef.current) {
      bottomRef.current.scrollIntoView();
    }
  }, [logs, isAutoScrollFastened]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const atBottom = scrollHeight - scrollTop - clientHeight < 150;
    setIsAutoScrollFastened(atBottom);
  };

  return (
    <div className="panel terminal-panel">
      <div className="panel-header dark">
        <h2>Compiler Terminal</h2>
      </div>
      <div className="panel-content terminal-content scrollable" onScroll={handleScroll}>
        {logs.length === 0 ? (
          <div className="empty-state">No build output yet...</div>
        ) : (
          <div className="terminal-lines">
            {logs.map((log, i) => (
              <div key={i} className="terminal-line">
                <span className="log-prefix">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}]</span>
                <span className="log-text">{log.logLine}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {logFile && (
        <div className="serial-footer">
          <span className="footer-label">Logging to:</span>
          <span className="footer-value" title={logFile}>{logFile}</span>
        </div>
      )}
    </div>
  );
};

export default BuildTerminal;
