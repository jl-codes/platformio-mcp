import React, { useState, useEffect } from 'react';
import type { LockState } from '../App.js';

interface LibraryExplorerProps {
  apiBase: string;
  token: string;
  activeWorkspace: string | null;
  lockState: LockState;
}

export default function LibraryExplorer({ 
  apiBase, 
  token, 
  activeWorkspace,
  lockState
}: LibraryExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [installedLibs, setInstalledLibs] = useState<any[]>([]);
  const [isFetchingInstalled, setIsFetchingInstalled] = useState(false);
  const [activeActions, setActiveActions] = useState<Record<string, 'installing' | 'uninstalling'>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    
    // Debounce search
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`${apiBase}/api/libraries/search?query=${encodeURIComponent(searchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
           const libs = await res.json();
           setSearchResults(libs || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [searchQuery, token, apiBase]);

  const handleLibraryAction = async (action: 'install' | 'uninstall', libraryName: string) => {
    if (!activeWorkspace) return;
    
    if (lockState.isLocked) {
      setErrorMsg(`Hardware queue is currently locked. Please wait.`);
      return;
    }
    
    setErrorMsg(null);
    setActiveActions(prev => ({ ...prev, [libraryName]: action === 'install' ? 'installing' : 'uninstalling' }));
    
    try {
      const res = await fetch(`${apiBase}/api/libraries/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ library: libraryName, projectDir: activeWorkspace })
      });
      
      const payload = await res.json();
      if (!res.ok) {
         setErrorMsg(payload.error || `Failed to ${action} ${libraryName}`);
      } else {
         // Refresh installed lists
         fetchInstalledInfo();
         if (action === 'install') setSearchQuery('');
      }
    } catch (e: any) {
       setErrorMsg(e.message || `Failed to ${action}`);
    } finally {
       setActiveActions(prev => {
         const next = { ...prev };
         delete next[libraryName];
         return next;
       });
    }
  };

  const isInstalled = (libName: string) => {
    return installedLibs.some(lib => lib.name.toLowerCase() === libName.toLowerCase());
  };

  const renderList = searchQuery.trim() ? searchResults : installedLibs;

  return (
    <div className="library-explorer">
      <div className="lib-search">
        <h3 className="section-title" style={{ fontSize: '13px', marginBottom: '12px' }}>LIBRARY EXPLORER</h3>
        <input 
          type="text" 
          disabled={!activeWorkspace}
          className="lib-search-input" 
          placeholder={activeWorkspace ? "Search PlatformIO registry..." : "No active workspace"} 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {errorMsg && (
          <div style={{ color: 'var(--error)', fontSize: '10px', marginTop: '8px', fontFamily: '"Fira Code", monospace' }}>
            {errorMsg}
          </div>
        )}
      </div>
      
      <div className="lib-list">
        {!activeWorkspace && (
           <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             AWAITING WORKSPACE CONTEXT
           </div>
        )}
        
        {activeWorkspace && isSearching && (
          <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             SEARCHING REGISTRY...
          </div>
        )}
        
        {activeWorkspace && !isSearching && searchQuery && searchResults.length === 0 && (
          <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             NO RESULTS FOUND
          </div>
        )}
        
        {activeWorkspace && !isSearching && !searchQuery && installedLibs.length === 0 && !isFetchingInstalled && (
          <div className="mono-label" style={{ textAlign: 'center', opacity: 0.5, marginTop: '20px' }}>
             NO INSTALLED LIBRARIES
          </div>
        )}

        {activeWorkspace && !isSearching && renderList.map(lib => {
          const actionState = activeActions[lib.name];
          const libIsInstalled = isInstalled(lib.name);
          const disableActions = lockState.isLocked || !!actionState;
          
          return (
            <div key={lib.id || lib.name} className="lib-item">
              <div className="lib-header">
                <span className="lib-name" title={lib.name}>{lib.name}</span>
                {lib.version && <span className="lib-version">v{lib.version}</span>}
              </div>
              <div className="lib-desc" title={lib.description}>{lib.description || 'No description available'}</div>
              <div className="lib-actions">
                {libIsInstalled && !searchQuery ? (
                  <button 
                    disabled={disableActions}
                    onClick={() => handleLibraryAction('uninstall', lib.name)}
                    className="lib-btn destructive"
                  >
                    {actionState === 'uninstalling' ? 'UNINSTALLING...' : 'UNINSTALL'}
                  </button>
                ) : (
                  <button 
                    disabled={disableActions || (libIsInstalled && !actionState)}
                    onClick={() => handleLibraryAction('install', lib.name)}
                    className="lib-btn"
                  >
                    {actionState === 'installing' ? 'INSTALLING...' : (libIsInstalled ? 'INSTALLED' : 'INSTALL')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
