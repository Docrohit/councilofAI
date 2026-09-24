"""Exercise Council's actual terminal UI in a disposable pseudoterminal."""
import os, pty, select, signal, subprocess, tempfile, time, shutil, pathlib, json
root = pathlib.Path(__file__).resolve().parents[1]
folder = pathlib.Path(tempfile.mkdtemp(prefix='council-tui-'))
project = folder / 'project'
project.mkdir()
(project / 'sample.txt').write_text('original')
(project / 'sample.ts').write_text('const n = 1;')
skill = project / '.agents' / 'skills' / 'fixture'
skill.mkdir(parents=True)
body = 'Inspect the actual evidence.'
body += 'x' * (8000 - len(body)) + 'SECOND_PAGE_INSTRUCTIONS'
(skill / 'SKILL.md').write_text('---\nname: fixture\ndescription: PTY skill check\n---\n' + body)
config = folder / 'config'
config.mkdir()
(config / 'lsp.json').write_text(json.dumps([{'id': 'fixture', 'command': shutil.which('node'), 'args': ['-e', 'setInterval(()=>{},1000)'], 'languages': {'.ts': 'typescript'}}]))
master, slave = pty.openpty()
env = dict(os.environ, COUNCIL_CONFIG_DIR=str(folder / 'config'), COUNCIL_DATA_HOME=str(folder / 'data'), TERM='xterm-256color')
process = subprocess.Popen([shutil.which('node'), str(root / 'bin/council.mjs'), '--agents', '5', '--max-calls', '40'], cwd=project, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
seen = b''
def wait_for(text, timeout=10):
    global seen
    until = time.monotonic() + timeout
    while time.monotonic() < until:
        if text.encode() in seen:
            return
        ready, _, _ = select.select([master], [], [], 0.1)
        if ready:
            try: seen += os.read(master, 65536)
            except OSError: break
    raise AssertionError(f'TUI did not show {text!r}: {seen[-3000:]!r}')
def send(text):
    global seen
    seen = b''
    os.write(master, text.encode())
try:
    wait_for('Council')
    send('/edit sample.txt\r')
    wait_for('line 1, column 1')
    # Insert at the beginning, save, approve the exact file modification.
    send('updated ')
    wait_for('modified')
    send('\x13')
    wait_for('Write sample.txt')
    send('y')
    wait_for('Saved sample.txt')
    assert (project / 'sample.txt').read_text() == 'updated original'
    send('\x1b')
    wait_for('Editor closed')
    send('/connect fixture compatible unused\r')
    wait_for('Saved fixture')
    assert b'5 agents' in seen and b'0/40 calls' in seen
    send('/budget 60\r')
    wait_for('budget updated to 60')
    send('/use fixture\r')
    wait_for('Model pool updated')
    assert b'0/60 calls' in seen
    send('/agents 6\r')
    wait_for('Agent count updated')
    assert b'6 agents' in seen and b'0/60 calls' in seen
    send('hello\r')
    wait_for('Hello! What would you like to work on?')
    assert b'0/60 calls' in seen
    send('/skills\r')
    wait_for('PTY skill check')
    send('/skill fixture\r')
    wait_for('"nextOffset": 8000')
    send('/skill fixture - 8000\r')
    wait_for('SECOND_PAGE_INSTRUCTIONS')
    send('/lsp diagnostics sample.ts\r')
    wait_for('Start language server')
    send('y')
    wait_for('Reading project tools')
    send('\x1b')
    wait_for('LSP request cancelled.')
    send('/quit\r')
    wait_for('\x1b[?1049l')
    assert process.wait(timeout=10) == 0
    print('Verified actual standalone TUI: launch in current directory, built-in editor, permission prompt, real file save, model selection and budget preservation, paged Skills, LSP permission and cancellation, terminal exit. No OpenCode or model calls.')
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    os.close(master)
    shutil.rmtree(folder)
