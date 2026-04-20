import React, { useState, useEffect } from 'react';
import LibraryExplorer from './library-explorer.js';
import type { LockState } from '../App.js';

interface WorkspaceConfigProps {
  apiBase: string;
  token: string;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function WorkspaceConfig({ 
  apiBase, 
  token, 
  activeWorkspace,
  lockState
}: WorkspaceConfigProps) {
  const [environments, setEnvironments] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      if (!activeWorkspace) {
        setEnvironments([]);
        return;
      }
      setIsFetching(true);
      try {
        const res = await fetch(`${apiBase}/api/projects/config?projectDir=${encodeURIComponent(activeWorkspace)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const payload = await res.json();
          // Extract environments from rawConfig string matching [env:something]
          if (payload && payload.rawConfig) {
            const matches = Array.from(payload.rawConfig.matchAll(/\[env:([^\]]+)\]/g));
            const envs = matches.map((m: any) => m[1]);
            setEnvironments(envs);
          }
        }
      } catch (e) {
        console.error("Failed to fetch project config", e);
      } finally {
        setIsFetching(false);
      }
    };
    fetchConfig();
  }, [activeWorkspace, apiBase, token]);

  return (
    <div className="sidebar-right">
      <div className="workspace-config">
        <h3 className="section-title" style={{ fontSize: '13px', marginBottom: '8px' }}>WORKSPACE ENVIRONMENTS</h3>
        {isFetching && <div className="mono-label">LOADING...</div>}
        {!isFetching && !activeWorkspace && (
           <div className="mono-label" style={{ opacity: 0.5 }}>NO WORKSPACE ROOT DETECTED</div>
        )}
        {!isFetching && activeWorkspace && environments.length === 0 && (
           <div className="mono-label" style={{ opacity: 0.5 }}>NO ENVIRONMENTS DETECTED</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {environments.map(env => (
            <div key={env} className="env-chip readonly" title="platformio.ini environments are read-only in this UI">
              <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>memory</span>
              {env}
            </div>
          ))}
        </div>
      </div>
      
      <LibraryExplorer 
        apiBase={apiBase}
        token={token}
        activeWorkspace={activeWorkspace}
        lockState={lockState}
      />
    </div>
  );
}
