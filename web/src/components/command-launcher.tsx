import React, { useState, useEffect } from 'react';

interface CommandLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspace: string | null;
  hardware: any[];
  apiBase: string;
  token: string;
}

export default function CommandLauncher({ isOpen, onClose, activeWorkspace, hardware, apiBase, token }: CommandLauncherProps) {
  const [action, setAction] = useState('build');
  const [env, setEnv] = useState('');
  const [port, setPort] = useState('');
  const [loading, setLoading] = useState(false);
  const [environments, setEnvironments] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen && activeWorkspace) {
      const fetchConfig = async () => {
        try {
          const res = await fetch(`${apiBase}/api/projects/config?projectDir=${encodeURIComponent(activeWorkspace)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const payload = await res.json();
            if (payload && payload.rawConfig) {
              const matches = Array.from(payload.rawConfig.matchAll(/\[env:([^\]]+)\]/g));
              const envs = matches.map((m: any) => m[1]);
              setEnvironments(envs);
              if (envs.length > 0 && !env) setEnv(envs[0]);
            }
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchConfig();
    }
  }, [isOpen, activeWorkspace, apiBase, token, env]);

  useEffect(() => {
    if (isOpen && hardware.length > 0 && !port) {
      setPort(hardware[0].port);
    }
  }, [isOpen, hardware, port]);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    try {
      let endpoint = '';
      let payload: any = { projectDir: activeWorkspace };

      if (action === 'build') {
         endpoint = '/api/commands/build';
         if (env) payload.environment = env;
      } else if (action === 'clean') {
         endpoint = '/api/commands/clean';
      } else if (action === 'upload' || action === 'uploadfs') {
         endpoint = `/api/commands/${action}`;
         if (env) payload.environment = env;
         if (port) payload.port = port;
      } else if (action === 'monitor') {
         endpoint = '/api/spooler/start';
         if (port) payload.port = port;
      }

      await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      onClose();
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getBorderColor = () => {
    if (action === 'build') return 'var(--secondary)'; // cyan/neon green
    if (action === 'upload' || action === 'uploadfs') return '#ff0055'; // magenta/red
    if (action === 'monitor') return '#00e5ff'; // bright cyan
    if (action === 'clean') return 'var(--outline)';
    return 'var(--primary)';
  }

  return (
    <div className="modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(10, 14, 24, 0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
    }}>
      <div className="modal-content" style={{
        backgroundColor: 'var(--surface-container)',
        border: `1px solid ${getBorderColor()}`,
        borderRadius: '8px',
        width: '450px',
        maxWidth: '90vw',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 0 40px ${getBorderColor()}33`
      }}>
        
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(70, 69, 84, 0.4)' }}>
          <h2 className="section-title" style={{ margin: 0, color: getBorderColor(), display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="material-symbols-outlined">terminal</span>
            LAUNCH_COMMAND
          </h2>
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label className="mono-label">ACTION VERB</label>
            <select 
              className="lib-search-input" 
              value={action} 
              onChange={e => setAction(e.target.value)}
            >
              <option value="build">BUILD PROJECT</option>
              <option value="upload">UPLOAD FIRMWARE</option>
              <option value="uploadfs">UPLOAD FILESYSTEM</option>
              <option value="monitor">START SERIAL MONITOR</option>
              <option value="clean">CLEAN ARTIFACTS</option>
            </select>
          </div>

          {action !== 'clean' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className="mono-label">TARGET ENVIRONMENT</label>
              <select 
                className="lib-search-input" 
                value={env} 
                onChange={e => setEnv(e.target.value)}
              >
                {environments.length === 0 && <option value="">Auto-Detect / Default</option>}
                {environments.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          )}

          {(action === 'upload' || action === 'uploadfs' || action === 'monitor') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label className="mono-label">HARDWARE PORT</label>
              <select 
                className="lib-search-input" 
                value={port} 
                onChange={e => setPort(e.target.value)}
              >
                {hardware.length === 0 && <option value="">Auto-Detect Port</option>}
                <option value="">Auto-Detect Port</option>
                {hardware.map(h => <option key={h.port} value={h.port}>{h.port} - {h.hwid}</option>)}
              </select>
            </div>
          )}

        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(70, 69, 84, 0.4)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button 
            className="lib-btn" 
            onClick={onClose}
          >
            CANCEL
          </button>
          <button 
            className="lib-btn" 
            style={{ borderColor: getBorderColor(), color: getBorderColor() }}
            onClick={handleExecute}
            disabled={loading || !activeWorkspace}
          >
            {loading ? 'ENQUEUING...' : 'EXECUTE'}
          </button>
        </div>

      </div>
    </div>
  );
}
