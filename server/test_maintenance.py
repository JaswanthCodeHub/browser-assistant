import base64
import asyncio
from io import BytesIO
import json
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

import main
from local_security import redact
from vision_images import compress_image_base64


def image(number=0):
    output = BytesIO()
    Image.new('RGB', (8,8), color=(number * 45, 20, 120)).save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()


ANSWER = '[{"type":"mcq","answer":"Option C: 13","reasoning":"Use every supplied diagram."}]'


class VisionBatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_five_image_code_language_can_be_supplied_by_the_last_image(self):
        counts=[]
        def create(**kwargs):
            blocks=kwargs['messages'][1]['content'];counts.append(sum(item.get('type')=='image_url' for item in blocks))
            prompt=blocks[0]['text']
            if 'in order: ' in prompt:
                ids=json.loads(prompt.split('in order: ',1)[1].split('. ',1)[0])
                value={'images':[{'id':n,'text':'Write solution in Python.' if n==5 else 'Question evidence.'} for n in ids]}
            else:
                value=[{'type':'code','language':'python','code':'print(13)','approach':'Print the result.',
                        'time_complexity':'O(1)','space_complexity':'O(1)'}]
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps(value)))])
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main,'get_groq_client',return_value=client),patch.object(main,'_groq_clients',[client]), \
             patch.object(main,'VISION_MODELS',['qwen/qwen3.8-27b']),patch.object(main,'CODE_DEFAULT_LANGUAGE','java'), \
             patch.object(main,'try_independent_code_review',AsyncMock(return_value='{"verdict":"pass","issues":[]}')):
            result=await main.solve_vision(main.VisionContent(image=image(0),images=[image(n) for n in range(1,5)],
                    url='https://example.test',practice_type='code'))
        self.assertEqual(result['language'],'python');self.assertEqual(counts,[3,2,0])

    async def test_overall_deadline_returns_504_without_a_partial_result(self):
        with patch.object(main,'_solve_vision',AsyncMock(side_effect=asyncio.TimeoutError)):
            with self.assertRaises(HTTPException) as error:
                await main.solve_vision(main.VisionContent(image=image(),url='https://example.test'))
        self.assertEqual(error.exception.status_code,504)

    async def solve(self, count, failure=None, inputs=None):
        calls = []
        failed = False
        def create(**kwargs):
            nonlocal failed
            messages = kwargs['messages']
            # The original visual evidence stays in the first user message.
            batch_prompt = messages[1]['content'][0]['text']
            physical = [block for block in messages[1]['content'] if isinstance(block,dict) and block.get('type') == 'image_url']
            calls.append((physical, str(messages)))
            if messages[0]['content'].startswith('SECOND VISUAL SOLVE'):
                content=json.dumps({'readable':True,'answers':[{'id':1,'answer':'Option C: 13'}]})
            elif 'Use exactly these image ids' in batch_prompt:
                ids = json.loads(batch_prompt.split('in order: ',1)[1].split('. ',1)[0])
                if failure == 'transient' and ids[0] == 4 and not failed:
                    failed = True
                    raise RuntimeError('HTTP 503 temporarily unavailable')
                if failure == 'partial' and ids[0] == 4:
                    raise RuntimeError('HTTP 503 temporarily unavailable')
                entries = [{'id':n,'text':f'Image {n} chart evidence. Python requested.'} for n in ids]
                if failure == 'missing': entries.pop()
                content = json.dumps({'images':entries})
            else:
                content = ANSWER
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=content))])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        inputs = inputs or [image(i) for i in range(count)]
        with patch.object(main,'get_groq_client',return_value=client), patch.object(main,'_groq_clients',[client]), \
             patch.object(main,'VISION_MODELS',['qwen/qwen3.8-27b']):
            result = await main.solve_vision(main.VisionContent(image=inputs[0],images=inputs[1:],
                text='ORIGINAL QUESTION AND OPTIONS: A. 11 B. 12 C. 13 D. 14',url='https://example.test',practice_type='mcq'))
        return result,calls

    async def test_one_three_and_five_images_are_processed_without_exceeding_three_per_call(self):
        for count in (1,3,5):
            with self.subTest(count=count):
                result,calls = await self.solve(count)
                self.assertEqual(json.loads(result['results'])[0]['answer'],'Option C: 13')
                self.assertEqual([len(images) for images,_ in calls], [3,2,0,0] if count == 5 else [count,count])
                sent = [block['image_url']['url'] for images,_ in calls for block in images]
                self.assertEqual(len(set(sent)),count)
                self.assertTrue(all('ORIGINAL QUESTION AND OPTIONS' in text for _,text in calls))
                if count == 5:
                    self.assertTrue(all(f'Image {n} chart evidence' in calls[-1][1] for n in range(1,6)))

    async def test_only_failed_batch_is_retried_and_successful_batch_is_not_repeated(self):
        _,calls = await self.solve(5,'transient')
        self.assertEqual([len(images) for images,_ in calls],[3,2,2,0,0])

    async def test_partial_batch_failure_never_returns_an_answer(self):
        with self.assertRaises(HTTPException) as error:
            await self.solve(5,'partial')
        self.assertEqual(error.exception.status_code,502)
        self.assertIn('Image batch [4, 5]',str(error.exception.detail))

    async def test_missing_image_evidence_is_rejected_even_after_schema_retry(self):
        with self.assertRaises(HTTPException) as error:
            await self.solve(5,'missing')
        self.assertIn('every image exactly once',str(error.exception.detail))

    async def test_duplicates_are_not_sent_twice_and_logical_positions_are_preserved(self):
        _,calls = await self.solve(5,inputs=[image(0),image(1),image(0),image(2),image(1)])
        self.assertEqual([len(images) for images,_ in calls],[3,3])
        self.assertIn('[1, 2, 1, 3, 2]',calls[0][1])

    async def test_invalid_formats_are_rejected_before_any_provider_call(self):
        for bad in ('garbage','data:image/png;base64,not-base64!', 'data:image/svg+xml;base64,PHN2Zz4='):
            provider = Mock()
            with patch.object(main,'get_groq_client',provider), self.assertRaises(HTTPException) as error:
                await main.solve_vision(main.VisionContent(image=bad,url='https://example.test'))
            self.assertEqual(error.exception.status_code,422)
            self.assertIn('Image 1',str(error.exception.detail))
            provider.assert_not_called()

    def test_valid_raw_base64_and_transparent_png_keep_compatibility(self):
        raw = image().split(',',1)[1]
        decoded = Image.open(BytesIO(base64.b64decode(compress_image_base64(raw))))
        self.assertEqual(decoded.format,'JPEG')
        transparent = BytesIO();Image.new('RGBA',(2,2),(0,0,0,0)).save(transparent,format='PNG')
        converted = compress_image_base64(base64.b64encode(transparent.getvalue()).decode())
        decoded = Image.open(BytesIO(base64.b64decode(converted)))
        self.assertTrue(all(value > 245 for value in decoded.getpixel((0,0))))


class ReliabilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_unavailable_text_model_falls_back_without_changing_the_primary_setting(self):
        provider=AsyncMock(side_effect=[RuntimeError('404 model_not_found'),ANSWER])
        with patch.object(main,'TEXT_MODELS',['custom-primary','openai/gpt-oss-20b']), \
             patch.object(main,'_groq_disabled_until',0),patch.object(main,'try_groq',provider):
            result=await main.solve_questions(main.PageContent(text='What is 6 + 7?',url='https://example.test',practice_type='mcq'))
        self.assertIn('openai/gpt-oss-20b',result['provider'])
        self.assertEqual([call.kwargs['model'] for call in provider.await_args_list],['custom-primary','openai/gpt-oss-20b'])

    async def test_all_rate_limited_keys_raise_instead_of_returning_none(self):
        def client():
            return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=Mock(side_effect=RuntimeError('HTTP 429 rate_limit')))))
        clients=[client(),client()]
        with patch.object(main,'_groq_clients',clients),patch.object(main,'_groq_key_index',0),patch.object(main,'_groq_disabled_until',0):
            with self.assertRaisesRegex(RuntimeError,'429'):
                await main.try_groq([],model='test')
        self.assertEqual(sum(c.chat.completions.create.call_count for c in clients),2)

    async def test_auth_failure_tries_the_backup_key(self):
        first=Mock(side_effect=RuntimeError('HTTP 401 invalid_api_key'))
        second=Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=ANSWER))]))
        clients=[SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))) for create in (first,second)]
        with patch.object(main,'_groq_clients',clients),patch.object(main,'_groq_key_index',0),patch.object(main,'_groq_disabled_until',0):
            self.assertEqual(await main.try_groq([],model='test'),ANSWER)

    async def test_ollama_uses_a_bounded_transport_and_closes_it(self):
        local=MagicMock();local.__enter__.return_value=local;local.chat.return_value={'message':{'content':ANSWER}}
        with patch.object(main.ollama,'Client',return_value=local) as factory:
            self.assertEqual(await main.try_ollama([]),ANSWER)
        factory.assert_called_once_with(timeout=main.OLLAMA_TIMEOUT_SECONDS)
        local.__exit__.assert_called_once()

    async def test_malformed_mcq_is_regenerated_and_numeric_zero_is_preserved(self):
        generate=AsyncMock(side_effect=['[{"type":"mcq","reasoning":"missing answer"}]','[{"type":"mcq","answer":0}]'])
        result=await main.generate_validated_result(generate,[],'python')
        self.assertEqual(json.loads(result)[0]['answer'],'0')
        self.assertEqual(generate.await_count,2)

    async def test_mixed_empty_and_network_failures_do_not_trigger_a_paid_vision_fallback(self):
        with patch.object(main,'TEXT_MODELS',['one','two']),patch.object(main,'_groq_disabled_until',0), \
             patch.object(main,'try_groq',AsyncMock(side_effect=['[]',RuntimeError('Network failure')])), \
             patch.object(main,'try_ollama',AsyncMock(return_value='[]')):
            with self.assertRaises(HTTPException) as error:
                await main.solve_questions(main.PageContent(text='What is 6 + 7?',url='https://example.test',practice_type='mcq'))
        self.assertEqual(error.exception.status_code,502)


class LocalApiTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.path=Path(self.folder.name)/'history.db'
        self.dbpatch=patch.object(main,'HISTORY_DB_PATH',self.path);self.dbpatch.start()
        self.keypatch=patch.object(main,'_groq_clients',[]);self.keypatch.start()
        self.client=TestClient(main.app);self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None,None,None)
        self.keypatch.stop();self.dbpatch.stop();self.folder.cleanup()

    def test_host_and_origin_guards_preserve_extension_and_loopback_requests(self):
        self.assertEqual(self.client.get('/health').status_code,200)
        self.assertEqual(self.client.get('/health',headers={'Origin':'chrome-extension://'+'a'*32}).status_code,200)
        self.assertEqual(self.client.get('/health',headers={'Origin':'http://127.0.0.1:8000'}).status_code,200)
        self.assertEqual(self.client.get('/history',headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.get('/history',headers={'Host':'evil.example'}).status_code,400)
        self.assertEqual(self.client.get('/history',headers={'Origin':'null'}).status_code,403)

    def test_database_persistence_and_sql_injection_like_text_remain_data(self):
        entry={'scan_type':'text','url':"https://example.test/'; DROP TABLE scan_history; --",'provider':'mock', 'results':ANSWER}
        saved=self.client.post('/history',json=entry);self.assertEqual(saved.status_code,201)
        rows=self.client.get('/history').json()['items'];self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['url'],entry['url'])
        main.initialize_history_database()
        self.assertEqual(len(self.client.get('/history').json()['items']),1)
        self.assertEqual(self.client.get('/history?limit=101').status_code,422)
        self.assertEqual(self.client.post('/history',json={**entry,'scan_type':'bad'}).status_code,422)

    def test_math_route_contract_and_history_retention_are_preserved(self):
        with patch.object(main,'try_groq',AsyncMock(return_value=ANSWER)):
            response=self.client.post('/solve',json={'text':'Compute 6 + 7','url':'https://example.test','practice_type':'aptitude'})
        self.assertEqual(response.status_code,200)
        self.assertEqual(json.loads(response.json()['results'])[0]['answer'],'Option C: 13')
        with main.get_history_connection() as connection:
            for n in range(100):
                connection.execute('INSERT INTO scan_history(created_at,scan_type,url,provider,results) VALUES (?,?,?,?,?)',
                    ('fixture','text',f'https://example.test/{n}','mock',ANSWER))
        response=self.client.post('/history',json={'scan_type':'text','url':'https://example.test/new','provider':'mock','results':ANSWER})
        self.assertEqual(response.status_code,201)
        rows=self.client.get('/history?limit=100').json()['items'];self.assertEqual(len(rows),100)
        self.assertEqual(rows[0]['url'],'https://example.test/new')

    def test_connection_is_closed_and_transaction_rolls_back(self):
        with main.get_history_connection() as connection:
            connection.execute('SELECT 1')
        with self.assertRaises(sqlite3.ProgrammingError):connection.execute('SELECT 1')
        with self.assertRaises(HTTPException) as error:
            with main.get_history_connection() as connection:
                connection.execute('INSERT INTO table_that_does_not_exist VALUES (1)')
        self.assertEqual(error.exception.status_code,503)
        self.assertEqual(self.client.get('/history').status_code,200)

    def test_provider_errors_redact_configured_keys_in_http_responses(self):
        secret='synthetic-private-value'
        with patch.object(main,'_groq_keys',[secret]),patch.object(main,'try_groq',AsyncMock(side_effect=RuntimeError(secret))), \
             patch.object(main,'try_ollama',AsyncMock(side_effect=RuntimeError(secret))):
            response=self.client.post('/solve',json={'text':'What is 6 + 7?','url':'https://example.test','practice_type':'mcq'})
        self.assertEqual(response.status_code,502)
        self.assertNotIn(secret,response.text)
        self.assertIn('[redacted]',response.text)
        self.assertNotIn('gsk_synthetic',redact('Authorization: Bearer gsk_synthetic'))
