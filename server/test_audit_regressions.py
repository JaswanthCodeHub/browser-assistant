import json
import unittest
import time
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main


class CodingPayloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_text_verification_uses_original_evidence_and_a_different_model(self):
        first = json.dumps([{'type': 'mcq', 'answer': 'Option B: 12%', 'reasoning': 'FIRST_SOLVE_PRIVATE'}])
        second = json.dumps({'readable': True, 'answers': [{'id': 1, 'answer': 'B. 12 %'}]})
        provider = AsyncMock(side_effect=[first, second])
        request = main.PageContent(
            text='What is 6 as a percentage of 50?\nA. 10%\nB. 12%', url='http://localhost/test',
            practice_type='mcq', verify_answer=True,
        )
        with patch.object(main, 'try_groq', provider), patch.object(main, 'TEXT_MODELS', ['solver', 'checker']):
            result = await main.solve_questions(request)
        self.assertTrue(result['answer_verified'])
        self.assertEqual([call.kwargs['model'] for call in provider.await_args_list], ['solver', 'checker'])
        check_messages = provider.await_args_list[1].args[0]
        self.assertIn(request.text, check_messages[1]['content'])
        self.assertNotIn('FIRST_SOLVE_PRIVATE', str(check_messages))

    async def test_disagreement_stops_text_answer_without_using_a_fallback_answer(self):
        first = json.dumps([{'type': 'mcq', 'answer': 'Hello'}])
        second = json.dumps({'readable': True, 'answers': [{'id': 1, 'answer': 'hello'}]})
        provider = AsyncMock(side_effect=[first, second])
        request = main.PageContent(text='What does print("Hello") output?', url='http://localhost/test',
                                   practice_type='mcq', verify_answer=True)
        with patch.object(main, 'try_groq', provider), patch.object(main, 'try_ollama', AsyncMock()) as local:
            with self.assertRaises(HTTPException) as error:
                await main.solve_questions(request)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(error.exception.detail['code'], 'answer_unconfirmed')
        self.assertNotIn('results', error.exception.detail)
        self.assertEqual(provider.await_count, 2)
        local.assert_not_awaited()

    async def test_local_text_answers_also_require_agreement_on_the_full_order(self):
        first = json.dumps([{'type': 'mcq', 'answer': [2, 1, 3]}])
        second = json.dumps({'readable': True, 'answers': [{'id': 1, 'answer': [2, 1, 3]}]})
        local = AsyncMock(side_effect=[first, second])
        request = main.PageContent(text='Reorder ALL items.\n1. End loop\n2. Start loop\n3. Return value',
                                   url='http://localhost/test', practice_type='mcq', verify_answer=True)
        with patch.object(main, 'TEXT_MODELS', []), patch.object(main, 'try_ollama', local):
            result = await main.solve_questions(request)
        self.assertTrue(result['answer_verified'])
        self.assertEqual(json.loads(json.loads(result['results'])[0]['answer']), [2, 1, 3])
        self.assertEqual(local.await_count, 2)

    async def test_long_mcq_keeps_response_and_options_after_12000_characters(self):
        generate = AsyncMock(return_value=json.dumps([{'type':'mcq','answer':'Option B: Updated'}]))
        request = main.PageContent(text='Read the full source.\n' + 'x' * 13000 + '\nresponse.send("MCQ_TAIL_SENTINEL");\nA. Error\nB. Updated',url='https://learning.ccbp.in/primitive-coding/practice/test',practice_type='mcq')
        with patch.object(main,'generate_validated_result',generate):
            await main.solve_questions(request)
        self.assertIn('MCQ_TAIL_SENTINEL',str(generate.call_args.args[1]))

    async def test_groq_access_denial_enables_local_fallback_cooldown(self):
        client = type('Client', (), {
            'chat': type('Chat', (), {
                'completions': type('Completions', (), {
                    'create': staticmethod(lambda **_kwargs: (_ for _ in ()).throw(RuntimeError('HTTP 403 Access denied'))),
                })(),
            })(),
        })()
        previous = main._groq_disabled_until
        try:
            main._groq_disabled_until = 0
            with patch.object(main, 'get_groq_client', return_value=client), patch.object(main, '_groq_clients', [client]):
                with self.assertRaisesRegex(RuntimeError, '403'):
                    await main.try_groq([], model='test')
            self.assertGreater(main._groq_disabled_until, time.monotonic())
            with self.assertRaisesRegex(RuntimeError, 'temporarily disabled'):
                await main.try_groq([], model='test')
        finally:
            main._groq_disabled_until = previous

    async def test_empty_and_mcq_code_responses_are_repaired_with_explicit_schema(self):
        for invalid in ('[]', '[{"type":"mcq","answer":"Option A: 1"}]'):
            solution = json.dumps([{'type': 'code', 'language': 'python', 'code': 'print(1)', 'approach': 'Print the constant.', 'time_complexity': 'O(1)', 'space_complexity': 'O(1)'}])
            generator = AsyncMock(side_effect=[invalid, solution])
            with patch.object(main, 'review_and_correct_code', AsyncMock(return_value=solution)):
                result = await main.generate_validated_result(generator, [], 'python', require_code=True)
            self.assertEqual(json.loads(result)[0]['type'], 'code')
            self.assertEqual(generator.call_count, 2)
            self.assertIn('Required schema', generator.call_args.args[0][-1]['content'])

    def test_code_prompt_does_not_require_mcq_output(self):
        prompt = main.build_system_prompt('code', 'python')
        self.assertNotIn('FOR MCQ QUESTIONS:', prompt)
        self.assertNotIn('"type": "mcq"', prompt)
        self.assertIn('"type": "code"', prompt)

    async def test_repair_feedback_after_12000_characters_is_preserved(self):
        generate = AsyncMock(return_value=json.dumps([{'type': 'code', 'code': 'print(0)'}]))
        request = main.PageContent(text='Write Python code. ' + 'x' * 13000 + '\nExpected output: AUDIT_SENTINEL', url='http://localhost/test', practice_type='code', language='python')
        with patch.object(main, 'generate_validated_result', generate):
            await main.solve_questions(request)
        self.assertIn('AUDIT_SENTINEL', str(generate.call_args.args[1]))

    async def test_oversized_code_request_rejected_before_provider_call(self):
        generate = AsyncMock()
        with patch.object(main, 'generate_validated_result', generate):
            with self.assertRaises(HTTPException) as error:
                await main.solve_questions(main.PageContent(text='x' * 60001, url='http://localhost/test', practice_type='code'))
        self.assertEqual(error.exception.status_code, 422)
        generate.assert_not_called()
