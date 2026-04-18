const fs = require('fs');
let lines = fs.readFileSync('src/index.ts', 'utf8').split('\n');

// 1. Remove imports
lines = lines.filter(line => !line.includes('AcquireLockParamsSchema') && !line.includes('ReleaseLockParamsSchema') && !line.includes('QueryLogsParamsSchema'));
lines = lines.filter(line => !line.includes('queryLogs,') && !line.includes('startSpoolingDaemon,') && !line.includes('stopSpoolingDaemon,'));
lines = lines.filter(line => !line.includes('import { startPortalServer') && !line.includes('import { portalEvents') && !line.includes('import { hardwareLockManager'));

// 2. Remove specific schema configs
const schemaStart = lines.findIndex(l => l.includes('name: "query_logs",'));
const schemaEnd = lines.findIndex(l => l.includes('name: "search_libraries",'));
if (schemaStart !== -1 && schemaEnd !== -1) {
    // Find the opening brace of query_logs
    let startIdx = schemaStart - 1; 
    // Find the opening brace of search_libraries
    let endIdx = schemaEnd - 1;
    lines.splice(startIdx, endIdx - startIdx);
}

// 3. Remove event emit at start of CallToolRequestSchema
const eventIdx = lines.findIndex(l => l.includes('portalEvents.emitActivity(name, args'));
if (eventIdx !== -1) {
    lines.splice(eventIdx, 6); // Removes the emit and workspace shift if-block
}

// 4. Remove hardwareLockManager usage in handlers
// build_project
let idx = lines.findIndex(l => l.includes('case "build_project": {'));
if (idx !== -1) {
    const start = lines.findIndex((l, i) => i > idx && l.includes('const executeTask = () =>'));
    if (start !== -1) {
        lines.splice(start, 6, 
            '        const result = await buildProject(params.projectDir, params.environment, params.verbose);'
        );
    }
}
// clean_project
idx = lines.findIndex(l => l.includes('case "clean_project": {'));
if (idx !== -1) {
    const start = lines.findIndex((l, i) => i > idx && l.includes('const executeTask = () =>'));
    if (start !== -1) {
        lines.splice(start, 5, 
            '        const result = await cleanProject(params.projectDir);'
        );
    }
}
// upload_filesystem
idx = lines.findIndex(l => l.includes('case "upload_filesystem": {'));
if (idx !== -1) {
    const start = lines.findIndex((l, i) => i > idx && l.includes('const executeTask = () =>'));
    if (start !== -1) {
        lines.splice(start, 11, 
            '        const result = await uploadFilesystem(',
            '          params.projectDir,',
            '          params.port,',
            '          params.environment,',
            '          params.verbose,',
            '          params.startSpoolingAfter,',
            '        );'
        );
    }
}
// upload_firmware
idx = lines.findIndex(l => l.includes('case "upload_firmware": {'));
if (idx !== -1) {
    const start = lines.findIndex((l, i) => i > idx && l.includes('const executeTask = () =>'));
    if (start !== -1) {
        lines.splice(start, 11, 
            '        const result = await uploadFirmware(',
            '          params.projectDir,',
            '          params.port,',
            '          params.environment,',
            '          params.verbose,',
            '          params.startSpoolingAfter,',
            '        );'
        );
    }
}

// 5. Remove handlers for removed tools
const handlersStart = lines.findIndex(l => l.includes('case "query_logs": {'));
const handlersEnd = lines.findIndex(l => l.includes('case "search_libraries": {'));
if (handlersStart !== -1 && handlersEnd !== -1) {
    lines.splice(handlersStart, handlersEnd - handlersStart);
}

// 6. Remove portalEvents in catch block
const catchIdx = lines.findIndex(l => l.includes('portalEvents.emitActivity('));
if (catchIdx !== -1) {
    lines.splice(catchIdx, 5);
}

// 7. Remove startPortalServer inside main
const mainIdx = lines.findIndex(l => l.includes('startPortalServer();'));
if (mainIdx !== -1) {
    lines.splice(mainIdx - 1, 3); // removes the comment, function call, and blank line
}

// Final cleanup: remove empty monitor import block
for (let i = 0; i < lines.length; i++) {
   if (lines[i] === 'import {' && lines[i+1] === '} from "./tools/monitor.js";') {
       lines.splice(i, 2);
       break;
   }
}

fs.writeFileSync('src/index.ts', lines.join('\n'));
console.log('Script completed');
