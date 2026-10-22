#!/usr/bin/env python3
"""Validate with native host loaders using temporary configuration roots.

No authentication, model call, marketplace registration, plugin install, or
enable command is used. Supply executable paths if they are not on PATH.
"""
import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--codex', default='codex')
parser.add_argument('--claude', default='claude')
parser.add_argument('--results', type=Path, default=Path('test-results'))
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
plugin = repo / 'plugins/taste-skill-hardened'
args.results.mkdir(parents=True, exist_ok=True)

def global_state():
    paths = [Path.home()/'.codex/config.toml', Path.home()/'.claude/settings.json',
             Path.home()/'.claude/plugins/installed_plugins.json']
    return {str(p): (p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in paths}

before = global_state()
env = {k: os.environ[k] for k in ['PATH', 'LANG', 'TMPDIR'] if k in os.environ}
with tempfile.TemporaryDirectory(prefix='taste-host-validation-') as directory:
    scratch = Path(directory)
    codex_env = {**env, 'CODEX_HOME': str(scratch/'codex')}
    (scratch/'codex').mkdir()
    (scratch/'codex/config.toml').write_text('[features]\nplugins = true\n')
    with (args.results/'codex-loader-stderr.log').open('w') as stderr:
        proc = subprocess.Popen([args.codex, 'app-server', '--listen', 'stdio://'],
                                cwd=repo, env=codex_env, stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=stderr, text=True, bufsize=1)
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ)
        def send(value):
            proc.stdin.write(json.dumps(value)+'\n')
            proc.stdin.flush()
        def reply(identifier):
            deadline = time.monotonic()+20
            while time.monotonic() < deadline:
                for key, _ in selector.select(timeout=.25):
                    line = key.fileobj.readline()
                    if not line:
                        raise RuntimeError('Codex app-server exited')
                    value = json.loads(line)
                    if value.get('id') == identifier:
                        if 'error' in value:
                            raise RuntimeError(value['error'])
                        return value['result']
            raise TimeoutError('Codex loader response timed out')
        try:
            send({'id': 1, 'method': 'initialize', 'params': {
                'clientInfo': {'name': 'taste-hardened-validation', 'version': '1.0'},
                'capabilities': {'experimentalApi': True}}})
            reply(1)
            send({'method': 'initialized'})
            send({'id': 2, 'method': 'plugin/read', 'params': {
                'pluginName': 'taste-skill-hardened',
                'marketplacePath': str(repo/'.agents/plugins/marketplace.json')}})
            detail = reply(2)['plugin']
            assert detail['summary']['installed'] is False
            assert detail['summary']['enabled'] is False
            assert [s['name'] for s in detail['skills']] == ['taste-skill-hardened:taste-frontend-hardened']
            assert not detail['hooks'] and not detail['mcpServers'] and not detail['apps']
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            selector.close()
    claude_env = {**env, 'CLAUDE_CONFIG_DIR': str(scratch/'claude')}
    validations = []
    for target in [repo, plugin, plugin/'skills']:
        result = subprocess.run([args.claude, 'plugin', 'validate', '--strict', '--json', str(target)],
                                env=claude_env, cwd=scratch, capture_output=True, text=True, timeout=20)
        data = json.loads(result.stdout)
        validations.append({'target': str(target.relative_to(repo)), 'exit_code': result.returncode,
                            'success': data['success'], 'manifest': data['manifest']})
        assert result.returncode == 0, data
    inventory = subprocess.run([args.claude, '--plugin-dir', str(plugin), 'plugin', 'details', 'taste-skill-hardened'],
                               env=claude_env, cwd=scratch, capture_output=True, text=True, timeout=20)
    assert inventory.returncode == 0, inventory.stderr
    assert 'Skills (1)  taste-frontend-hardened' in inventory.stdout
    assert 'Hooks (0)' in inventory.stdout and 'MCP servers (0)' in inventory.stdout
    versions = {name: subprocess.run([executable, '--version'], env=env, capture_output=True,
                                    text=True, timeout=10).stdout.strip()
                for name, executable in [('codex', args.codex), ('claude', args.claude)]}
    assert before == global_state(), 'host configuration changed'
    result = {'versions': versions, 'codex': detail, 'claude_validation': validations,
              'claude_inventory': inventory.stdout, 'global_config_unchanged': True,
              'installed': False, 'enabled': False, 'model_calls': 0,
              'scope': 'Native packaging and loader checks; no live model behavior claim.'}
    (args.results/'host-validation.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'versions': versions, 'native_loaders': 'passed', 'installed': False,
                      'enabled': False, 'global_config_unchanged': True, 'model_calls': 0}, indent=2))
