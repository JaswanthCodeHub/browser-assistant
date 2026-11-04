import json
import unittest
from unittest.mock import AsyncMock

from vision_images import cross_check_text_answers, cross_check_visual_answers, VisionUnconfirmedError


class MatrixVerificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.messages = [
            {'role': 'system', 'content': 'Solve.'},
            {'role': 'user', 'content': r'Find the inverse of $\begin{bmatrix}2&1\\5&3\end{bmatrix}$.'},
        ]
        self.results = json.dumps([{
            'type': 'mcq', 'answer': r'Option B: $\begin{bmatrix}3&-1\\-5&2\end{bmatrix}$',
        }])

    def response(self, answer):
        return json.dumps({'readable': True, 'answers': [{'id': 1, 'answer': answer}]})

    async def test_text_retries_incomplete_check_and_accepts_equivalent_matrix(self):
        complete = AsyncMock(side_effect=['{}', self.response('B. [[3, −1], [-5, 2]]')])
        await cross_check_text_answers(self.messages, self.results, complete)
        self.assertEqual(complete.await_count, 2)
        self.assertNotIn('Option B:', complete.await_args.args[0][-1]['content'])

    async def test_vision_accepts_equivalent_matrix_but_rejects_different_order(self):
        complete = AsyncMock(return_value=self.response('B. [[3,-1],[-5,2]]'))
        self.assertEqual(await cross_check_visual_answers(
            self.messages, self.results, 'test', complete, require_agreement=True), self.results)
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_visual_answers(
                self.messages, self.results, 'test',
                AsyncMock(return_value=self.response('B. [[3,-5],[-1,2]]')), require_agreement=True)

    async def test_text_stops_when_both_checks_are_incomplete(self):
        complete = AsyncMock(return_value='{}')
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_text_answers(self.messages, self.results, complete)
        self.assertEqual(complete.await_count, 2)
