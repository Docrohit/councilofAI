"""Real PTY coverage for the composer, pickers and collaboration views. No provider calls."""
import http.server, threading
import os, pty, select, signal, subprocess, tempfile, time, shutil, pathlib, json, fcntl, termios, struct
root = pathlib.Path(__file__).resolve().parents[1]
folder = pathlib.Path(tempfile.mkdtemp(prefix='council-workspace-'))
project = folder / 'project'
project.mkdir()
env = dict(os.environ, COUNCIL_CONFIG_DIR=str(folder / 'config'), COUNCIL_DATA_HOME=str(folder / 'data'), TERM='xterm-256color', COUNCIL_FIXTURE_PROJECT=str(project))
# Seed history using the real storage API, without invoking the engine or any model.
seed = '''
import {NativeCouncil,saveModel} from './cli/native.ts';
saveModel({id:'fixture',kind:'compatible',model:'unused',baseUrl:'http://127.0.0.1:9/v1'});
const c=new NativeCouncil(process.env.COUNCIL_FIXTURE_PROJECT,async()=>false);
const config=c.config(['fixture'],5), id='workspace-history-fixture';
c.store.saveRun(c.userId,{id,title:'Polynomial verification',prompt:'Solve a polynomial',config,createdAt:new Date().toISOString(),status:'completed',final:'Roots are -2, -1, 1, 2.',demo:true});
const a=config.members[0],b=config.members[1];
c.store.event(id,'turn.start',{turnId:'one',name:a.name,agentId:a.id,model:'unused',phase:'discussion'});
c.store.event(id,'turn.delta',{turnId:'one',text:'DISCUSSION_FIXTURE'});
c.store.event(id,'agent.message',{name:a.name,to:b.id,kind:'delegate',content:'ENGAGEMENT_FIXTURE'});
c.store.event(id,'board.post',{post:{id:'post',author:a.id,content:'BOARD_FIXTURE'}});
c.store.event(id,'conversation.updated',{conversation:{id:'thread',participants:[a.id,b.id],topic:'CONVERSATION_FIXTURE',messages:[{author:a.id,content:'Check roots',at:''}]}});
c.store.event(id,'finding.updated',{finding:{id:'finding',key:'roots',author:a.id,claim:'FINDING_FIXTURE',evidence:['Substitution'],revision:1,state:'established',challenges:[]}});
await c.close();
'''
subprocess.run([shutil.which('node'),'--import','tsx','--input-type=module','-e',seed],cwd=root,env=env,check=True,capture_output=True)
requests=[]
class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        requests.append(json.loads(self.rfile.read(int(self.headers.get('Content-Length','0')))))
        time.sleep(1)
        text='Verify this command.\n```council\n'+json.dumps({'tools':[{'name':'project_exec','command':'echo APPROVAL_FIXTURE'}]})+'\n```'
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        try:self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':text}}]})+'\n\ndata: [DONE]\n\n').encode())
        except BrokenPipeError:pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Fixture)
threading.Thread(target=server.serve_forever,daemon=True).start()
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',36,125,0,0))
process=subprocess.Popen([shutil.which('node'),str(root/'bin/council.mjs'),'--agents','5'],cwd=project,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
os.close(slave)
seen=b''
transcript=b''
def wait_for(text,timeout=10):
    global seen,transcript
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        if text.encode() in seen:return
        ready,_,_=select.select([master],[],[],0.1)
        if ready:
            try: chunk=os.read(master,65536)
            except OSError:break
            seen+=chunk;transcript+=chunk
    raise AssertionError(f'Missing {text!r}: {seen[-4500:]!r}')
def send(text):
    global seen
    seen=b'';os.write(master,text.encode())
try:
    wait_for('Ask anything')
    send('/')
    wait_for('Commands')
    send('sessions\r')
    wait_for('Saved sessions')
    send('Polynomial\r')
    wait_for('Roots are -2')
    for cmd,marker in [('discussion','DISCUSSION_FIXTURE'),('engagement','ENGAGEMENT_FIXTURE'),('board','BOARD_FIXTURE'),('conversations','CONVERSATION_FIXTURE'),('findings','FINDING_FIXTURE'),('answer','Roots are -2')]:
        send('/'+cmd+'\r');wait_for(marker)
    send('\x10')
    wait_for('Council commands')
    send('connections\r')
    wait_for('Local connections')
    send('\r')
    wait_for('Choose provider')
    send('openai\r')
    wait_for('API key (paste here; masked)')
    # Invalid input produces one readable error without growing the screen.
    send('\t\x15\r');wait_for('Enter the exact model ID')
    assert b'"invalid_format"' not in seen and b'"issues"' not in seen
    frame=seen.split(b'\x1b[H')[-1].split(b'\x1b[J')[0]
    assert frame.count(b'\n') < 36
    send('gpt-5.3-codex\x1b[Z')
    # fields: ID, model, base URL, API key, optional environment name. Secret is pasted literally.
    send('\x15codex\t\t\t')
    wait_for('API key (paste here; masked)')
    send('\t\x1b[200~sk-proj-mistaken-fixture-value\x1b[201~');wait_for('Use a variable NAME')
    assert b'sk-proj-mistaken-fixture-value' not in transcript
    send('\x1b[Z')
    send('\x1b[200~fixture-super-private-key\x1b[201~')
    wait_for('••••')
    send('\r')
    wait_for('Saved codex')
    assert b'fixture-super-private-key' not in transcript
    metadata=json.loads((folder/'config/native-models.json').read_text())
    assert next(m for m in metadata if m['id']=='codex')['model']=='gpt-5.3-codex'
    assert 'fixture-super-private-key' not in (folder/'config/native-keys.json').read_text()
    send('/models\r');wait_for('Models for this team')
    send('fixture \r');wait_for('Model pool updated')
    send('/agents\r');wait_for('Starting agents')
    send('\x155\r');wait_for('Agent count updated')
    assert b'5 agents' in seen
    send('/connect missing openai gpt-5.3-codex https://api.openai.com/v1 COUNCIL_ABSENT_FIXTURE_KEY\r');wait_for('Saved missing')
    send('/use missing\r');wait_for('Model pool updated')
    send('Follow up with unavailable key\r');wait_for('Add a key in /connections')
    send('/answer\r');wait_for('Roots are -2')
    # Multiline paste must remain a draft, never execute either command.
    send('\x1b[200~/quit\n/agents 8\x1b[201~');wait_for('/agents 8')
    assert process.poll() is None
    send('\x15')
    wait_for('Ask anything')
    # A permission arriving while the live view palette is open must replace it.
    send('/connect fixture compatible unused http://127.0.0.1:'+str(server.server_port)+'/v1\r');wait_for('Saved fixture')
    send('/use fixture\r');wait_for('Model pool updated')
    send('Exercise approval fixture\r');wait_for('Working')
    send('\x10');wait_for('Views · team is working')
    wait_for('APPROVAL_FIXTURE');wait_for('[User approval required]')
    assert 'Previous answer:\nRoots are -2' in json.dumps(requests).replace('\\n','\n')
    assert b'Council commands' not in seen
    send('\x03');wait_for('Stopping')
    wait_for('cancelled')
    send('/new\r');wait_for('New conversation')
    # Small terminal: active view remains discoverable and composer remains present.
    fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',18,42,0,0));os.kill(process.pid,signal.SIGWINCH)
    send('/findings\r');wait_for('[Findings]');wait_for('Ask Council')
    send('/quit\r');wait_for('\x1b[?1049l')
    assert process.wait(timeout=10)==0
    print('Verified TUI workspace: composer, slash menu, command palette, searchable saved sessions, six collaboration views, connection wizard, masked encrypted key paste, model selection, five agents, safe multiline paste, resize and clean exit. No external model calls (local scripted provider only).')
finally:
    if process.poll() is None:os.killpg(process.pid,signal.SIGKILL);process.wait()
    server.shutdown();server.server_close();os.close(master);shutil.rmtree(folder)
