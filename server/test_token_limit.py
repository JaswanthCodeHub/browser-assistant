import unittest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock, patch
import main


class TokenLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_review_uses_compact_json_and_retains_its_options_after_truncation(self):
        create = Mock(side_effect=[
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='length')]),
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content='{"verdict":"pass","issues":[]}'))]),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main,'get_groq_client',return_value=client),patch.object(main,'_groq_clients',[client]):
            result=await main.try_groq([],model='openai/gpt-oss-20b',_review=True,_token_limit=main.GROQ_REVIEW_TOKEN_LIMIT)
        self.assertIn('"pass"',result)
        for call in create.call_args_list:
            self.assertEqual(call.kwargs['response_format'],{'type':'json_object'})
            self.assertEqual(call.kwargs['reasoning_effort'],'low')
        self.assertEqual(create.call_args_list[-1].kwargs['max_completion_tokens'],main.GROQ_RETRY_TOKEN_LIMIT)

    async def test_generation_does_not_inherit_review_response_settings(self):
        create=Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='complete code'))]))
        client=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main,'get_groq_client',return_value=client),patch.object(main,'_groq_clients',[client]):
            await main.try_groq([],model='openai/gpt-oss-120b')
        self.assertNotIn('response_format',create.call_args.kwargs)
        self.assertNotIn('reasoning_effort',create.call_args.kwargs)

    async def test_reviewer_limit_uses_fresh_primary_review_without_losing_the_generated_code(self):
        provider=AsyncMock(side_effect=[RuntimeError('stopped at the output token limit'),'{"verdict":"pass","issues":[]}'])
        local=AsyncMock(side_effect=RuntimeError('not installed'))
        with patch.object(main,'TEXT_MODELS',['openai/gpt-oss-120b','openai/gpt-oss-20b']),patch.object(main,'try_groq',provider),patch.object(main,'try_ollama',local):
            result=await main.try_independent_code_review([],exclude_model='openai/gpt-oss-120b')
        self.assertEqual(main.parse_code_review(result)['verdict'],'pass')
        self.assertEqual([call.kwargs['model'] for call in provider.await_args_list],['openai/gpt-oss-20b','openai/gpt-oss-120b'])
        local.assert_not_awaited()

    async def test_invalid_reviewer_output_falls_back_to_another_review_instead_of_code_generation(self):
        provider=AsyncMock(side_effect=['[{"type":"code","code":"not a verdict"}]','{"verdict":"pass","issues":[]}'])
        with patch.object(main,'TEXT_MODELS',['primary','secondary']),patch.object(main,'try_groq',provider):
            result=await main.try_independent_code_review([],exclude_model='primary')
        self.assertEqual(main.parse_code_review(result)['verdict'],'pass')
        self.assertEqual(provider.await_count,2)

    def test_review_report_schema_does_not_request_an_unused_replacement_program(self):
        prompt=main.build_code_review_prompt('[]','cpp')
        self.assertIn('Do not output corrected_code',prompt)
        self.assertNotIn('"corrected_code":',prompt)
        for raw in ['{"verdict":"pass","issues":["wrong output"]}','{"verdict":"fail","issues":[]}',
                    '{"verdict":"pass","issues":"none"}']:
            with self.assertRaises(ValueError):main.parse_code_review(raw)

    async def test_retries_truncation_with_larger_budget(self):
        create = Mock(side_effect=[
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='length', message=SimpleNamespace(content='partial'))]),
            SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop', message=SimpleNamespace(content='complete'))]),
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, 'get_groq_client', return_value=client), patch.object(main, '_groq_clients', [client]):
            self.assertEqual(await main.try_groq([], model='test'), 'complete')
        self.assertEqual(
            [call.kwargs['max_completion_tokens'] for call in create.call_args_list],
            [main.GROQ_COMPLETION_TOKEN_LIMIT, main.GROQ_RETRY_TOKEN_LIMIT],
        )

    async def test_repeated_truncation_fails_without_returning_partial_code(self):
        create = Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason='length')]))
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        with patch.object(main, 'get_groq_client', return_value=client), patch.object(main, '_groq_clients', [client]):
            with self.assertRaisesRegex(RuntimeError, 'output token limit'):
                await main.try_groq([], model='test')
        self.assertEqual(create.call_count, 2)
