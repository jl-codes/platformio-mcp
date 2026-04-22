import React, { useState, useEffect } from 'react';
import type { LockState } from '../App.js';

interface DependenciesViewerProps {
  apiBase: string;
  token: string;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function DependenciesViewer({ 
  apiBase, 
  token, 
  activeWorkspace,
  lockState
}: DependenciesViewerProps) {
  const [installedLibs, setInstalledLibs] = useState<any[]>([]);
  const [isFetchingInstalled, setIsFetchingInstalled] = useState(false);
  const [loadingPioHome, setLoadingPioHome] = useState(false);

  const fetchInstalledInfo = async () => {
    if (!activeWorkspace) return;
    setIsFetchingInstalled(true);
    try {
      const res = await fetch(`${apiBase}/api/libraries/installed?projectDir=${encodeURIComponent(activeWorkspace)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const libs = await res.json();
        setInstalledLibs(libs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsFetchingInstalled(false);
    }
  };

  useEffect(() => {
    fetchInstalledInfo();
  }, [activeWorkspace]);

  const handleLaunchPioHome = async () => {
    if (!activeWorkspace) return;
    setLoadingPioHome(true);
    try {
      // Assuming /api/spooler/start can wrap generic pio commands or we can use it to launch home
      // Will send a generic task just in case it triggers the existing routing 
      await fetch(`${apiBase}/api/spooler/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ command: 'pio home', projectDir: activeWorkspace })
      });
    } catch(e) {
      console.error("Failed to launch PIO Home", e);
    } finally {
      setTimeout(() => setLoadingPioHome(false), 1500); // UI breathing room
    }
  };

  return (
    <div className="library-explorer">
      <div className="lib-search" style={{ borderBottom: 'none', paddingBottom: '0' }}>
        <h3 className="section-title" style={{ fontSize: '13px', marginBottom: '12px' }}>DEPENDENCIES VIEWER</h3>
        <p className="mono-label" style={{ fontSize: '10px', opacity: 0.7, lineHeight: 1.4, marginBottom: '16px' }}>
          Library mutations are disabled in this read-only view. Please manage your workspace dependencies using the Native PlatformIO dashboard.
        </p>
        
        {activeWorkspace && (
           <button 
             className="lib-btn" 
             style={{ width: '100%', borderColor: 'var(--secondary)', color: 'var(--secondary)', padding: '8px' }}
             onClick={handleLaunchPioHome}
             disabled={loadingPioHome || lockState.isLocked}
           >
             <span className="material-symbols-outlined" style={{ fontSize: '14px', marginRight: '6px', verticalAlign: 'middle' }}>open_in_new</span>
             {loadingPioHome ? 'LAUNCHING...' : 'MANAGE IN PIO HOME'}
           </button>
        )}
      </div>
      
      <div className="lib-list" style={{ borderTop: '1px solid rgba(70, 69, 84, 0.4)', marginTop: '16px', paddingTop: '8px' }}>
        {!activeWorkspace && (
           <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             AWAITING WORKSPACE CONTEXT
           </div>
        )}
        
        {activeWorkspace && installedLibs.length === 0 && !isFetchingInstalled && (
          <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             NO INSTALLED LIBRARIES
          </div>
        )}

        {isFetchingInstalled && (
          <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             SYNCING TELEMETRY...
          </div>
        )}

        {activeWorkspace && installedLibs.map(lib => (
          <div key={lib.id || lib.name} className="lib-item readonly" style={{ opacity: 0.85, border: '1px solid transparent' }}>
            <div className="lib-header">
              <span className="lib-name" title={lib.name} style={{ color: 'var(--on-surface)' }}>{lib.name}</span>
              {lib.version && <span className="lib-version">v{lib.version}</span>}
            </div>
            <div className="lib-desc" title={lib.description}>{lib.description || 'No description available'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
