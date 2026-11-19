import json
from itertools import permutations
import unittest
from unittest.mock import AsyncMock, patch

import main
from vision_images import (
    cross_check_text_answers, cross_check_visual_answers, solve_matrix_choice,
    ordering_question, solve_relu_parallel_choice, solve_stack_pop_order, solve_stack_push_order,
    solve_next_greater_element_order, VisionUnconfirmedError,
)


INVERSE = r'For $A=\begin{bmatrix}2&1\\5&3\end{bmatrix}$, what is $A^{-1}$ computed using the adjugate method?'
INVERSE_ANSWER = r'$\begin{bmatrix}3&-1\\-5&2\end{bmatrix}$'
PRODUCT = 'For matrices $A$ with shape $(m, n)$ and $B$ with shape $(p, q)$, which condition must hold for the product $AB$ to be defined?'
PRODUCT_OPTIONS = '\nA. $m = q$\nB. $n = q$\nC. $m = p$\nD. $n = p$'
PIVOTS = 'How many pivots does the following RREF matrix have? '
PIVOT_OPTIONS = '\nA. 1\nB. 2\nC. 3\nD. 0'


class MatrixChoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_relu_tensor_parallelism_matches_the_displayed_option_order(self):
        prompt = ('An MLP has a ReLU between two matrix multiplications. Why does Tensor Parallelism still work here?'
                  '\nQuestion format: select one answer.\n')
        correct = 'ReLU works element by element, so shards apply it.'
        distractors = [
            'ReLU is applied after the shard outputs are joined.',
            'ReLU is replaced by a linear function in the setup.',
            'ReLU is computed once and then shared between GPUs.',
        ]
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for position in range(4):
                choices = distractors.copy()
                choices.insert(position, correct)
                labels = 'ABCD'
                text = prompt + '\n'.join(f'{label}. {option}' for label, option in zip(labels, choices))
                result = await main.solve_questions(main.PageContent(
                    text=text, url='https://example.test', practice_type='mcq', verify_answer=True))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'], f'Option {labels[position]}: {correct}')
            groq.assert_not_awaited()
            ollama.assert_not_awaited()
        self.assertIsNone(solve_relu_parallel_choice(text.replace(distractors[0], correct)))

    async def test_row_parallel_question_uses_inner_dimension_without_a_model(self):
        question = ('In Row Parallelism, why must the input also be split, not just the weights?\n'
                    'Question format: select one answer.\n'
                    'A. So that each GPU receives a smaller batch share.\n'
                    'B. So that the input shape matches the weight rows.\n'
                    'C. So that the output no longer needs combining.\n'
                    'D. So that each GPU can use a different optimizer.')
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            result = await main.solve_questions(main.PageContent(
                text=question, url='https://example.test', practice_type='mcq', verify_answer=True))
            self.assertTrue(result['answer_verified'])
            self.assertEqual(json.loads(result['results'])[0]['answer'], 'Option B: So that the input shape matches the weight rows.')
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_automation_calculates_both_questions_without_a_provider(self):
        inverse_options = '\n'.join((
            '', f'A. {INVERSE_ANSWER}', r'B. $\begin{bmatrix}3&1\\5&2\end{bmatrix}$',
            r'C. $\begin{bmatrix}-3&1\\5&-2\end{bmatrix}$', r'D. $\begin{bmatrix}2&-1\\-5&3\end{bmatrix}$',
        ))
        cases = (
            ('16of 20 questions1 Mark' + INVERSE, inverse_options, f'Option A: {INVERSE_ANSWER}'),
            ('9of 20 questions1 Mark' + PRODUCT, PRODUCT_OPTIONS, 'Option D: $n = p$'),
            (PIVOTS + '[[1,0,2],[0,1,-1],[0,0,0]]', PIVOT_OPTIONS, 'Option B: 2'),
        )
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for question, options, expected in cases:
                result = await main.solve_questions(main.PageContent(
                    text=question + '\nQuestion format: select one answer.' + options,
                    url='https://example.test', practice_type='mcq', verify_answer=True,
                ))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'], expected)
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_vision_uses_complete_dom_math_without_a_vision_provider(self):
        with patch.object(main, '_groq_clients', []), patch.object(main, 'compress_image_base64', return_value='chart'):
            cases = (
                (PRODUCT, PRODUCT_OPTIONS, 'Option D: $n = p$'),
                (PIVOTS + r'$\begin{bmatrix}1&0&2\\0&1&−1\\0&0&0\end{bmatrix}$', PIVOT_OPTIONS, 'Option B: 2'),
            )
            for question, options, expected in cases:
                result = await main.solve_vision(main.VisionContent(
                    image='chart', text=question + '\nSelect one answer.' + options,
                    url='https://example.test', practice_type='mcq', verify_answer=True,
                ))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'], expected)

    def test_rref_pivot_count_for_rectangular_and_zero_matrices(self):
        self.assertEqual(solve_matrix_choice(PIVOTS + '[[0,1,3,0],[0,0,0,1]]' + PIVOT_OPTIONS)['answer'], 'Option B: 2')
        self.assertEqual(solve_matrix_choice(PIVOTS + '[[0,0],[0,0]]' + PIVOT_OPTIONS)['answer'], 'Option D: 0')

    def test_fractional_inverse_and_reversed_product(self):
        inverse = INVERSE.replace(r'2&1\\5&3', r'2&0\\0&4')
        answer = r'$\begin{bmatrix}\frac{1}{2}&0\\0&0.25\end{bmatrix}$'
        options = '\nA. [[2,0],[0,4]]\nB. ' + answer
        self.assertEqual(solve_matrix_choice(inverse + options)['answer'], f'Option B: {answer}')
        reversed_product = PRODUCT.replace('$AB$', '$BA$')
        self.assertEqual(solve_matrix_choice(reversed_product + PRODUCT_OPTIONS)['answer'], 'Option A: $m = q$')

    def test_incomplete_ambiguous_or_unsupported_questions_fall_back(self):
        cases = (
            PRODUCT + PRODUCT_OPTIONS.replace('$m = p$', '$p = n$'),
            PRODUCT + PRODUCT_OPTIONS.replace('C. ', 'E. '),
            PRODUCT + PRODUCT_OPTIONS.replace('$n = p$', '$n = n$'),
            PRODUCT + '\nSelect ALL correct options.' + PRODUCT_OPTIONS,
            PRODUCT + '\nComplete code snippets:\nnot part of the question' + PRODUCT_OPTIONS,
            INVERSE.replace(r'2&1\\5&3', r'2&1\\4&2') + '\nA. ' + INVERSE_ANSWER + '\nB. [[2,0],[0,4]]',
            PIVOTS + '[[1,1],[0,1]]' + PIVOT_OPTIONS,
            PIVOTS + '[[0,0],[0,1]]' + PIVOT_OPTIONS,
            PIVOTS + '[[1,0],[0,1]]' + PIVOT_OPTIONS.replace('C. 3', 'C. 2'),
        )
        for text in cases:
            with self.subTest(text=text):
                self.assertIsNone(solve_matrix_choice(text))


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

    async def test_text_falls_back_when_both_checks_are_incomplete(self):
        complete = AsyncMock(return_value='{}')
        # When both independent verifications return unparseable JSON, the
        # primary answer is delivered instead of blocking with a 422 error.
        result = await cross_check_text_answers(self.messages, self.results, complete)
        self.assertEqual(result, self.results)
        self.assertEqual(complete.await_count, 2)

    async def test_linked_blank_requires_agreement_on_one_displayed_choice(self):
        text = ('The phone began to (1) ____.\n\nWhich word best fits blank (1)?\n'
                'Question format: select one answer.\nA. ring\nB. red\nC. chair')
        results = json.dumps([{'type': 'mcq', 'answer': 'Option A: ring'}])
        agree = AsyncMock(return_value=self.response('ring'))
        checked = await cross_check_text_answers([], results, agree, question_text=text, require_agreement=True)
        self.assertEqual(json.loads(checked)[0]['answer'], 'Option A: ring')

        for checks in [['{}', '{}'], [self.response('Option B: red'), self.response('Option C: chair')]]:
            with self.subTest(checks=checks), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], results, AsyncMock(side_effect=checks),
                                               question_text=text, require_agreement=True)

    async def test_displayed_choice_agreement_uses_original_option_text(self):
        text = ('Which condition identifies a full traversal of a circular linked list?\n'
                'Question format: select one answer.\nA. current == head after the first visit\n'
                'B. current->next == nullptr\nC. current->next == head immediately\nD. current == nullptr')
        initial = {'type': 'mcq', 'answer': 'Option A', 'reasoning': 'Same node reached again.'}
        complete = AsyncMock(return_value=self.response('current == head after the first visit'))
        result = await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)
        self.assertEqual(json.loads(result)[0]['answer'], 'Option A: current == head after the first visit')
        complete.assert_awaited_once()

        initial.update(answer='Option C: current->next == head immediately')
        complete = AsyncMock(side_effect=[self.response('Option A'), self.response('A. current == head after the first visit')])
        result = await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)
        self.assertEqual(json.loads(result), [{'type': 'mcq', 'answer': 'Option A: current == head after the first visit'}])
        self.assertEqual(complete.await_count, 2)

        complete = AsyncMock(side_effect=[self.response('Option A'), self.response('Option B: current == head after the first visit')])
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_text_answers([], json.dumps([initial]), complete, question_text=text)

    async def test_complexity_answer_preserves_the_displayed_option_after_verification(self):
        text = 'How long does merging take?\nQuestion format: select one answer.\nA. O(N log M)\nB. \x60O(N + M)\x60'
        primary = json.dumps([{'type': 'mcq', 'answer': 'Option B: O(N+M)'}])
        verified = AsyncMock(return_value=self.response('O(N + M)'))
        result = await cross_check_text_answers([], primary, verified, question_text=text)
        self.assertEqual(json.loads(result)[0]['answer'], 'Option B: \x60O(N + M)\x60')
        with self.assertRaises(VisionUnconfirmedError):
            await cross_check_text_answers([], primary, AsyncMock(side_effect=[self.response('O(N log M)'), self.response('O(N*M)')]),
                                           question_text=text, require_agreement=True)

    async def test_sorted_merge_steps_are_solved_locally_in_displayed_number_order(self):
        text = ('Rearrange the steps to merge two sorted linked lists:\nReorder ALL items. Return a permutation.\n'
                '1. Create a dummy node to serve as the head of the merged list\n'
                '2. Traverse both lists simultaneously\n'
                '3. Compare elements of both lists and link the smaller node to the merged list\n'
                '4. Initialize pointers for the first and second list\n'
                '5. Return the merged list starting from the next of the dummy node\n'
                '6. Append remaining nodes of either list to the merged list')
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            result = await main.solve_questions(main.PageContent(
                text=text, url='https://example.test', practice_type='mcq', verify_answer=True))
            self.assertTrue(result['answer_verified'])
            self.assertEqual(json.loads(result['results'])[0]['answer'], [4, 1, 2, 3, 6, 5])
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_pseudocode_questions_use_the_constructor_and_actual_loop(self):
        snippet = ('\nComplete code snippets:\nf(Node a,Node b)\n'
                   'temp1=a\ntemp2=b\ncarry=0\nans=new Node(-1)\ncur=ans\n'
                   'while(temp1!=null || temp2!=null)\n'
                   '  if(temp1!=null)\n    temp1=temp1->next\n'
                   '  if(temp2!=null)\n    temp2=temp2->next\nreturn ans->next\n'
                   'Question format: select one answer.\n')
        cases = [
            ('In the pseudo code, what is the initial value of the ans node?' + snippet
             + 'A. 0\nB. 1\nC. -1\nD. Null', 'Option C: -1'),
            ('What is the time complexity of the below pseudo code where size of linked list a and b are m and n respectively?'
             + snippet + 'A. O(1)\nB. O(log(min(m, n)))\nC. O(max(m, n))\nD. O(m + n)', 'Option C: O(max(m, n))'),
            ('In the mergeTwoLists function, what happens if temp1→data is less than or equal to temp2→data ?\n'
             'Complete code snippets:\nmergeTwoLists(head1, head2) {\n'
             'if(temp1->data <= temp2->data) {\ncur->next = temp\ntemp1 = temp1->next\n}\n'
             'Question format: select one answer.\nA. The function returns temp1\nB. temp1 is discarded\n'
             'C. temp1 is linked to the merged list and temp1 is moved to the next node\nD. temp2 is added',
             'Option C: temp1 is linked to the merged list and temp1 is moved to the next node'),
        ]
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq:
            for text, expected in cases:
                with self.subTest(expected=expected):
                    result = await main.solve_questions(main.PageContent(
                        text=text, url='https://example.test', practice_type='mcq', verify_answer=True))
                    self.assertEqual(json.loads(result['results'])[0]['answer'], expected)
                    self.assertTrue(result['answer_verified'])
            groq.assert_not_awaited()

    async def test_stack_empty_solves_every_display_order_without_a_provider(self):
        steps = ('Check if the top pointer is equal to -1',
                 'Return true if the top pointer is -1', 'Return false otherwise')
        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for displayed in permutations(steps):
                text = 'Arrange the steps in the correct order for the empty() operation.\nReorder ALL items.\n'
                text += '\n'.join(f'{index}. {step}' for index, step in enumerate(displayed, 1))
                with self.subTest(displayed=displayed):
                    result = await main.solve_questions(main.PageContent(
                        text=text, url='https://example.test', practice_type='mcq', verify_answer=True))
                    self.assertTrue(result['answer_verified'])
                    self.assertEqual(json.loads(result['results'])[0]['answer'], [displayed.index(step) + 1 for step in steps])
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

    async def test_linked_stack_push_reorders_the_three_dependencies_locally(self):
        prompt = ('Arrange the steps in the correct order for the push() operation in a stack '
                  'implemented using a linked list.\nReorder ALL items.\n')
        steps = ('Create a new node with temp pointing to it.',
                 'Point temp→next to top .', 'Update the top pointer to temp .')
        def request(displayed):
            return prompt + '\n'.join(f'{index}. {step}' for index, step in enumerate(displayed, 1))

        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for displayed in permutations(steps):
                result = await main.solve_questions(main.PageContent(
                    text=request(displayed), url='https://example.test', practice_type='mcq', verify_answer=True))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(json.loads(result['results'])[0]['answer'],
                                 [displayed.index(step) + 1 for step in steps])
            groq.assert_not_awaited()
            ollama.assert_not_awaited()
        self.assertIsNone(solve_stack_push_order(ordering_question(request((steps[0], steps[2], steps[2])))))
        self.assertIsNone(solve_stack_push_order(ordering_question(request(steps).replace('linked list', 'array'))))

    async def test_linked_stack_pop_reorders_all_four_dependencies_locally(self):
        prompt = ('Arrange the steps in the correct order for the pop() operation in a stack '
                  'implemented using a linked list.\nReorder ALL items.\n')
        steps = ('Check if the stack is empty using empty() .',
                 'Create a temp pointer which points to the node the top pointer is pointing to.',
                 'Update top to top→next .', 'Delete the node pointed to by temp .')

        def request(displayed):
            return prompt + '\n'.join(f'{index}. {step}' for index, step in enumerate(displayed, 1))

        with patch.object(main, 'try_groq', new_callable=AsyncMock) as groq, \
             patch.object(main, 'try_ollama', new_callable=AsyncMock) as ollama:
            for displayed in permutations(steps):
                result = await main.solve_questions(main.PageContent(
                    text=request(displayed), url='https://example.test', practice_type='mcq', verify_answer=True))
                self.assertTrue(result['answer_verified'])
                self.assertEqual(result['provider'], 'local stack pop check [verified]')
                self.assertEqual(json.loads(result['results'])[0]['answer'],
                                 [displayed.index(step) + 1 for step in steps])
            groq.assert_not_awaited()
            ollama.assert_not_awaited()

        cases = (
            request(steps[1:]),
            request((*steps[:3], steps[2])),
            request((*steps[:3], 'Delete the node pointed to by top.')),
            request(steps).replace('linked list', 'array'),
        )
        for text in cases:
            with self.subTest(text=text):
                self.assertIsNone(solve_stack_pop_order(ordering_question(text)))

    def test_next_greater_element_order_verifies_every_display_permutation(self):
        prompt = 'Arrange the steps of the optimal stack-based approach to find the NGE in the correct order.'
        steps = (
            'Initialize a result array with -1 values',
            'Loop through each element from the end of the array to the beginning',
            'Use a while loop to remove elements from the stack that are less than or equal to the current element',
            'If the stack is not empty, set the top of the stack as the next greater element',
            'Push the current element onto the stack',
            'Return the result array ans',
        )
        for displayed in permutations(steps):
            text = prompt + '\nReorder ALL items.\n' + '\n'.join(
                f'{index}. {step}' for index, step in enumerate(displayed, 1))
            result = solve_next_greater_element_order(ordering_question(text))
            self.assertEqual(result['answer'], [displayed.index(step) + 1 for step in steps])

        for changed_prompt, changed_steps in (
            (prompt, steps[:-1]),
            (prompt, (*steps[:-1], steps[0])),
            (prompt.replace('NGE', 'previous greater element'), steps),
            (prompt, (steps[0], steps[1].replace('end', 'beginning'), *steps[2:])),
            (prompt, (steps[0], steps[1], steps[2].replace('less than or equal to', 'greater than'), *steps[3:])),
        ):
            with self.subTest(prompt=changed_prompt, steps=changed_steps):
                self.assertIsNone(solve_next_greater_element_order((changed_prompt, changed_steps)))

    async def test_ordering_retries_disagreement_and_requires_every_displayed_step(self):
        text = 'Arrange the tasks.\nReorder ALL items. Return a permutation.\n1. Build\n2. Design\n3. Check'
        primary = json.dumps([{'type': 'mcq', 'answer': [1, 2, 3]}])
        complete = AsyncMock(side_effect=[self.response([2, 3, 1]), self.response('[1, 3, 2]')])
        result = await cross_check_text_answers([], primary, complete, question_text=text)
        self.assertEqual(json.loads(result)[0]['answer'], [2, 1, 3])
        self.assertEqual(complete.await_count, 2)
        self.assertIn('1. Check\n2. Design\n3. Build', complete.await_args_list[0].args[0][1]['content'])
        self.assertIn('1. Design\n2. Check\n3. Build', complete.await_args_list[1].args[0][1]['content'])

        for answers in [([1, 2], [1, 2]), ([2, 1, 1], [2, 1, 1]), ([2, 1, 3], [3, 2, 1]),
                        ([1, 2, 3], [1, 2, 3])]:
            with self.subTest(answers=answers), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], primary, AsyncMock(side_effect=list(map(self.response, answers))),
                                               question_text=text)

    async def test_generic_ordering_matches_step_text_for_different_topics_and_sizes(self):
        cases = [
            ['Read the instruction', 'Perform the instructed action'],
            ['Design', 'Build', 'Check'],
            ['Load the input data', 'Remove invalid records', 'Compute summaries', 'Save the summaries'],
            [f'Complete stage {number}' for number in range(1, 11)],
        ]
        for steps in cases:
            with self.subTest(steps=steps):
                displayed = steps[1:] + steps[:1]
                expected = [displayed.index(step) + 1 for step in steps]
                text = 'Arrange the required tasks.\nReorder ALL items.\n' + '\n'.join(
                    f'{index}. {step}' for index, step in enumerate(displayed, 1))
                primary = json.dumps([{'type': 'mcq', 'answer': list(range(1, len(steps) + 1))}])
                correct = json.dumps({'readable': True, 'answers': [{'id': 1, 'ordered_steps': steps}]})
                checker = AsyncMock(side_effect=[correct, correct])
                result = await cross_check_text_answers([], primary, checker, question_text=text)
                self.assertEqual(json.loads(result)[0]['answer'], expected)
                self.assertEqual(checker.await_count, 2)
                self.assertIn('ordered_steps', checker.await_args.args[0][0]['content'])
                self.assertIn('NEW numbers', checker.await_args.args[0][0]['content'])

    async def test_generic_ordering_rejects_unknown_duplicate_or_conflicting_steps(self):
        text = 'Arrange the tasks.\nReorder ALL items.\n1. Design\n2. Build\n3. Check'
        primary = json.dumps([{'type': 'mcq', 'answer': [1, 2, 3]}])
        for verdict in (
            {'ordered_steps': ['Design', 'Build']},
            {'ordered_steps': ['Design', 'Build', 'Publish']},
            {'ordered_steps': ['Design', 'Design', 'Check']},
            {'ordered_steps': ['Design', 'Build', 'Check'], 'answer': [1, 2, 3]},
        ):
            response = json.dumps({'readable': True, 'answers': [{'id': 1, **verdict}]})
            with self.subTest(verdict=verdict), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], primary, AsyncMock(return_value=response), question_text=text)

    async def test_free_response_verifies_exact_values_and_corrects_disagreement(self):
        question = ('Using the supplied queue constructor, what are front and back initialized to?\n'
                    'Queue() { front = back = -1; }\nQuestion format: Free response. Return only the exact value.')
        for primary, checks, expected in (
            (-1, [self.response('-1')], '-1'),
            ('front = back = -1', [self.response('-1'), self.response(-1)], '-1'),
            ('NULL', [self.response('NULL')], 'NULL'),
            ('0, 0', [self.response('0, 0')], '0, 0'),
        ):
            checker = AsyncMock(side_effect=checks)
            with self.subTest(primary=primary):
                result = await cross_check_text_answers([], json.dumps([{'type': 'mcq', 'answer': primary}]),
                                                       checker, question_text=question, require_agreement=True)
                self.assertEqual(json.loads(result)[0]['answer'], expected)
        for checks in (['{}', '{}'], [self.response('NULL'), self.response('0')]):
            with self.subTest(checks=checks), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], json.dumps([{'type': 'mcq', 'answer': '-1'}]),
                                               AsyncMock(side_effect=checks), question_text=question)

    async def test_typed_answer_route_uses_the_exact_value_contract(self):
        question = ('Queue() { front = back = nullptr; }\nWhat is the initial pointer value?\n'
                    'Free response: return only the exact value.')
        provider = AsyncMock(side_effect=[json.dumps([{'type': 'mcq', 'answer': 'nullptr'}]), self.response('nullptr')])
        with patch.object(main, 'try_groq', provider), patch.object(main, 'TEXT_MODELS', ['solver', 'checker']), \
                patch.object(main, '_groq_disabled_until', 0):
            result = await main.solve_questions(main.PageContent(
                text=question, url='https://example.test', practice_type='mcq',
                verify_answer=True, require_answer_agreement=True))
        self.assertEqual(json.loads(result['results'])[0]['answer'], 'nullptr')
        self.assertTrue(result['answer_verified'])
        self.assertIn('exact value to enter', provider.await_args_list[0].args[0][0]['content'])
        self.assertIn('exact text to enter', provider.await_args_list[1].args[0][0]['content'])

    async def test_solve_route_requires_agreement_for_one_word_blanks(self):
        question = 'Leo comes (1) ____ Canada.\n\nWhich word best fits blank (1)?\nQuestion format: one word.'
        request = main.PageContent(text=question, url='https://example.test', practice_type='mcq', require_answer_agreement=True)
        primary = json.dumps([{'type': 'mcq', 'question': 'Which word best fits blank (1)?', 'answer': 'from'}])
        with patch.object(main, 'try_groq', AsyncMock(side_effect=[primary, self.response('From')])) as groq, \
             patch.object(main, '_groq_disabled_until', 0):
            result = await main.solve_questions(request)
            self.assertTrue(result['answer_agreement'])
            self.assertEqual(json.loads(result['results'])[0]['answer'], 'from')
            self.assertIn('exactly one word', groq.await_args_list[0].args[0][0]['content'])

        for check in [self.response('away from'), self.response('in'), '{}']:
            with self.subTest(check=check), self.assertRaises(VisionUnconfirmedError):
                await cross_check_text_answers([], primary, AsyncMock(side_effect=[check, '{}']),
                                               question_text=question, require_agreement=True)

    async def test_sentence_transformation_verifies_the_phrase_and_required_word(self):
        text = ('Tom is not old enough to drive a car.\nTOO\nTom is ____ a car.\n'
                'Question format: 2 to 5 words including the given word TOO.')
        for answer, valid in [('too young to drive', True), ('young to drive', False),
                              ('too', False), ('much too young to be driving', False), ('too young to drive.', False)]:
            primary = json.dumps([{'type': 'mcq', 'answer': answer}])
            verify = AsyncMock(return_value=self.response(answer.upper()))
            with self.subTest(answer=answer):
                if valid:
                    self.assertEqual(await cross_check_text_answers([], primary, verify, question_text=text,
                                                                    require_agreement=True), primary)
                else:
                    with self.assertRaises(VisionUnconfirmedError):
                        await cross_check_text_answers([], primary, verify, question_text=text, require_agreement=True)
