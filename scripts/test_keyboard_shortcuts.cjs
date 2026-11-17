const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtemp, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.resolve(process.env.ASSISTANT_TEST_EXTENSION || path.join(root, 'extension'));

function fixtureServer() {
    return new Promise(resolve => {
        const server = createServer((request, response) => {
            response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
            response.end('<!doctype html><meta charset="utf-8"><title>Shortcut fixture</title>'
                + '<body><h1>Shortcut fixture</h1><p>A page with no keyboard handlers.</p>'
                + '<input id="field" placeholder="type here"></body>');
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('Control chords and browser commands control the panel in Chromium', {timeout: 120_000}, async () => {
    const server = await fixtureServer();
    const profile = await mkdtemp(path.join(tmpdir(), 'browser-assistant-shortcuts-'));
    const context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true,
        args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    try {
        context.setDefaultTimeout(15_000);
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForSelector('#assistant-root');

        const panel = page.locator('#assistant-root');
        const visible = () => panel.evaluate(element => getComputedStyle(element).display !== 'none');
        // MIN only renders on the collapsed badge, so minimal mode is read there.
        const minimise = () => page.locator('.assistant-mode-indicator').count();

        assert.equal(await visible(), true, 'the panel starts open');

        await page.keyboard.press(']');
        assert.equal(await visible(), false, 'the bare close key still works');
        assert.equal(await minimise(), 0, 'minimal mode starts off');

        await page.keyboard.press('Control+Shift+O');
        assert.equal(await visible(), true, '⌃⇧O opens the panel');

        await page.keyboard.press('Control+Shift+X');
        assert.equal(await visible(), false, '⌃⇧X closes the panel');
        assert.equal(await minimise(), 0, '⌃⇧X must not toggle minimal mode');

        await page.keyboard.press('Control+Shift+M');
        assert.equal(await visible(), false, '⌃⇧M keeps the panel closed');
        assert.equal(await minimise(), 1, '⌃⇧M enters minimal mode');
        await page.keyboard.press('Control+Shift+M');
        assert.equal(await minimise(), 0, '⌃⇧M leaves minimal mode');

        await page.keyboard.press('Control+Shift+S');
        assert.equal(await visible(), true, '⌃⇧S opens the panel while scanning');
        assert.equal(await minimise(), 0, '⌃⇧S must not toggle minimal mode');
        await page.keyboard.press('Control+Shift+X');

        await page.click('#field');
        await page.keyboard.press('Control+Shift+O');
        assert.equal(await visible(), true, '⌃⇧O works with a text field focused');
        assert.equal(await page.inputValue('#field'), '', 'the chord is not typed into the field');

        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const send = action => worker.evaluate(async command => {
            const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
            await chrome.tabs.sendMessage(tab.id, {action: command}, {frameId: 0});
        }, action);
        await send('panel:close');
        await page.waitForTimeout(250);
        assert.equal(await visible(), false, 'the browser command closes the panel');
        await send('panel:open');
        await page.waitForTimeout(250);
        assert.equal(await visible(), true, 'the browser command opens the panel');
        await send('panel:close');
        await page.waitForTimeout(250);
        assert.equal(await visible(), false, 'the browser command closes it again');
        // MIN renders on the collapsed badge, so toggle minimal mode while closed.
        await send('panel:minimal');
        await page.waitForTimeout(250);
        assert.equal(await minimise(), 1, 'the browser command enters minimal mode');
        await send('panel:minimal');
        await page.waitForTimeout(250);
        assert.equal(await minimise(), 0, 'the browser command leaves minimal mode');
    } finally {
        await context.close();
        await new Promise(resolve => server.close(resolve));
        await rm(profile, {recursive: true, force: true});
    }
});
