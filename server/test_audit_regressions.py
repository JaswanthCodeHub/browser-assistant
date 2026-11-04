import json
import unittest
import time
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
import main


class CodingPayloadTests(unittest.IsolatedAsyncioTestCase):
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
