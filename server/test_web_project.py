import json
import unittest
from unittest.mock import AsyncMock
import main


class WebProjectTests(unittest.TestCase):
    def test_alternative_three_file_wrappers_are_normalized(self):
        files = {'html': '<html><body><p>ok</p></body></html>', 'css': '', 'javascript': ''}
        responses = [files, {'type':'code','code':json.dumps(files)},
                     {'type':'code','files':{'index.html':files['html'],'style.css':'','script.js':''}},
                     {'files':[{'name':'index.html','content':files['html']},{'name':'style.css','content':''},{'name':'script.js','content':''}]}]
        for response in responses:
            result = json.loads(main.validate_code_results(json.dumps([response]),'web',require_code=True))[0]
            self.assertEqual(json.loads(result['code']),files)

    def test_three_files_are_validated_and_serialized_for_the_bridge(self):
        files = {'html': '<html><body><button id="send">Send</button></body></html>', 'css': 'button {color:blue}', 'javascript': 'document.querySelector("#send").onclick = () => {};'}
        result = json.loads(main.validate_code_results(json.dumps([{'type':'code','files':files}]), 'web', require_code=True))[0]
        self.assertEqual(json.loads(result['code']), files)
        self.assertEqual(result['language'], 'web')

    def test_wrong_tab_content_and_missing_files_are_rejected(self):
        for files in ({'html':'document.addEventListener("click", () => {});','css':'','javascript':''}, {'html':'<p>Incomplete project</p>'}):
            with self.assertRaises(ValueError):
                main.validate_code_results(json.dumps([{'type':'code','files':files}]), 'web', require_code=True)

    def test_loading_labels_and_javascript_spread_are_not_incomplete_code(self):
        files = {'html':'<html><body><span>Loading...</span></body></html>', 'css':'span::after {content: "..."}', 'javascript':'const values = [...[1, 2]];'}
        result = json.loads(main.validate_code_results(json.dumps([{'type':'code','files':files}]),'web',require_code=True))[0]
        self.assertEqual(result['files'],files)

    def test_web_language_and_prompt_do_not_use_node_stdin_scaffold(self):
        self.assertEqual(main.resolve_language('', 'web'), 'web')
        prompt = main.build_system_prompt('code','web')
        self.assertIn('THREE separate editor tabs', prompt)
        self.assertIn('files.html', prompt)


class WebRepairTests(unittest.IsolatedAsyncioTestCase):
    async def test_web_retry_keeps_three_file_schema_instead_of_requesting_single_source(self):
        valid = {'type':'code','files':{'html':'<html><body><p>ok</p></body></html>','css':'','javascript':''}}
        generator = AsyncMock(side_effect=[json.dumps([{'type':'code','code':'broken envelope'}]),json.dumps([valid])])
        result = await main.generate_validated_result(generator,[], 'web', require_code=True)
        self.assertIn('files',json.loads(result)[0])
        prompt = generator.await_args.args[0][-1]['content']
        self.assertIn('"files":{"html":',prompt)
        self.assertNotIn('"code":"complete solution"',prompt)
