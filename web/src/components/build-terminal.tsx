import React, { useEffect, useRef } from 'react';
import { LogEvent } from '../App.js';

interface BuildTerminalProps {
  logs: LogEvent[];
  logFile?: string;
  activeCommandId: string | null;
  historicalLogBuffer: string | null;
}

export default function BuildTerminal({ logs, logFile, activeCommandId, historicalLogBuffer }: BuildTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <section className="compiler-core">
      <div className="compiler-header">
        <div className="compiler-tab active">
          {historicalLogBuffer ? `[ HISTORICAL ] CMD: #${activeCommandId?.slice(0,6)}` : `[ LIVE ] CMD: #${activeCommandId?.slice(0,6) || 'WAITING'}`}
        </div>
        <div className="compiler-tab inactive">{logFile ? logFile.split('/').pop() : 'NO_FILE_ATTACHED'}</div>
      </div>
      
      <div className="compiler-log" ref={containerRef}>
        <div className="crt-overlay" style={{ position: 'absolute', inset: 0, opacity: 0.1, pointerEvents: 'none' }}></div>
        
        {historicalLogBuffer !== null ? (
          <div style={{ padding: '8px', width: '100%' }}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <button style={{
                  background: 'transparent', border: '1px solid var(--outline_variant)', 
                  color: 'var(--on_surface_variant)', padding: '6px 12px', fontSize: '11px',
                  borderRadius: '4px', cursor: 'pointer', fontFamily: 'var(--font-mono)'
              }}>
                [ Load previous log blocks... ]
              </button>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: 1.5 }}>
              {historicalLogBuffer}
            </pre>
          </div>
        ) : (
          logs.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontStyle: 'italic', opacity: 0.5 }}>
              Awaiting background streaming event...
            </div>
          ) : (
            logs.map((log, index) => {
              const isError = log.logLine?.toLowerCase().includes('error') || log.logLine?.toLowerCase().includes('failed');
              const isSuccess = log.logLine?.toLowerCase().includes('success');
              const lineClass = isError ? 'error' : isSuccess ? 'highlight' : 'info';
              
              return (
                <p key={index} className={lineClass} style={{ marginBottom: '4px' }}>
                  {log.logLine}
                </p>
              );
            })
          )
        )}
      </div>
    </section>
  );
}
