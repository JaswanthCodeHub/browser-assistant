import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from pydantic import ValidationError
from fastapi import HTTPException
from groq import RateLimitError
from httpx import Request, Response
from vision_images import cross_check_visual_answers, VisionUnconfirmedError
from unittest.mock import AsyncMock
import main


def provider_response(payload):
    return SimpleNamespace(choices=[SimpleNamespace(
        finish_reason='stop', message=SimpleNamespace(content=json.dumps(payload)))])


def rate_limit(message, headers):
    response = Response(429, headers=headers, request=Request('POST', 'https://example.test'))
    return RateLimitError(message, response=response, body=None)


class ChartVisionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(patch.object(main, '_vision_key_cooldowns', {}))
        self.enterContext(patch.object(main, '_groq_key_index', 0))

    async def test_percentage_spacing_does_not_create_a_visual_disagreement(self):
        original = json.dumps([{'type': 'mcq', 'answer': 'B. 16.67 %'}])
        verdict = {'readable': True, 'answers': [{'id': 1, 'answer': 'Option B: 16.67%'}]}
        complete = AsyncMock(return_value=json.dumps(verdict))
        self.assertEqual(await cross_check_visual_answers([], original, 'test', complete), original)
        complete.assert_awaited_once()

    async def test_rate_limit_during_verification_retries_only_that_step(self):
        answer = [{'type': 'mcq', 'question': 'How many girls are enrolled?', 'answer': 'Option D: 480'}]
        verdict = {'readable': True, 'answers': [{'id': 1, 'answer': 'Option D: 480'}]}
        create = Mock(side_effect=[
            provider_response(answer),
            rate_limit('Rate limit reached. Please try again in 3.968571428s.', {'Retry-After': '3'}),
            provider_response(verdict),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, 'get_groq_client', return_value=client), \
             patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', return_value='chart'), \
             patch.object(main.asyncio, 'sleep', new_callable=AsyncMock) as sleep, \
             patch.object(main, 'rotate_groq_key') as rotate:
            result = await main.solve_vision(main.VisionContent(
                image='chart', url='https://example.test', practice_type='mcq'))
        self.assertEqual(json.loads(result['results']), answer)
        self.assertEqual(create.call_count, 3)
        self.assertEqual(create.call_args_list[1], create.call_args_list[2])
        sleep.assert_awaited_once()
        self.assertAlmostEqual(sleep.await_args.args[0], 3.968571428, delta=0.1)
        rotate.assert_not_called()

    async def test_rate_limited_key_is_skipped_during_verification_and_next_question(self):
        answer = [{'type': 'mcq', 'question': 'How many girls are enrolled?', 'answer': 'Option D: 480'}]
        verdict = {'readable': True, 'answers': [{'id': 1, 'answer': 'Option D: 480'}]}
        primary = Mock(side_effect=[provider_response(answer), rate_limit('Rate limit reached', {'Retry-After': '23'})])
        backup = Mock(side_effect=[provider_response(verdict), provider_response(answer), provider_response(verdict)])
        clients = [SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
                   for create in (primary, backup)]
        with patch.object(main, '_groq_clients', clients), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', return_value='chart'), \
             patch.object(main.asyncio, 'sleep', new_callable=AsyncMock) as sleep:
            question = main.VisionContent(image='chart', url='https://example.test', practice_type='mcq')
            for _ in range(2):
                result = await main.solve_vision(question)
                self.assertEqual(json.loads(result['results']), answer)
        self.assertEqual(primary.call_count, 2)
        self.assertEqual(backup.call_count, 3)
        self.assertEqual(primary.call_args_list[1], backup.call_args_list[0])
        sleep.assert_not_awaited()

    async def test_long_rate_limit_survives_batching_without_a_generic_gateway_error(self):
        create = Mock(side_effect=rate_limit('Provider organization details', {'Retry-After': '120'}))
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, 'get_groq_client', return_value=client), \
             patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', side_effect=lambda image, **_: image), \
             patch.object(main.asyncio, 'sleep', new_callable=AsyncMock) as sleep, \
             self.assertRaises(HTTPException) as error:
            await main.solve_vision(main.VisionContent(
                image='chart', images=['legend', 'axis', 'table'], url='https://example.test', practice_type='mcq'))
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(error.exception.headers, {'Retry-After': '120'})
        self.assertEqual(error.exception.detail['retry_after_seconds'], 120)
        self.assertNotIn('organization', str(error.exception.detail))
        create.assert_called_once()
        sleep.assert_not_awaited()

    async def test_chart_and_external_question_options_reach_the_vision_model_together(self):
        answer = [{'type':'mcq','question':'Combined amount?',
                   'reasoning':'4000 * (45 + 25) / 100 = 2800',
                   'answer':'B. Rs. 2,800'}]
        def response(payload):
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content=json.dumps(payload)))])
        create = Mock(side_effect=[response(answer), response({'readable':True,'answers':[{'id':1,'answer':'Option B: Rs. 2,800'}]})])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        question = 'Budget Rs. 4000: Rent + Entertainment?\nA. Rs. 1,400\nB. Rs. 2,800'
        with patch.object(main, 'get_groq_client', return_value=client), \
             patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['qwen/qwen3.8-27b']), \
             patch.object(main, 'compress_image_base64', side_effect=lambda data, **kw: data.split(',',1)[-1]):
            result = await main.solve_vision(main.VisionContent(
                image='data:image/jpeg;base64,chart', images=['data:image/jpeg;base64,legend'],
                text=question, url='https://learning.ccbp.in/primitive-coding-review/practice/a/b', practice_type='mcq'))
        self.assertEqual(json.loads(result['results'])[0]['answer'], 'B. Rs. 2,800')
        self.assertEqual(create.call_count, 2)
        self.assertIn('[cross-checked]', result['provider'])
        messages = create.call_args_list[0].kwargs['messages']
        blocks = messages[-1]['content']
        self.assertIn(question, blocks[0]['text'])
        self.assertEqual([b['image_url']['url'] for b in blocks[1:]],
                         ['data:image/jpeg;base64,chart', 'data:image/jpeg;base64,legend'])
        self.assertIn('return [] instead of guessing', messages[0]['content'])
        check_messages = create.call_args_list[1].kwargs['messages']
        self.assertEqual(create.call_args_list[1].kwargs['response_format'], {'type': 'json_object'})
        self.assertNotIn('response_format', create.call_args_list[0].kwargs)
        self.assertEqual(check_messages[1], messages[1])
        self.assertIn('SECOND VISUAL SOLVE', check_messages[0]['content'])
        self.assertIn('legend marker', check_messages[0]['content'])
        self.assertNotIn('generate code', blocks[0]['text'])
        self.assertNotIn(answer[0]['reasoning'], str(check_messages))

    async def test_three_different_answers_fail_closed(self):
        create = Mock(side_effect=[
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps([
                {'type':'mcq','question':'Amount?','answer':'Option A: 1400'}])))]),
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps(
                {'readable':True,'answers':[{'id':1,'answer':'Option B: 2800'}]})))]),
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content=json.dumps(
                {'readable':True,'answers':[{'id':1,'answer':'Option C: 3000'}]})))]),
        ])
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main,'get_groq_client',return_value=client),patch.object(main,'_groq_clients',[client]), \
             patch.object(main,'VISION_MODELS',['test-vision']),patch.object(main,'compress_image_base64',return_value='chart'):
            with self.assertRaises(HTTPException) as error:
                await main.solve_vision(main.VisionContent(image='chart',url='https://example.test',practice_type='mcq'))
        self.assertEqual(error.exception.status_code,422)
        self.assertEqual(error.exception.detail['code'],'vision_unconfirmed')
        self.assertEqual(create.call_count,3)

    async def test_malformed_check_is_retried_from_the_original_evidence(self):
        original = json.dumps([{'type': 'mcq', 'answer': 'Option C: 320 cr'}])
        match = '{"readable":true,"answers":[{"id":1,"answer":"C. 320 cr"}]}'
        complete = AsyncMock(side_effect=['', '<think>Visual work</think>\n```JSON\n' + match + '\n```'])
        self.assertEqual(await cross_check_visual_answers([], original, 'test', complete), original)
        self.assertEqual(complete.await_count, 2)

    async def test_two_blind_checks_can_correct_the_initial_answer(self):
        original = json.dumps([{'type': 'mcq', 'answer': 'Option B: 316 cr', 'reasoning': 'Old calculation'}])
        match = '{"readable":true,"answers":[{"id":1,"answer":"Option C: 320 cr","reasoning":"368 / 1.15 = 320"}]}'
        complete = AsyncMock(return_value=match)
        result = await cross_check_visual_answers([], original, 'test', complete)
        self.assertEqual(json.loads(result)[0]['answer'], 'Option C: 320 cr')
        self.assertEqual(json.loads(result)[0]['reasoning'], '368 / 1.15 = 320')
        self.assertNotIn('316 cr', str(complete.await_args_list))

    async def test_unclear_missing_and_malformed_checks_do_not_become_answers(self):
        original=json.dumps([{'type':'mcq','question':'What is shown?','answer':'Option B: 8%'}])
        for raw in ['{"readable":false,"answers":[]}', '{"readable":true,"answers":[]}',
                    'Option B: 8%', '{"readable":"true","answers":[{"id":1,"answer":"Option B: 8%"}]}',
                    '{"readable":true,"answers":[{"id":2,"answer":"Option B: 8%"}]}',
                    '{"readable":true,"answers":[{"id":true,"answer":"Option B: 8%"}]}']:
            with self.subTest(raw=raw),self.assertRaises(VisionUnconfirmedError):
                await cross_check_visual_answers([],original,'test',AsyncMock(return_value=raw))

    async def test_all_visible_questions_and_multiple_answers_must_agree(self):
        original=json.dumps([{'type':'mcq','answer':'Option A: One; Option C: Three'},
                             {'type':'mcq','answer':'-4'}])
        matching=json.dumps({'readable':True,'answers':[{'id':1,'answer':'Option A: One; Option C: Three'},
                                                      {'id':2,'answer':'-4'}]})
        self.assertEqual(await cross_check_visual_answers([],original,'test',AsyncMock(return_value=matching)),original)
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_visual_answers([],original,'test',AsyncMock(side_effect=[
                matching.replace('Option C: Three','Option B: Two'),
                matching.replace('Option C: Three','Option D: Four'),
            ]))

    async def test_image_and_question_limits_are_explicit(self):
        for extra in ({'images':['x']*5}, {'text':'x'*60001}):
            with self.assertRaises(ValidationError):
                main.VisionContent(image='x',url='https://example.test',**extra)

    async def test_existing_single_screenshot_requests_remain_valid(self):
        request = main.VisionContent(image='x',url='https://example.test')
        self.assertEqual(request.images, [])
        self.assertEqual(request.text, '')
