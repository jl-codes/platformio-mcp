#!/usr/bin/env node
/** Assemble the existing acceptance catalog from actual release checks and explicitly retained observations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateAcceptance} from './validate-parity-acceptance.mjs';
const root=process.cwd(), input=path.resolve(process.argv[2]??'.release-evidence'), artifacts=path.resolve(process.argv[3]??'release-artifacts'), out=path.resolve(process.argv[4]??'.release-acceptance');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const commit=git(['rev-parse','HEAD']);
const sourceTree=git(['rev-parse','HEAD^{tree}']);
const record=read('docs/reviews/platformio-parity-acceptance.json');
const catalog=read('docs/reviews/platformio-acceptance-requirements.json');
const digest=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
assert(!fs.existsSync(out),'Never replace an existing packet');
fs.mkdirSync(out,{recursive:true});
const copied=new Map();
const artifact=p=>{
 p=path.resolve(p); if(copied.has(p))return copied.get(p);
 const name=`${copied.size}-${path.basename(p)}`;fs.copyFileSync(p,path.join(out,name));
 const value={path:name,sha256:digest(p)};copied.set(p,value);return value;
};
const progressArtifact=artifact("docs/reviews/platformio-parity-progress.md");
const recordArtifact=artifact('docs/reviews/platformio-parity-acceptance.json');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const reportFiles=[path.join(input,'unit.json'),path.join(input,'e2e.json'),...walk(path.join(input,'ci-unit')).filter(p=>p.endsWith('unit-evidence.json'))];
const ciSources=[];
for(const file of reportFiles.filter(p=>p.endsWith('unit-evidence.json'))){const provenance=path.join(path.dirname(file),'unit-source.json');const source=read(provenance);assert.equal(source.sourceTree,sourceTree,'CI merge tree differs from release tree');ciSources.push(artifact(provenance));}
const reports=reportFiles.map(file=>({file,report:read(file)}));
for(const {report} of reports) assert(report.success && report.numFailedTests===0,'Mandatory test run failed');
const tests=new Map();
for(const {file,report} of reports)for(const suite of report.testResults){
 const relative=suite.name.replaceAll('\\','/').split('/tests/')[1];
 if(relative){const key='tests/'+relative;const values=tests.get(key)??[];values.push({suite,file});tests.set(key,values);}
}
const delta=git(['diff','--name-only',record.retainedRuntimeBaseline,'HEAD','--','src']).split(/\r?\n/).filter(Boolean);
assert.equal(git(['rev-parse',record.retainedRuntimeBaseline+':src']),record.retainedRuntimeTree);
for(const file of delta){assert(Object.hasOwn(record.retainedApplicability.changedSources,file),`Unreviewed retained-evidence source change: ${file}`);const expected=record.retainedApplicability.changedSources[file];assert.equal(fs.existsSync(file)?createHash("sha256").update(fs.readFileSync(file,"utf8").replaceAll("\r\n","\n")).digest("hex"):null,expected);}
const matchesObservedTextDigest=(p,expected)=>{const text=fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');return [text,text.replaceAll('\n','\r\n')].some(value=>createHash('sha256').update(value).digest('hex')===expected);};
assert(matchesObservedTextDigest('plugins/platformio-mcp/.mcp.json',record.hostObservations.declarationSha256),'Retained host declaration changed');
assert.equal(createHash('sha256').update(execFileSync('git',['show',record.pluginLifecycle.inventorySourceCommit+':plugins/platformio-mcp/runtime/inventory.json'])).digest('hex'),record.pluginLifecycle.inventorySha256);
for(const [file,expected] of Object.entries(record.pluginLifecycle.unchangedInstallMetadata)){
 assert(matchesObservedTextDigest(file,expected),'Retained plugin installation metadata changed');
 assert.equal(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show',record.pluginLifecycle.inventorySourceCommit+':'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'),'Retained plugin installation content changed');
}
assert(record.pluginLifecycle.updated && record.pluginLifecycle.removed);
for(const report of record.hostObservations.reports)assert(report.disabledAbsent && report.blocked.length===2 && report.blocked.every(item=>item.error.includes('disabled for MCP server')));
const monitor=record.retainedLegacyMonitor.observations;
assert(/\d{2}:\d{2}:\d{2}\.\d{3} > PIO_HIL_HEALTHY/.test(monitor[0].data.content));
assert.equal(monitor.at(-1).data.state,'inactive');
const board=record.retainedBoardObservations.observations;
for(const observation of board){const value=observation.result.data??observation.result;assert(value.ok===true || value.status==='success',`Unsuccessful retained board observation ${observation.sourceLine}`);}
const physical={ 'PAR-HW-01':[7,10,11,128], 'PAR-HW-03':[7,11], 'PAR-HW-04':[176,184], 'PAR-HW-05':[176,180], 'PAR-HW-06':[37,83,85,89,93,108,131], 'PAR-HW-07':[158,163,167,172] };
const supplemental={
 'PAR-ELF':['docs/reviews/analysis-xtensa-windows-evidence.json','docs/reviews/analysis-cortex-m-windows-evidence.json','docs/reviews/analysis-mcp-windows-evidence.json'],
 'PAR-QUALITY':['docs/reviews/package-mcp-windows-evidence.json',path.join(input,'native-quality.json')],
 'NS-01':[path.join(input,'namespace-tests.tap')],
 'NS-02':[path.join(artifacts,'npm-installation.json')],
 'NS-CONTAINER':[path.join(artifacts,'container-release-identity.json'),path.join(input,'container-amd64.json'),path.join(input,'container-arm64.json')],
};
const native=read(path.join(input,'native-quality.json'));assert(native.sourceCommit===commit || native.sourceTree===sourceTree,'Native quality source differs from release tree');assert.equal(native.outcome,'pass');assert(native.observations.passed.ok && !native.observations.failed.ok && native.observations.failed.failed===1 && native.observations.checked.defect_count>0);
const tap=fs.readFileSync(path.join(input,'namespace-tests.tap'),'utf8');assert(/# fail 0\b/.test(tap) && /# pass [1-9]\d*\b/.test(tap) && !/# (?:skipped|todo) [1-9]/.test(tap));
const npm=read(path.join(artifacts,'npm-installation.json'));assert.equal(npm.sourceCommit,commit);assert.equal(npm.outcome,'pass');assert(npm.aliasUninstallPreservesCanonical && npm.canonicalUninstalled);for(const item of npm.artifacts)assert.equal(digest(path.join(artifacts,item.filename)),item.sha256);
for(const arch of ['amd64','arm64']){const c=read(path.join(input,`container-${arch}.json`));assert.equal(c.sourceCommit,commit);assert.equal(c.outcome,'pass');assert(c.policyDenied && c.eofShutdown && c.imageId);}
for(const requirement of catalog.requirements.filter(r=>r.id.startsWith('NS-HOST-'))){const host=requirement.id.slice(8);const files=walk(path.join(artifacts,'python-host-evidence')).filter(p=>p.endsWith('/'+host+'.json') || p.endsWith('\\'+host+'.json'));assert.equal(files.length,1);const h=read(files[0]);assert.equal(h.sourceCommit,commit);assert.equal(h.outcome,'pass');assert(h.upgrade && h.aliasUninstallPreservesCanonical && h.mcp && h.signals);supplemental[requirement.id]=files;}
const entries=[];
for(const requirement of catalog.requirements){
 const entry=record.entries.find(e=>e.requirementId===requirement.id);assert(entry);
 if(requirement.releaseGate==='deferred'){entries.push(entry);continue;}
 const supporting=[recordArtifact,progressArtifact,...ciSources], cases=[];
 for(const file of entry.testFiles??[]){
  const results=tests.get(file);assert(results?.length,`Missing behavioral test report: ${file}`);
  const observed=new Map();
  for(const result of results){supporting.push(artifact(result.file));for(const test of result.suite.assertionResults){
    const name=test.fullName??test.title;const previous=observed.get(name);
    assert(test.status!=='failed',`Failed behavior: ${file}: ${name}`);
    if(!previous || test.status==='passed')observed.set(name,test.status);
  }}
  assert(observed.size && [...observed.values()].every(status=>status==='passed'),`Behavior never passed on an applicable required host: ${file}`);
  cases.push(...[...observed.keys()].map(title=>({file,title})));supporting.push(artifact(file));
 }
 for(const file of supplemental[requirement.id]??[])supporting.push(artifact(file));
 if(physical[requirement.id])for(const line of physical[requirement.id])assert(board.some(item=>item.sourceLine===line));
 const retained=physical[requirement.id] || ['POL-04','NS-03'].includes(requirement.id);
 assert(cases.length || supplemental[requirement.id]?.length || retained,`No concrete evidence for ${requirement.id}`);
 const assertion=requirement.releaseAssertion??requirement.assertion, timestamp=new Date().toISOString();
 const evidence={sourceCommit:commit,outcome:'pass',kind:requirement.kind,requirements:[requirement.id],assertions:[assertion],passed:cases.length||(physical[requirement.id]?.length??supplemental[requirement.id]?.length??1),failed:0,skipped:0,timestamp,environment:`Release runner ${process.platform}/${process.arch}; retained observations preserve original host and dates`,procedure:'Mapped behavioral cases, exact-artifact installation and explicitly retained observations; see supporting records',cases,retainedEvidence:retained||requirement.id==='PAR-ELF'||requirement.id==='PAR-QUALITY',retainedScope:record.retainedApplicability.explanation};
 const file=path.join(out,requirement.id+'.json');fs.writeFileSync(file,JSON.stringify(evidence,null,2)+'\n');
 entries.push({...entry,implementationStatus:'complete',outcome:'pass',expectedAssertion:assertion,timestamp,environment:evidence.environment,procedure:evidence.procedure,executor:`GitHub Actions ${process.env.GITHUB_RUN_ID??'local assembly'}`,evidence:{path:path.basename(file),sha256:digest(file)},artifacts:[...new Map(supporting.map(a=>[a.path,a])).values()],nextAction:null});
}
const manifest={schemaVersion:1,sourceCommit:commit,entries};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(validateAcceptance(manifest,out,commit)));
