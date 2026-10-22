#!/usr/bin/env python3
"""Run this checkout's tests offline. Never pull images or install plugins."""
from pathlib import Path
import argparse,json,subprocess
parser=argparse.ArgumentParser()
parser.add_argument('--image',required=True)
parser.add_argument('--results',type=Path,default=Path('test-results'))
args=parser.parse_args()
repo=Path(__file__).resolve().parent.parent
args.results.mkdir(parents=True,exist_ok=True)
image=subprocess.run(['docker','image','inspect',args.image,'--format','{{.Id}}'],capture_output=True,text=True,check=True).stdout.strip()
command=['docker','run','--rm','--label','codex.task=taste-skill-hardening','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--security-opt','seccomp='+str(repo/'tests/sandbox/seccomp.json'),'--pids-limit','512','--memory','1536m','--cpus','2','--tmpfs','/tmp:rw,noexec,nosuid,size=512m','--shm-size','256m','--mount','type=bind,src='+str(repo)+',dst=/repo,readonly',image,'timeout','--kill-after=3','50','node','--test','--test-reporter','tap']
command += ['tests/'+name for name in ['browser.test.mjs','draw.test.mjs','network-policy.test.mjs','package.test.mjs','public-server.test.mjs']]
r=subprocess.run(command,capture_output=True,text=True,timeout=65)
(args.results/'isolated-tests.tap').write_text(r.stdout+r.stderr)
result={'exit_code':r.returncode,'image_id':image,'network':'none','source_mount':'read-only','host_credential_mounts':False,'privileged':False,'capabilities':'all dropped','browser_sandbox':'enabled','plugins_installed':False}
(args.results/'isolation.json').write_text(json.dumps(result,indent=2)+'\n')
print(r.stdout);print(r.stderr,end='');print(json.dumps(result))
raise SystemExit(r.returncode)
