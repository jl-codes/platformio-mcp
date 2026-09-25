"""Check native container MCP, mounted policy and EOF; physical passthrough is deferred."""
import json, subprocess, tempfile, sys
from pathlib import Path
from datetime import datetime, timezone
image, version, commit, output = sys.argv[1:]
with tempfile.TemporaryDirectory(prefix='pio-container-policy-') as temporary:
    policy=Path(temporary)/'policy.yaml'; policy.write_text('allow: []\napproval_required: []\n'); policy.chmod(0o644)
    messages=[
      {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'container-acceptance','version':'1'}}},
      {'jsonrpc':'2.0','method':'notifications/initialized'},
      {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},
      {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'build_project','arguments':{'projectDir':'/tmp'}}},
      {'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'get_policy_status','arguments':{'projectDir':'/tmp'}}}]
    result=subprocess.run(['docker','run','--rm','-i','--network','none','--mount',f'type=bind,src={policy},dst=/tmp/policy.yaml,readonly','-e','PIO_MCP_POLICY_FILE=/tmp/policy.yaml','-e','PIO_MCP_NO_BROWSER=true',image],input=''.join(json.dumps(m)+'\n' for m in messages),capture_output=True,text=True,timeout=45)
    assert result.returncode==0,result.stderr
    replies={m['id']:m for m in (json.loads(line) for line in result.stdout.splitlines()) if 'id' in m}
    assert replies[1]['result']['serverInfo']['version']==version
    assert 'build_project' in {t['name'] for t in replies[2]['result']['tools']}
    denied=json.dumps(replies[3]).lower();assert 'policy_denied' in denied or '"status": "deny"' in denied,denied
    assert '/tmp/policy.yaml' in json.dumps(replies[4]),replies[4]
    identity=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
    report={'schemaVersion':1,'sourceCommit':commit,'timestamp':datetime.now(timezone.utc).isoformat(),'outcome':'pass','imageId':identity['Id'],'architecture':identity['Architecture'],'version':version,'policyDenied':True,'eofShutdown':True,'observations':replies,'scope':'Native image MCP, mounted policy, EOF; device passthrough deferred by maintainer'}
    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n')
