import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from groq import APIStatusError
from httpx import Request, Response
from fastapi import HTTPException
import main


class VisionPayloadTests(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, always_fail):
        oversized = APIStatusError('Request too large', response=Response(413,
            request=Request('POST', 'https://example.test')), body=None)
        completion = SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',
            message=SimpleNamespace(content='[{"type":"mcq","answer":"4"}]'))])
        create = Mock(side_effect=oversized if always_fail else [oversized, completion])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        request = main.VisionContent(image='fixture', text='Read the number.', url='https://example.test')
        with patch.object(main, '_groq_clients', [client]), patch.object(main, 'VISION_MODELS', ['fixture']), \
             patch.object(main, '_vision_key_cooldowns', {}), \
             patch.object(main, 'compress_image_base64', side_effect=lambda value, **kw: str(kw['max_dim'])), \
             patch.object(main, 'cross_check_visual_answers', side_effect=lambda messages, result, *args, **kwargs: result):
            if always_fail:
                with self.assertRaises(HTTPException) as caught:
                    await main.solve_vision(request)
                self.assertEqual(caught.exception.status_code, 413)
                self.assertEqual(caught.exception.detail['code'], 'vision_request_too_large')
                self.assertEqual(create.call_count, 3)
            else:
                result = await main.solve_vision(request)
                self.assertIn('4', result['results'])
                self.assertEqual(create.call_count, 2)
                first = create.call_args_list[0].kwargs['messages']
                second = create.call_args_list[1].kwargs['messages']
                self.assertEqual(first[0], second[0])
                self.assertEqual(first[1]['content'][0], second[1]['content'][0])
                self.assertNotEqual(first[1]['content'][1], second[1]['content'][1])

    async def test_resize_recovers_without_dropping_text_or_images(self):
        await self.exercise(False)

    async def test_persistent_oversize_returns_non_retryable_413(self):
        await self.exercise(True)
