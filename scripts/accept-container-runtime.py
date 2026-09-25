"""Check native container MCP, mounted policy and EOF; physical passthrough is deferred."""
import json, subprocess, tempfile, sys, queue, threading, uuid
from pathlib import Path
from datetime import datetime, timezone
image, version, commit, output = sys.argv[1:]
with tempfile.TemporaryDirectory(prefix='pio-container-policy-') as temporary:
    policy=Path(temporary)/'policy.yaml'; policy.write_text('allow: [get_policy_status]\napproval_required: []\n'); policy.chmod(0o644)
    messages=[
      {'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'container-acceptance','version':'1'}}},
      {'jsonrpc':'2.0','method':'notifications/initialized'},
      {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}},
      {'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'build_project','arguments':{'projectDir':'/tmp'}}},
      {'jsonrpc':'2.0','id':4,'method':'tools/call','params':{'name':'get_policy_status','arguments':{'projectDir':'/tmp'}}}]
    name='pio-acceptance-'+uuid.uuid4().hex
    process=subprocess.Popen(['docker','run','--rm','--name',name,'-i','--network','none','--mount',f'type=bind,src={policy},dst=/tmp/policy.yaml,readonly','-e','PIO_MCP_POLICY_FILE=/tmp/policy.yaml','-e','PIO_MCP_NO_BROWSER=true',image],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    received=queue.Queue();errors=[]
    def read_output():
        try:
            for line in process.stdout:
                received.put(json.loads(line))
        except Exception as error:
            received.put(error)
    def read_errors():
        errors.append(process.stderr.read())
    reader=threading.Thread(target=read_output,daemon=True);reader.start()
    diagnostics=threading.Thread(target=read_errors,daemon=True);diagnostics.start()
    replies={}
    try:
        process.stdin.write(''.join(json.dumps(m)+'\n' for m in messages));process.stdin.flush()
        while not {1,2,3,4}.issubset(replies):
            message=received.get(timeout=30)
            if isinstance(message,Exception):raise message
            if 'id' in message:replies[message['id']]=message
        # EOF follows completed responses, rather than cancelling an in-flight read.
        process.stdin.close()
        assert process.wait(timeout=15)==0
        reader.join(timeout=2);diagnostics.join(timeout=2)
    finally:
        if process.poll() is None:
            subprocess.run(['docker','rm','--force',name],capture_output=True,timeout=15)
            process.kill();process.wait(timeout=5)
    assert replies[1]['result']['serverInfo']['version']==version
    assert 'build_project' in {t['name'] for t in replies[2]['result']['tools']}
    denied=json.dumps(replies[3]).lower();assert 'policy_denied' in denied or '"status": "deny"' in denied,denied
    assert '/tmp/policy.yaml' in json.dumps(replies[4]),replies[4]
    identity=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0]
    report={'schemaVersion':1,'sourceCommit':commit,'timestamp':datetime.now(timezone.utc).isoformat(),'outcome':'pass','imageId':identity['Id'],'architecture':identity['Architecture'],'version':version,'policyDenied':True,'eofShutdown':True,'observations':replies,'scope':'Native image MCP, mounted policy, EOF; device passthrough deferred by maintainer'}
    target=Path(output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2)+'\n')
