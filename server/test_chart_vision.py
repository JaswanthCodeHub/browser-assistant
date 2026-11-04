import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from pydantic import ValidationError
from fastapi import HTTPException
from vision_images import cross_check_visual_answers, VisionUnconfirmedError
from unittest.mock import AsyncMock
import main


class ChartVisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_chart_and_external_question_options_reach_the_vision_model_together(self):
        answer = [{'type':'mcq','question':'Combined amount?',
                   'reasoning':'4000 * (45 + 25) / 100 = 2800',
                   'answer':'Option B: Rs. 2,800'}]
        def response(payload):
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content=json.dumps(payload)))])
        create = Mock(side_effect=[response(answer), response({'readable':True,'answers':[{'id':1,'answer':'Option B: Rs. 2,800'}]})])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        question = 'Budget Rs. 4000: Rent + Entertainment?\nA. Rs. 1,400\nB. Rs. 2,800'
        with patch.object(main, 'get_groq_client', return_value=client), \
             patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', side_effect=lambda data, **kw: data.split(',',1)[-1]):
            result = await main.solve_vision(main.VisionContent(
                image='data:image/jpeg;base64,chart', images=['data:image/jpeg;base64,legend'],
                text=question, url='https://learning.ccbp.in/primitive-coding-review/practice/a/b', practice_type='mcq'))
        self.assertEqual(json.loads(result['results'])[0]['answer'], 'Option B: Rs. 2,800')
        self.assertEqual(create.call_count, 2)
        self.assertIn('[cross-checked]', result['provider'])
        messages = create.call_args_list[0].kwargs['messages']
        blocks = messages[-1]['content']
        self.assertIn(question, blocks[0]['text'])
        self.assertEqual([b['image_url']['url'] for b in blocks[1:]],
                         ['data:image/jpeg;base64,chart', 'data:image/jpeg;base64,legend'])
        self.assertIn('return [] instead of guessing', messages[0]['content'])
        check_messages = create.call_args_list[1].kwargs['messages']
        self.assertEqual(check_messages[1], messages[1])
        self.assertIn('SECOND VISUAL SOLVE', check_messages[-1]['content'])
        self.assertNotIn(answer[0]['reasoning'], str(check_messages))

    async def test_disagreement_never_returns_the_first_answer(self):
        create = Mock(side_effect=[
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps([
                {'type':'mcq','question':'Amount?','answer':'Option A: 1400'}])))]),
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps(
                {'readable':True,'answers':[{'id':1,'answer':'Option B: 2800'}]})))]),
        ])
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main,'get_groq_client',return_value=client),patch.object(main,'_groq_clients',[client]), \
             patch.object(main,'VISION_MODELS',['test-vision']),patch.object(main,'compress_image_base64',return_value='chart'):
            with self.assertRaises(HTTPException) as error:
                await main.solve_vision(main.VisionContent(image='chart',url='https://example.test',practice_type='mcq'))
        self.assertEqual(error.exception.status_code,422)
        self.assertEqual(error.exception.detail['code'],'vision_unconfirmed')
        self.assertEqual(create.call_count,2)

    async def test_unclear_missing_and_malformed_checks_do_not_become_answers(self):
        original=json.dumps([{'type':'mcq','question':'What is shown?','answer':'Option B: 8%'}])
        for raw in ['{"readable":false,"answers":[]}', '{"readable":true,"answers":[]}',
                    'Option B: 8%', '{"readable":"true","answers":[{"id":1,"answer":"Option B: 8%"}]}',
                    '{"readable":true,"answers":[{"id":2,"answer":"Option B: 8%"}]}',
                    '{"readable":true,"answers":[{"id":1,"answer":"Option B: 18%"}]}']:
            with self.subTest(raw=raw),self.assertRaises(VisionUnconfirmedError):
                await cross_check_visual_answers([],original,'test',AsyncMock(return_value=raw))

    async def test_all_visible_questions_and_multiple_answers_must_agree(self):
        original=json.dumps([{'type':'mcq','answer':'Option A: One; Option C: Three'},
                             {'type':'mcq','answer':'-4'}])
        matching=json.dumps({'readable':True,'answers':[{'id':1,'answer':'Option A: One; Option C: Three'},
                                                      {'id':2,'answer':'-4'}]})
        self.assertEqual(await cross_check_visual_answers([],original,'test',AsyncMock(return_value=matching)),original)
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_visual_answers([],original,'test',AsyncMock(return_value=matching.replace('Option C: Three','Option B: Two')))

    async def test_image_and_question_limits_are_explicit(self):
        for extra in ({'images':['x']*5}, {'text':'x'*60001}):
            with self.assertRaises(ValidationError):
                main.VisionContent(image='x',url='https://example.test',**extra)

    async def test_existing_single_screenshot_requests_remain_valid(self):
        request = main.VisionContent(image='x',url='https://example.test')
        self.assertEqual(request.images, [])
        self.assertEqual(request.text, '')
