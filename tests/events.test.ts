import { describe, it, expect, beforeEach } from 'vitest';
import { portalEvents } from '../src/api/events.js';

describe('Portal Events', () => {
  beforeEach(() => {
    portalEvents.removeAllListeners('build_log');
    portalEvents.clearArtifactLog('test-project', 'art-1');
    portalEvents.clearArtifactLog('test-project', 'art-2');
  });

  it('should cleanly split stream chunks based on \\n characters', () => {
    const emitted: any[] = [];
    portalEvents.on('build_log', (data) => emitted.push(data));

    // Emit partial chunk
    portalEvents.emitArtifactLog('test-project', 'art-1', 'Hello');
    expect(emitted.length).toBe(0);

    // Complete chunk
    portalEvents.emitArtifactLog('test-project', 'art-1', ' World\n');
    expect(emitted.length).toBe(1);
    expect(emitted[0].logLine).toBe('Hello World');
    expect(emitted[0].artifactId).toBe('art-1');
    expect(emitted[0].projectId).toBe('test-project');
  });

  it('should not bleed stream output between concurrent artifactIds', () => {
    const emitted: any[] = [];
    portalEvents.on('build_log', (data) => emitted.push(data));

    portalEvents.emitArtifactLog('test-project', 'art-1', 'Log 1 Part A...');
    portalEvents.emitArtifactLog('test-project', 'art-2', 'Log 2 Part A...');
    
    expect(emitted.length).toBe(0);

    portalEvents.emitArtifactLog('test-project', 'art-1', 'Part B\n');
    portalEvents.emitArtifactLog('test-project', 'art-2', 'Part C\n');

    expect(emitted.length).toBe(2);
    
    const art1Logs = emitted.filter(e => e.artifactId === 'art-1');
    const art2Logs = emitted.filter(e => e.artifactId === 'art-2');

    expect(art1Logs.length).toBe(1);
    expect(art1Logs[0].logLine).toBe('Log 1 Part A...Part B');

    expect(art2Logs.length).toBe(1);
    expect(art2Logs[0].logLine).toBe('Log 2 Part A...Part C');
  });
});
