"""Exercise Council's actual terminal UI in a disposable pseudoterminal."""
import os, pty, select, signal, subprocess, tempfile, time, shutil, pathlib
root = pathlib.Path(__file__).resolve().parents[1]
folder = pathlib.Path(tempfile.mkdtemp(prefix='council-tui-'))
project = folder / 'project'
project.mkdir()
(project / 'sample.txt').write_text('original')
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
    send('/quit\r')
    wait_for('\x1b[?1049l')
    assert process.wait(timeout=10) == 0
    print('Verified actual standalone TUI: launch in current directory, built-in editor, permission prompt, real file save, model selection and budget preservation, terminal exit. No OpenCode or model calls.')
finally:
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    os.close(master)
    shutil.rmtree(folder)
