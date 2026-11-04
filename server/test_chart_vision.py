import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from pydantic import ValidationError
from fastapi import HTTPException
from groq import RateLimitError
from httpx import Request, Response
from vision_images import cross_check_visual_answers, relative_percentage_question, VisionUnconfirmedError
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

    async def test_relative_percentage_is_calculated_from_agreed_chart_values(self):
        text = ('By how much amount the formatting of the book is a lesser amount for editing the book?\n'
                'Question format: select one answer.\nA. 20 %\nB. 16.67 %\nC. 13.33 %\nD. 22.56 %')
        evidence = {'comparison': {'target': '25', 'base': '30'}, 'answer': 'Option A: 20 %'}
        create = Mock(side_effect=[
            provider_response([{'type': 'mcq', **evidence}]),
            provider_response({'readable': True, 'answers': [{'id': 1, **evidence}]}),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', return_value='chart'):
            result = await main.solve_vision(main.VisionContent(
                image='chart', url='https://example.test', text=text, practice_type='mcq'))
        item = json.loads(result['results'])[0]
        self.assertEqual(item['answer'], 'Option B: 16.67 %')
        self.assertIn('÷ 30', item['reasoning'])
        self.assertEqual(create.call_count, 2)
        for call in create.call_args_list:
            self.assertIn('"comparison"', call.kwargs['messages'][0]['content'])

    async def test_matching_percentage_does_not_confirm_conflicting_chart_values(self):
        text = 'By what percentage is A less than B?\nA. 20%\nB. 16.67%'
        comparison = relative_percentage_question(text)
        self.assertIsNotNone(comparison)
        first = {'type': 'mcq', 'answer': 'Option B: 16.67%', 'comparison': {'target': '25', 'base': '30'}}
        def check(target, base):
            return json.dumps({'readable': True, 'answers': [{
                'id': 1, 'answer': 'Option B: 16.67%', 'comparison': {'target': target, 'base': base},
            }]})
        complete = AsyncMock(side_effect=[check('50', '60'), check('75', '90')])
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_visual_answers([], json.dumps([first]), 'test-vision', complete, comparison)

    async def test_strict_vision_modes_withhold_disagreeing_answers(self):
        for mode in ('auto', 'mcq', 'math', 'aptitude'):
            with self.subTest(mode=mode):
                create = Mock(side_effect=[
                    provider_response([{'type': 'mcq', 'answer': 'Option A: 12'}]),
                    provider_response({'readable': True, 'answers': [{'id': 1, 'answer': 'Option B: 13'}]}),
                ])
                client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
                with patch.object(main, '_groq_clients', [client]), \
                     patch.object(main, 'VISION_MODELS', ['test-vision']), \
                     patch.object(main, 'compress_image_base64', return_value='chart'), \
                     self.assertRaises(HTTPException) as error:
                    await main.solve_vision(main.VisionContent(
                        image='chart', url='https://example.test', practice_type=mode, verify_answer=True))
                self.assertEqual(error.exception.status_code, 422)
                self.assertIn('two visual solves disagreed', str(error.exception.detail))
                self.assertEqual(create.call_count, 2)

    async def test_strict_vision_code_reviewer_receives_the_original_screenshot(self):
        solution = {'type': 'code', 'language': 'python', 'code': 'print(1)',
                    'approach': 'Print the constant.', 'time_complexity': 'O(1)', 'space_complexity': 'O(1)'}
        create = Mock(side_effect=[
            provider_response([solution]), provider_response({'verdict': 'pass', 'issues': []}),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', return_value='original'):
            result = await main.solve_vision(main.VisionContent(
                image='original', url='https://example.test', practice_type='code', language='python', verify_answer=True))
        self.assertTrue(result['code_reviewed'])
        review_blocks = create.call_args_list[1].kwargs['messages'][1]['content']
        self.assertEqual(review_blocks[1], create.call_args_list[0].kwargs['messages'][1]['content'][1])
        self.assertIn('Fail the review if required instructions', review_blocks[0]['text'])

    async def test_percentage_spacing_does_not_create_a_visual_disagreement(self):
        original = json.dumps([{'type': 'mcq', 'answer': 'B. 16.67 %'}])
        verdict = {'readable': True, 'answers': [{'id': 1, 'answer': 'Option B: 16.67%'}]}
        complete = AsyncMock(return_value=json.dumps(verdict))
        self.assertEqual(await cross_check_visual_answers([], original, 'test', complete), original)
        complete.assert_awaited_once()

    async def test_short_rate_limit_is_reported_without_waiting_or_reusing_the_key(self):
        answer = [{'type': 'mcq', 'question': 'How many girls are enrolled?', 'answer': 'Option D: 480'}]
        create = Mock(side_effect=[
            provider_response(answer),
            rate_limit('Rate limit reached. Please try again in 3.968571428s.', {'Retry-After': '3'}),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, '_groq_clients', [client]), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', return_value='chart'), \
             patch.object(main.asyncio, 'sleep', new_callable=AsyncMock) as sleep:
            question = main.VisionContent(image='chart', url='https://example.test', practice_type='mcq')
            with self.assertRaises(HTTPException) as error:
                await main.solve_vision(question)
            self.assertEqual(error.exception.status_code, 429)
            self.assertEqual(error.exception.detail['retry_after_seconds'], 4)
            with self.assertRaises(HTTPException) as next_question:
                await main.solve_vision(question)
            self.assertEqual(next_question.exception.status_code, 429)
        self.assertEqual(create.call_count, 2)
        sleep.assert_not_awaited()

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

    async def test_all_rate_limited_keys_report_the_earliest_retry_time_during_batching(self):
        creates = [Mock(side_effect=rate_limit('Provider organization details', {'Retry-After': str(delay)}))
                   for delay in (120, 23, 45)]
        clients = [SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
                   for create in creates]
        with patch.object(main, '_groq_clients', clients), \
             patch.object(main, 'VISION_MODELS', ['test-vision']), \
             patch.object(main, 'compress_image_base64', side_effect=lambda image, **_: image), \
             patch.object(main.asyncio, 'sleep', new_callable=AsyncMock) as sleep, \
             self.assertRaises(HTTPException) as error:
            await main.solve_vision(main.VisionContent(
                image='chart', images=['legend', 'axis', 'table'], url='https://example.test', practice_type='mcq'))
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(error.exception.headers, {'Retry-After': '23'})
        self.assertEqual(error.exception.detail['retry_after_seconds'], 23)
        self.assertNotIn('organization', str(error.exception.detail))
        for create in creates:
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
