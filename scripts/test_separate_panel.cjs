const assert = require('node:assert/strict');
const {cp, mkdtemp, readFile, rm, writeFile} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.resolve(process.env.ASSISTANT_TEST_EXTENSION || path.join(root, 'extension'));
const practice = 'http://127.0.0.1:8000/practice';
const secondUrl = 'http://127.0.0.1:8000/panel-test';
const readingUrl = 'https://learning.ccbp.in/test-reading';
const orderingUrl = 'https://learning.ccbp.in/primitive-coding/practice/ordering/test';
const readingFormats = [
    {
        passage: 'Complete the second sentence using the given word so it means the same.\n1. Tom is not old enough to drive a car.\nTOO\nTom is ____ a car.\n2. I have never visited Mumbai before.\nFIRST\nThis is ____ visited Mumbai.\n3. The red dress is more expensive than the blue dress.\nCHEAPER\nThe blue dress ____ the red dress.',
        instruction: 'Do not change the word given. Use between two and five words.',
        prompts: ['Which phrase best completes the sentence(1)?', 'Which phrase best completes the sentence(2)?', 'Which phrase best completes the sentence(3)?'],
        answers: ['too young to drive', 'the first time I have', 'is cheaper than'],
        keywords: ['TOO', 'FIRST', 'CHEAPER'],
    },
    {
        passage: 'Read the text and choose the correct answer for questions 1–3. The school garden took hard work. More students joined after they saw the plants. The vegetables are used in the school kitchen.',
        prompts: ['1. Why did few students join at first?', '2. Why did more students join?', '3. Where do the vegetables go?'],
        options: [['Gardening seemed hard.', 'It was far away.'], ['They had less homework.', 'They saw the plants.'], ['The school kitchen.', 'The market.']],
        indexes: [0, 1, 0],
    },
    {
        passage: 'Read the comments from four people about favourite places. Maya likes the beach. Rohan plays badminton. Nina likes learning about the past at the museum. Farah draws birds in the park.',
        instruction: 'Choose the correct person for questions 1–3.',
        prompts: ['1. Who likes learning about history?', '2. Who enjoys being near the sea?', '3. Who likes drawing things from nature?'],
        options: Array.from({length: 3}, () => ['Maya', 'Rohan', 'Nina', 'Farah']),
        indexes: [2, 0, 3],
    },
    {
        passage: 'An art class. We painted our favourite places. (1) ____ Some painted beaches and others painted gardens. I painted my grandmother’s village. (2) ____ I used green for the fields. Then we put the paintings on the wall. (3) ____',
        prompts: ['1. Which sentence fits blank (1)?', '2. Which sentence fits blank (2)?', '3. Which sentence fits blank (3)?'],
        options: [['Everyone had a different idea.', 'It has small houses.'], ['The classroom looked colourful.', 'It has small houses.'], ['It has small houses.', 'The classroom looked colourful.']],
        indexes: [0, 1, 1],
    },
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function eventually(check, label) {
    for (let attempt = 0; attempt < 80; attempt++) {
        if (await check()) return;
        await sleep(125);
    }
    assert.fail(label);
}

async function insideViewport(page) {
    const panel = page.locator('#assistant-panel');
    await panel.waitFor();
    await eventually(() => panel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
    }), 'The full floating panel should fit inside the viewport');
}

test('floating and separate panels in Chromium', {timeout: 120_000}, async t => {
    const profile = await mkdtemp(path.join(tmpdir(), 'browser-assistant-panel-'));
    const launchOptions = {
        channel: 'chromium',
        headless: true,
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    };
    let context = await chromium.launchPersistentContext(profile, launchOptions).catch(async error => {
        await rm(profile, {recursive: true, force: true});
        throw error;
    });
    try {
        context.setDefaultTimeout(10_000);
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const base = worker.url().replace(/\/[^/]+$/, '');
        await worker.evaluate(formats => {
            globalThis.testRequests = [];
            const fetchReal = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
                const url = new URL(typeof input === 'string' ? input : input.url || input.href);
                if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '8000') {
                    return fetchReal(input, init);
                }
                const body = init?.body ? JSON.parse(init.body) : {};
                testRequests.push({path: url.pathname, url: body.url, image: body.image?.slice(0, 32)});
                if (url.pathname === '/health') return Response.json({status: 'ok', version: globalThis.testBackendVersion});
                if (url.pathname === '/history') return Response.json([]);
                if (url.pathname === '/extension-release') return Response.json({version: '2.9.1'});
                if (url.pathname === '/solve' && body.url === 'https://learning.ccbp.in/primitive-coding/practice/ordering/test') {
                    if (!body.verify_answer || !body.text.includes('Reorder ALL items.')
                        || !body.text.includes('6. Append remaining nodes of either list to the merged list')) {
                        return Response.json({detail: 'Expected all six steps'}, {status: 422});
                    }
                    return Response.json({answer_verified: true, results: JSON.stringify([{type: 'mcq', answer: [4, 1, 2, 3, 6, 5]}])});
                }
                if (url.pathname === '/solve' && /^https:\/\/learning\.ccbp\.in\/test-reading(?:\?written)?$/.test(body.url || '')) {
                        const format = formats.find(item => item.keywords
                            ? body.text.includes('Tom is not old enough') && body.text.includes('I have never visited Mumbai before')
                                && body.text.includes('The red dress is more expensive')
                            : body.text.includes(item.passage));
                    if (format) {
                        const position = format.prompts.findIndex(prompt => body.text.includes('Answer only this question: ' + prompt));
                        const keyword = format.keywords?.[position];
                        const option = format.indexes?.[position];
                        if (position < 0 || !body.require_answer_agreement || body.text.includes('PRIVATE HEADER')
                            || (keyword && !body.text.endsWith('2 to 5 words including the given word ' + keyword + '.'))) {
                            return Response.json({detail: 'Incorrect reading format'}, {status: 422});
                        }
                        const answer = keyword ? format.answers[position]
                            : 'Option ' + String.fromCharCode(65 + option) + ': ' + format.options[position][option];
                        return Response.json({answer_agreement: true, results: JSON.stringify([{type: 'mcq', answer}])});
                    }
                    const blank = Number(body.text.match(/Answer only this question: Which word best fits blank \((\d+)\)/)?.[1]);
                    const written = body.text.endsWith('Question format: one word.');
                    const answers = written ? ['from', 'during', 'if'] : ['Option C: stand', 'Option A: answer', 'Option C: shop'];
                    const expectedContext = written ? 'asked him (3) ____ he liked our school' : 'museum (3) ____';
                    if (!body.require_answer_agreement || !answers[blank - 1]
                        || !body.text.includes(expectedContext) || body.text.includes('PRIVATE HEADER')) {
                        return Response.json({detail: 'Incorrect reading request'}, {status: 422});
                    }
                    if (globalThis.failReadingBlank === blank) return Response.json({
                        detail: {code: 'answer_unconfirmed', message: 'Blank could not be verified'},
                    }, {status: 422});
                    return Response.json({
                        answer_verified: true, answer_agreement: true,
                        results: JSON.stringify([{type: 'mcq', answer: answers[blank - 1]}]),
                    });
                }
                return Response.json({
                    answer_verified: true,
                    provider: 'local test',
                    results: JSON.stringify([{type: 'mcq', question: 'What is 6 + 7?', answer: 'Option C: 13'}]),
                });
            };
        }, readingFormats);
        await context.route(practice, route => route.fulfill({
            path: path.join(root, 'server', 'practice_quiz.html'),
            contentType: 'text/html',
        }));
        await context.route(secondUrl, route => route.fulfill({contentType: 'text/html', body:
            '<!doctype html><title>Second test tab</title><main>Panel test fixture</main>',
        }));
        await context.route(orderingUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html>
            <main id="generic-question-container">
                <p id="generic-question-wrapper-id">Rearrange the steps to merge two sorted linked lists:</p>
                <div id="steps">
                    ${[
                        'Create a dummy node to serve as the head of the merged list',
                        'Traverse both lists simultaneously',
                        'Compare elements of both lists and link the smaller node to the merged list',
                        'Initialize pointers for the first and second list',
                        'Return the merged list starting from the next of the dummy node',
                        'Append remaining nodes of either list to the merged list',
                    ].map((label, index) => `<div data-position="${index + 1}"><span class="drag-icon-container" draggable="true">Move</span><span class="drag-and-drop-option-label">${label}</span></div>`).join('')}
                </div>
                <button>Submit</button>
            </main>
            <script>
                const steps = document.querySelector('#steps');
                let moving;
                steps.addEventListener('dragstart', event => { moving = event.target.parentElement; });
                steps.addEventListener('drop', event => { if (moving) steps.insertBefore(moving, event.target.parentElement); });
                document.querySelector('button').addEventListener('click', () => {
                    window.submittedOrder = [...steps.children].map(row => Number(row.dataset.position));
                    document.querySelector('main').innerHTML = '<p>Quiz completed</p>';
                });
            </script>`}));
        await context.route(url => url.origin + url.pathname === readingUrl, route => route.fulfill({contentType: 'text/html', body: `<!doctype html>
            <meta charset="utf-8">
            <header>PRIVATE HEADER</header>
            <main style="display:flex;gap:24px">
                <section><p id="passage">At the museum, we had to (1) ____ in line. The robots could (2) ____ questions.
                We bought gifts from the museum (3) ____.</p></section>
                <section id="questions"></section>
            </main>
            <script>
                const questions = document.getElementById('questions');
                const groups = [['sit','wait','stand','walk'],['answer','speak','tell','ask'],['office','station','shop','classroom']];
                const formats = ${JSON.stringify(readingFormats)};
                window.submissions = [];
                function render() {
                    questions.replaceChildren();
                    const mixed = location.search === '?written';
                    const format = mixed ? formats[window.submissions.length - 2] : null;
                    const written = mixed && (window.submissions.length === 1 || Boolean(format?.keywords));
                    if (format?.instruction) {
                        const instruction = document.createElement('p');
                        instruction.textContent = format.instruction;
                        questions.append(instruction);
                    }
                    const enableSubmit = () => { setTimeout(() => { submit.disabled = false; }, 175); };
                    (format?.options || groups).forEach((options, index) => {
                        const group = document.createElement('div');
                        const heading = document.createElement('p');
                        heading.textContent = format?.prompts[index] || 'Which word best fits blank (' + (index + 1) + ')?';
                        group.append(heading);
                        if (written) {
                            const field = document.createElement('textarea');
                            field.placeholder = 'Enter your answer';
                            field.addEventListener('input', () => {
                                if ([...questions.querySelectorAll('textarea')].every(item => item.value)) enableSubmit();
                            });
                            group.append(field);
                            questions.append(group);
                            return;
                        }
                        for (const text of options) {
                            const row = document.createElement('div');
                            // No radio group names or associated labels, like an
                            // option row managed by a web application's own state.
                            row.innerHTML = '<div><input type="radio" ' + (text === 'station' ? 'checked' : '')
                                + '></div><span>' + text + '</span>';
                            row.querySelector('input').addEventListener('click', event => {
                                for (const other of group.querySelectorAll('input')) other.checked = other === event.target;
                                if (questions.querySelectorAll('input:checked').length === groups.length) {
                                    enableSubmit();
                                }
                            });
                            group.append(row);
                        }
                        questions.append(group);
                    });
                    const submit = document.createElement('button');
                    submit.textContent = 'Submit';
                    submit.disabled = true;
                    submit.onclick = () => {
                        window.submissions.push(written
                            ? [...questions.querySelectorAll('textarea')].map(field => field.value)
                            : [...questions.querySelectorAll('input:checked')].map(input => input.parentElement.nextElementSibling.textContent));
                        if (window.submissions.length < (mixed ? formats.length + 2 : 2)) {
                            const passage = document.getElementById('passage');
                            if (mixed && window.submissions.length > 1) {
                                const next = formats[window.submissions.length - 2];
                                if (next.keywords) {
                                    const [instruction, ...lines] = next.passage.split('\\n');
                                    const directions = document.createElement('p');
                                    directions.id = 'phrase-directions';
                                    directions.textContent = instruction;
                                    document.querySelector('main').before(directions);
                                    // The text wraps visually, but the inline spans
                                    // do not create separators in textContent.
                                    passage.replaceChildren(...lines.map(line => {
                                        const span = document.createElement('span');
                                        span.textContent = line;
                                        return span;
                                    }));
                                } else {
                                    document.getElementById('phrase-directions')?.remove();
                                    passage.textContent = next.passage;
                                }
                            } else if (mixed) {
                                passage.textContent = 'Leo comes (1) ____ Canada. He sat next to me (2) ____ our English lesson. After class, I asked him (3) ____ he liked our school.';
                            } else passage.prepend('On the second trip, ');
                            render();
                        } else questions.innerHTML = '<p>Assessment submitted successfully</p>';
                    };
                    questions.append(submit);
                }
                render();
            </script>`}));
        const source = context.pages()[0] || await context.newPage();
        await source.goto(practice);
        let popup = await context.newPage();
        await popup.goto(base + '/popup.html');
        const openFromToolbar = id => popup.evaluate(targetTabId =>
            chrome.runtime.sendMessage({action: 'panel:open', targetTabId}), id);
        const windows = () => worker.evaluate(() => chrome.windows.getAll({windowTypes: ['popup']}));
        let detached;

        await t.test('reorders all six linked-list steps through native drag before submitting', async () => {
            const ordering = await context.newPage();
            try {
                await worker.evaluate(() => { globalThis.testBackendVersion = '2.9.8'; });
                await ordering.goto(orderingUrl);
                await ordering.locator('#assistant-trigger').waitFor();
                await ordering.keyboard.press('Backquote');
                await ordering.locator('#mode-qa').click();
                await ordering.locator('#assistant-auto-start-btn').click();
                await ordering.getByText(/Drag-and-drop needs backend 2\.9\.10 or newer/).first().waitFor();
                assert.equal(await ordering.evaluate(() => window.submittedOrder), undefined);
                assert.equal(await worker.evaluate(() => testRequests.filter(request =>
                    request.path === '/solve' && request.url?.endsWith('/ordering/test')).length), 0);
                await worker.evaluate(() => { globalThis.testBackendVersion = '2.9.11'; });
                await ordering.locator('#assistant-auto-start-btn').click();
                await ordering.getByText('Quiz completed', {exact: true}).waitFor();
                assert.deepEqual(await ordering.evaluate(() => window.submittedOrder), [4, 1, 2, 3, 6, 5]);
            } finally {
                await worker.evaluate(() => { globalThis.testBackendVersion = undefined; });
                await ordering.close();
            }
        });

        for (const {name, query, secondAnswers} of [
            {name: 'continues to the next multiple-choice passage', query: '', secondAnswers: ['stand', 'answer', 'shop']},
            {name: 'continues through one-word, phrase, comprehension, person matching, and sentence gaps', query: '?written', secondAnswers: ['from', 'during', 'if']},
        ]) {
            await t.test(name, async () => {
                const reading = await context.newPage();
                try {
                    await reading.goto(readingUrl + query);
                    await reading.locator('#assistant-trigger').waitFor();
                    await reading.keyboard.press('Backquote');
                    await reading.locator('#mode-qa').click();
                    await reading.locator('#assistant-auto-start-btn').click();
                    await eventually(async () => {
                        const state = await reading.locator('#assistant-automation-state').textContent();
                        if (state === 'PAUSED' || state === 'ERROR') {
                            assert.fail(await reading.locator('#assistant-automation-latest').textContent());
                        }
                        return state === 'COMPLETED';
                    }, 'All reading sets should complete');
                    const expected = [['stand', 'answer', 'shop'], secondAnswers];
                    if (query) expected.push(...readingFormats.map(format => format.answers || format.indexes.map((index, position) => format.options[position][index])));
                    assert.deepEqual(await reading.evaluate(() => window.submissions), expected);
                    assert.equal(await reading.locator('#assistant-automation-completed').textContent(), String(expected.length));
                } catch (error) {
                    const state = await reading.locator('#assistant-automation-state').textContent();
                    const passage = await reading.locator('#passage').textContent();
                    const submissions = await reading.evaluate(() => window.submissions);
                    throw new Error(`${error.message}; state=${state}; passage=${passage}; submitted=${JSON.stringify(submissions)}`);
                } finally { await reading.close(); }
            });
        }

        await t.test('leaves the reading set unsubmitted when one blank is unverified', async () => {
            const reading = await context.newPage();
            try {
                await worker.evaluate(() => { globalThis.failReadingBlank = 2; });
                await reading.goto(readingUrl);
                await reading.locator('#assistant-trigger').waitFor();
                await reading.keyboard.press('Backquote');
                await reading.locator('#mode-qa').click();
                await reading.locator('#assistant-auto-start-btn').click();
                await reading.locator('#assistant-automation-latest').getByText(/Blank could not be verified/).waitFor();
                assert.deepEqual(await reading.evaluate(() => window.submissions), []);
                assert.deepEqual(await reading.locator('#questions input:checked').evaluateAll(inputs =>
                    inputs.map(input => input.parentElement.nextElementSibling.textContent)), ['station']);
            } finally {
                await worker.evaluate(() => { globalThis.failReadingBlank = null; });
                await reading.close();
            }
        });

        await t.test('drags, expands, collapses and clamps the panel after resize', async () => {
            await source.bringToFront();
            await source.setViewportSize({width: 900, height: 650});
            const badge = source.locator('#assistant-trigger');
            await badge.waitFor();
            const original = await badge.boundingBox();
            await source.mouse.move(original.x + 12, original.y + 12);
            await source.mouse.down();
            await source.mouse.move(899, 649, {steps: 12});
            await source.mouse.up();
            assert.equal(await badge.count(), 1);
            const moved = await badge.boundingBox();
            assert.ok(moved.x > original.x || moved.y > original.y + 100);
            await source.keyboard.press('Backquote');
            await insideViewport(source);
            await source.keyboard.press('BracketRight');
            await source.locator('#assistant-root').waitFor({state: 'hidden'});
            await source.keyboard.press('Backquote');
            await insideViewport(source);
            await source.setViewportSize({width: 320, height: 370});
            await insideViewport(source);
            await source.reload();
            await badge.click();
            await insideViewport(source);
        });

        await t.test('opens one window and scans the original tab by text and vision', async () => {
            await source.bringToFront();
            await worker.evaluate(() => chrome.storage.local.set({
                assistantJournalTimer: {deadline: Date.now() + 600_000, path: '/modules/reflective-journal/test'},
            }));
            await source.locator('#assistant-journal-countdown-badge').waitFor();
            const created = context.waitForEvent('page');
            await popup.evaluate(() => document.getElementById('open-separate-panel').click());
            detached = await created;
            await detached.waitForURL(base + '/detached-panel.html');
            await detached.locator('#assistant-scan-btn').waitFor();
            await source.locator('#assistant-root.assistant-detached').waitFor({state: 'attached'});
            assert.equal(await source.locator('#assistant-root').isVisible(), false);
            assert.equal(await source.locator('#assistant-root').count(), 1);
            assert.equal(await source.locator('#assistant-journal-countdown-badge').isVisible(), false);
            await detached.locator('#detached-countdown').waitFor();
            assert.equal((await windows()).length, 1);
            const panelWindow = (await windows())[0];
            const resized = await worker.evaluate(id => chrome.windows.update(id, {width: 340, height: 500}), panelWindow.id);
            assert.ok(resized.width < panelWindow.width);

            await detached.locator('#mode-auto').focus();
            await detached.keyboard.press('ArrowRight');
            await eventually(() => detached.locator('#mode-mcq').getAttribute('aria-selected').then(value => value === 'true'),
                'MCQ selection should be forwarded to the original tab');
            await detached.locator('#assistant-scan-btn').click();
            await detached.locator('#assistant-root').getByText(/Option C/).waitFor();
            await detached.keyboard.press('BracketLeft');
            await detached.locator('#assistant-root').waitFor({state: 'hidden'});
            await detached.keyboard.press('Backquote');
            await detached.locator('#assistant-root').waitFor();
            await detached.keyboard.press('Backslash');
            await eventually(async () => (await worker.evaluate(() => globalThis.testRequests)).some(request =>
                request.path === '/solve-vision' && request.url === practice && request.image?.startsWith('data:image/png;')),
            'Vision should send a real Chrome screenshot from the bound tab');
            const requests = await worker.evaluate(() => globalThis.testRequests);
            assert.ok(requests.some(request => request.path === '/solve' && request.url === practice));
        });

        await t.test('pins the original tab, rebinds, survives reload and restores floating mode', async () => {
            assert.ok(detached);
            popup = await context.newPage();
            await popup.goto(base + '/popup.html');
            const second = await context.newPage();
            await second.goto(secondUrl);
            await second.bringToFront();
            const secondId = await worker.evaluate(async url => (await chrome.tabs.query({url}))[0].id, secondUrl);
            const status = detached.locator('#detached-status');
            await eventually(() => status.textContent().then(label => label.includes('Practice Quiz') &&
                label.includes('Select this tab')), 'The popup should stay pinned when another tab becomes active');
            await detached.keyboard.press('Backslash');
            await detached.locator('#assistant-root').getByText(/requesting tab is no longer active/).waitFor();
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            await eventually(() => status.textContent().then(label => label === 'Second test tab'),
                'The existing window should rebind to the newly selected tab');
            assert.equal((await windows()).length, 1);
            await source.locator('#assistant-root').waitFor();
            await source.locator('#assistant-journal-countdown-badge').waitFor();
            await second.reload();
            await second.locator('#assistant-root.assistant-detached').waitFor({state: 'attached'});
            await detached.locator('#assistant-scan-btn').waitFor();
            const modeBeforeShortcut = await detached.locator('#mode-qa').getAttribute('aria-selected');
            await detached.keyboard.press('Alt+a');
            await sleep(250);
            assert.equal(await detached.locator('#mode-qa').getAttribute('aria-selected'), modeBeforeShortcut,
                'Alt+A must run directly without changing the panel tab or opening its controls');
            await detached.close();
            await second.locator('#assistant-root').waitFor();
            await popup.reload();
            await eventually(() => popup.locator('#open-separate-panel').textContent().then(label => label.includes('Resume')),
                'The toolbar should remember separate-window mode');

            await second.bringToFront();
            const reopened = context.waitForEvent('page');
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            detached = await reopened;
            const closed = detached.waitForEvent('close');
            await detached.locator('#detached-return').click();
            await closed;
            await second.locator('#assistant-root').waitFor();
            assert.equal((await windows()).length, 0);
            const {assistantPanelMode} = await worker.evaluate(() => chrome.storage.local.get('assistantPanelMode'));
            assert.equal(assistantPanelMode, 'floating');
            await second.bringToFront();
            const openedBeforeRestart = context.waitForEvent('page');
            assert.deepEqual(await openFromToolbar(secondId), {ok: true});
            const reopenedPanel = await openedBeforeRestart;
            await reopenedPanel.locator('#assistant-root').waitFor();
        });

        await t.test('remembers the separate mode after Chromium restarts', async () => {
            await context.close();
            context = await chromium.launchPersistentContext(profile, launchOptions);
            const toolbar = await context.newPage();
            await toolbar.goto(base + '/popup.html');
            await eventually(() => toolbar.locator('#open-separate-panel').textContent().then(label => label.includes('Resume')),
                'The toolbar should offer to resume the chosen mode after restart');
        });
    } finally {
        await context.close();
        await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 150});
    }
});

test('a completed workspace build updates the open panel without refreshing its page', {timeout: 60_000}, async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'browser-assistant-update-'));
    const localExtension = path.join(fixture, 'extension');
    const profile = path.join(fixture, 'profile');
    let browser;
    try {
        await cp(extension, localExtension, {recursive: true});
        const manifestPath = path.join(localExtension, 'manifest.json');
        const markerPath = path.join(localExtension, 'workspace-release.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const original = manifest.version;
        const parts = original.split('.').map(Number);
        parts[parts.length - 1]++;
        const next = parts.join('.');
        await writeFile(markerPath, JSON.stringify({version: original}));
        browser = await chromium.launchPersistentContext(profile, {
            channel: 'chromium', headless: true,
            ignoreDefaultArgs: ['--disable-extensions'],
            args: ['--enable-unsafe-extension-debugging'],
        });
        const page = browser.pages()[0] || await browser.newPage();
        await page.goto('chrome://extensions');
        const developerMode = await page.evaluate(async () => {
            await chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode: true});
            return (await chrome.developerPrivate.getProfileConfiguration()).inDeveloperMode;
        });
        assert.equal(developerMode, true);
        const session = await browser.browser().newBrowserCDPSession();
        await session.send('Extensions.loadUnpacked', {path: localExtension});
        await session.detach();
        await browser.route(secondUrl, route => route.fulfill({contentType: 'text/html', body:
            '<!doctype html><title>Workspace update test</title><main><input id="draft" value="initial"></main>',
        }));
        await page.goto(secondUrl);
        await page.locator('#assistant-trigger').click({timeout: 8000});
        await page.locator('#mode-qa').click();
        await page.locator('#draft').fill('keep this draft');
        let navigations = 0;
        page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
        assert.equal(await page.locator('.assistant-build').textContent(), 'v' + original);

        await writeFile(manifestPath, JSON.stringify({...manifest, version: next}));
        await sleep(3400);
        assert.equal(await page.locator('.assistant-build').textContent(), 'v' + original);
        await writeFile(markerPath, JSON.stringify({version: next}));
        try {
            await page.locator(`#assistant-root[data-build="${next}"] .assistant-build`).waitFor({timeout: 12_000});
        } catch (error) {
            const workers = await Promise.all(browser.serviceWorkers().map(worker => worker.evaluate(async () => ({
                version: chrome.runtime.getManifest().version,
                ready: await workspaceVersionFile('workspace-release.json').catch(error => error.message),
                manifest: await workspaceVersionFile('manifest.json').catch(error => error.message),
            })).catch(() => null)));
            const panel = await page.locator('#assistant-root').evaluateAll(nodes => nodes.map(node => node.outerHTML.slice(0, 160)));
            const debug = await browser.newPage();
            await debug.goto('chrome://extensions');
            const installed = await debug.evaluate(async () =>
                (await chrome.developerPrivate.getExtensionsInfo({includeDisabled: true, includeTerminated: true}))
                    .map(item => ({name: item.name, state: item.state, version: item.version,
                        errors: item.runtimeErrors, reasons: item.disableReasons}))).catch(() => null);
            throw new Error(`${error.message}\nWorkers: ${JSON.stringify(workers)}; panel: ${JSON.stringify(panel)}; extensions: ${JSON.stringify(installed)}`);
        }
        assert.equal(await page.locator('.assistant-build').textContent(), 'v' + next);
        assert.equal(await page.locator('#mode-qa').getAttribute('aria-selected'), 'true');
        assert.equal(await page.locator('#draft').inputValue(), 'keep this draft');
        assert.equal(navigations, 0);

        const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
        const base = worker.url().replace(/\/[^/]+$/, '');
        const popup = await browser.newPage();
        await popup.goto(base + '/popup.html');
        const tabId = await worker.evaluate(async url => (await chrome.tabs.query({url}))[0].id, secondUrl);
        await page.bringToFront();
        const created = browser.waitForEvent('page');
        assert.deepEqual(await popup.evaluate(targetTabId => chrome.runtime.sendMessage({action: 'panel:open', targetTabId}), tabId), {ok: true});
        const detached = await created;
        await detached.locator('.assistant-build').waitFor();
        const finalVersion = [...parts.slice(0, -1), parts.at(-1) + 1].join('.');
        await writeFile(manifestPath, JSON.stringify({...manifest, version: finalVersion}));
        await writeFile(markerPath, JSON.stringify({version: finalVersion}));
        await eventually(async () => {
            for (const panel of browser.pages().filter(item => item.url() === base + '/detached-panel.html')) {
                if (await panel.locator('.assistant-build').textContent({timeout: 250}).catch(() => '') === 'v' + finalVersion) return true;
            }
            return false;
        }, 'The detached window should reconnect to the same tab with the new build');
        assert.equal(await page.locator('#assistant-root').getAttribute('data-build'), finalVersion);
        assert.equal(navigations, 0);
    } finally {
        await browser?.close();
        await rm(fixture, {recursive: true, force: true, maxRetries: 5, retryDelay: 150});
    }
});
