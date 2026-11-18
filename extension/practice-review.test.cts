const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(`${__dirname}/content.js`, 'utf8');
function load(context, start, end) {
    vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context);
}

test('Fill for review applies a remembered option and stops before submission', async () => {
    const location = new URL('http://127.0.0.1:8000/practice');
    const automation = { runId: 0, running: false, processed: new Set() };
    let clicks = 0;
    let selected = false;
    const question = {
        text: 'What is 6 + 7?', signature: 'stable',
        options: [
            { text: '12', index: 0, input: { matches: () => true } },
            { text: '13', index: 1, input: { matches: () => true, click() { clicks++; selected = true; } }, isSelected: () => selected },
        ],
    };
    const adapter = { id: 'practice-fixture', isComplete: () => false };
    const context = vm.createContext({
        automation, location, document: {}, window: { location },
        getAutomationContext: () => ({ mode: 'FULL', target: { id: 'local-practice' } }),
        getAutomationAdapter: () => adapter, getAuthorizedQuestion: () => question,
        automationPolicy: { canExecute: () => true },
        updateAutomationUI() {}, waitWhilePaused: async () => automation.running,
        stopAutomation(state) { automation.state = state; automation.running = false; },
        hasSameQuestionOptions: (a, b) => a === b,
        answerIndexesFromResult: () => [],
        waitForOptionSelection: async () => question,
        async readPracticeMemory() { return { problem: 'fixture', answer: '13', rejected: [] }; },
        watchPracticeFeedback(_q, problem, answer) { assert.deepEqual([problem, answer], ['fixture', '13']); },
        submitPracticeAnswer() { assert.fail('Fill for review must never submit'); },
        requestPracticeAnswer() { assert.fail('A verified remembered answer should skip inference'); },
        cancelPracticeFeedback: undefined,
    });
    load(context, '    function supportsReviewFill(', '    async function readPracticeMemory(');
    load(context, '    async function startPracticeAutomation(', '    async function readMcqSnippetSnapshot(');
    await context.startPracticeAutomation(true);
    assert.equal(clicks, 1);
    assert.equal(automation.state, 'ANSWER_FILLED');
    question.options[1].input.matches = () => false;
    await context.startPracticeAutomation(true);
    assert.equal(clicks, 1);
    assert.equal(automation.state, 'PAUSED');
});
