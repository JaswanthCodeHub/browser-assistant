"""Start an isolated loopback API with mocked AI and a disposable database."""
import base64
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CHILD = r'''
import asyncio,json,re,sys
from types import SimpleNamespace
import main,uvicorn
ANSWER='[{"type":"mcq","answer":"Option C: 13","reasoning":"Synthetic smoke fixture"}]'
async def text(messages,*args,**kwargs):
    if 'slow smoke' in str(messages):
        await asyncio.sleep(30)
    return ANSWER
main.try_groq=text
def create(**kwargs):
    content=kwargs['messages'][1]['content']
    prompt=content[0]['text']
    match=re.search(r'in order: (\[[\d, ]+\])',prompt)
    result=json.dumps({'images':[{'id':n,'text':f'Complete synthetic evidence for image {n}'} for n in json.loads(match.group(1))]}) if match else ANSWER
    if any(isinstance(m.get('content'),str) and m['content'].startswith('SECOND VISUAL SOLVE.') for m in kwargs['messages']):
        result=json.dumps({'readable':True,'answers':[{'id':1,'answer':'Option C: 13'}]})
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=result))])
client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)),close=lambda:None)
main._groq_clients=[client]
main.get_groq_client=lambda:client
uvicorn.run(main.app,host='127.0.0.1',port=int(sys.argv[1]),log_level='error')
'''


def main():
    (ROOT/'.cache').mkdir(exist_ok=True)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix='backend-smoke-',dir=ROOT/'.cache') as temp:
        env={**os.environ,'GROQ_API_KEY':'','GROQ_API_KEY_2':'','GROQ_API_KEY_3':'','ASSISTANT_LOCAL_TOKEN':'',
             'HISTORY_DB_PATH':str(Path(temp)/'history.db')}
        with subprocess.Popen([sys.executable,'-c',CHILD,str(port)],cwd=ROOT/'server',env=env,
                              stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True) as process:
            try:
                def request(path, body=None, headers=None, method=None):
                    token_path = Path(temp)/'assistant-pairing.token'
                    token = token_path.read_text(encoding='ascii') if token_path.exists() else ''
                    req=Request(f'http://127.0.0.1:{port}{path}',
                        data=json.dumps(body).encode() if body is not None else None,
                        headers={'Content-Type':'application/json','X-Assistant-Token':token,**(headers or {})}, method=method)
                    with urlopen(req,timeout=15) as response:
                        return response.status,json.loads(response.read())
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError('Smoke server exited: '+process.stdout.read()[-1500:])
                    try:
                        status,health=request('/health');break
                    except URLError:time.sleep(0.1)
                else:raise RuntimeError('Smoke server did not start')
                assert status==200 and health['vision_batching'] is True
                assert request('/history')[1]['items']==[]
                with urlopen(f'http://127.0.0.1:{port}/practice',timeout=5) as response:
                    assert b'Practice Quiz' in response.read()
                body={'text':'What is 6 + 7? A. 11 B. 12 C. 13 D. 14','url':'https://example.test','practice_type':'mcq'}
                assert json.loads(request('/solve',body)[1]['results'])[0]['answer']=='Option C: 13'
                job = {'id':str(uuid4()), 'route':'/solve', 'body':body}
                assert request('/jobs',job)[0] == 202
                for _ in range(30):
                    _, result = request('/jobs/' + job['id'])
                    if result['state'] == 'finished':
                        break
                    time.sleep(0.1)
                assert result['status'] == 200 and result['data']['items'][0]['answer'] == 'Option C: 13'
                slow = {**job, 'id':str(uuid4()), 'body':{**body, 'text':'slow smoke: pick one A. 1 B. 2 C. 13 D. 9'}}
                assert request('/jobs',slow)[0] == 202
                slow_path = '/jobs/' + slow['id']
                assert request(slow_path,method='DELETE')[1]['ok']
                assert request(slow_path)[1]['status'] == 409
                images=[]
                for n in range(5):
                    output=BytesIO();Image.new('RGB',(8,8),(n*45,20,120)).save(output,format='PNG')
                    images.append('data:image/png;base64,'+base64.b64encode(output.getvalue()).decode())
                for count in (1,3,5):
                    result=request('/solve-vision',{**body,'image':images[0],'images':images[1:count]})[1]
                    assert json.loads(result['results'])[0]['answer']=='Option C: 13'
                entry={'scan_type':'text','url':'https://example.test/?private=fixture#fragment','provider':'mock-smoke','results':request('/solve',body)[1]['results']}
                assert request('/history',entry)[0]==201
                items = request('/history')[1]['items']
                assert len(items) == 1 and items[0]['url'] == 'https://example.test/'
                for method, path in [('GET','/history'),('DELETE','/history'),('GET',slow_path),('POST','/solve')]:
                    try:
                        request(path,headers={'X-Assistant-Token':''},method=method)
                    except HTTPError as error:
                        assert error.code == 401
                    else:
                        raise AssertionError(f'Unpaired {method} {path} was accepted')
                try:request('/history',headers={'Origin':'https://untrusted.example'})
                except HTTPError as error:assert error.code==403
                else:raise AssertionError('Untrusted origin was accepted')
                print(json.dumps({'startup':'passed','text_scan':'passed','vision_images':[1,3,5],
                    'history_persistence':'passed','origin_guard':'passed','pairing':'passed','job_cancellation':'passed','providers':'mocked',
                    'production_database_touched':False,'version':health['version']}))
            finally:
                process.terminate()
                try:process.communicate(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.communicate(timeout=5)


if __name__=='__main__':main()
