// Coding detection is separate from the existing MCQ adapters.
(function () {
    const visible = element => element.getClientRects().length > 0 && !element.closest('#assistant-root');
    const text = element => (element?.innerText || element?.textContent || '').trim();
    const editorSelector = '.monaco-editor,.ace_editor,.CodeMirror,textarea[data-code-editor],textarea[name="code"],textarea[id="code"]';
    let detectionError = '';
    let editorSequence = 0;
    const editorIds = new WeakMap();
    function unavailable(message) { detectionError = message; return null; }
    function isReadOnly(editor) {
        return editor.matches('[readonly],[disabled],[aria-readonly="true"],.ace_read-only,.cm-readonly')
            || Boolean(editor.querySelector('textarea[readonly],textarea[disabled],[contenteditable="false"][role="textbox"]'));
    }
    function chooseEditor(editors, doc) {
        const editable = editors.filter(editor => !isReadOnly(editor));
        if (editable.length === 1) return editable[0];
        // Example inputs/outputs can themselves be Ace editors. The solution
        // editor has its own Run/Submit controls; never choose by size or order.
        const candidates = editable.filter(editor => {
            for (let scope = editor.parentElement; scope && scope !== doc.body; scope = scope.parentElement) {
                if (editable.filter(candidate => scope.contains(candidate)).length !== 1) break;
                const actions = [...scope.querySelectorAll('button,[role="button"]')].filter(visible);
                if (actions.some(action => /^(run|run code|submit|submit code|submit solution)$/i.test(text(action)))) return true;
            }
            return false;
        });
        return candidates.length === 1 ? candidates[0] : null;
    }
    function selectorFor(editor) {
        if (!editorIds.has(editor)) editorIds.set(editor, `editor-${++editorSequence}`);
        const id = editorIds.get(editor);
        editor.setAttribute('data-browser-assistant-editor', id);
        return `[data-browser-assistant-editor="${id}"]`;
    }
    // Some practice pages use generated CSS classes and plain text labels.
    // Find the Description pane by its visible content, keeping editor/sidebar text out.
    function findDescription(doc, editor) {
        const anchors = [...doc.querySelectorAll('h1,h2,h3,h4,p,span,div,button,[role="tab"]')]
            .filter(element => visible(element) && /^(description|(?:sample\s+)?output\s*:?|(?:sample\s+)?input\s*:?)$/i.test(text(element)));
        for (const anchor of anchors) {
            for (let region = anchor.parentElement; region && region !== doc.body; region = region.parentElement) {
                if (region.contains(editor) || region.querySelector('#assistant-root')) break;
                const content = text(region);
                const hasOutputHeading = [...region.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div,strong,b')]
                    .some(node => /^(?:sample\s+)?output\s*:?$/i.test(text(node)));
                if ((hasOutputHeading || /sample\s+output|output\s*:/i.test(content)) && /write a program|given\b|you are given|implement\b|print\b|return\b/i.test(content)
                    && content.length >= 40 && content.length <= 30000) return region;
            }
        }
        return null;
    }
    const aliases = { python: 'python', python3: 'python', javascript: 'javascript', 'node.js': 'javascript', java: 'java', 'c++': 'cpp', cpp: 'cpp', c: 'c', 'c#': 'csharp', go: 'go', rust: 'rust', kotlin: 'kotlin', php: 'php', sql: 'sql' };
    function parseLanguage(label) {
        const value = String(label || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
            .replace(/^(?:selected )?language\s*:\s*/, '');
        // Portal dropdowns use both "JavaScript" and versioned Node.js
        // runtime names. Match the WHOLE label, not arbitrary page/code text.
        if (/^(?:javascript|js|node\.?js)(?:\s+v?\d+(?:\.\d+)*|\s*\(\s*(?:node\.?js\s*)?v?\d+(?:\.\d+)*\s*\)|\s*\(\s*node\.?js\s*\))?$/.test(value)) return 'javascript';
        if (/^javascript\s*\(\s*node\.?js\s+v?\d+(?:\.\d+)*\s*\)$/.test(value)) return 'javascript';
        const name = value.replace(/\s*v?\d[\d.]*\s*$/, '').trim();
        return aliases[name] || null;
    }
    function findLanguage(doc, editor) {
        const controls = [...doc.querySelectorAll('[data-code-language],select,[role="combobox"]')].filter(node => visible(node)
            && !node.closest('[role="listbox"],[role="option"],#assistant-root'));
        const selected = new Set(controls.map(control => parseLanguage(control.dataset.codeLanguage || control.selectedOptions?.[0]?.textContent || text(control))
            || parseLanguage(control.getAttribute('aria-label')) || parseLanguage(control.getAttribute('title'))).filter(Boolean));
        if (selected.size === 1) return [...selected][0];
        if (selected.size > 1) return null;
        // Search the editor's nearest toolbar/container before considering wider ancestors.
        for (let scope = editor.parentElement; scope && scope !== doc.body; scope = scope.parentElement) {
            const labels = [...scope.querySelectorAll('span,div,button,p')].filter(element => visible(element)
                && !element.closest(editorSelector) && !element.closest('[role="option"],[role="listbox"],pre,code,option'));
            const languages = new Set(labels.map(element => parseLanguage(text(element))).filter(Boolean));
            if (languages.size) return languages.size === 1 ? [...languages][0] : null;
        }
        return null;
    }
    function getQuestion(doc) {
        detectionError = '';
        const editors = [...doc.querySelectorAll(editorSelector)].filter(visible);
        if (!editors.length) return unavailable(`CODE-EDITOR: No supported visible editor found (${doc.querySelectorAll('iframe').length} embedded frames).`);
        const editor = chooseEditor(editors, doc);
        if (!editor) return unavailable(`CODE-EDITORS: Found ${editors.length} visible editors, but no unique editable solution editor with Run/Submit controls.`);
        const regions = [...doc.querySelectorAll('#codingQuestionInfoContainer,[data-coding-question],.problem-statement,.problem-description,[class*="problemDescription"],[class*="ProblemDescription"],[class*="questionDescription"],[class*="QuestionDescription"]')].filter(visible);
        const region = regions.find(element => !element.contains(editor)) || findDescription(doc, editor) || [...doc.querySelectorAll('main,article')].find(element => visible(element) && !element.contains(editor));
        if (!region || text(region).length < 20) return unavailable('CODE-DESCRIPTION: Editor found, but the problem description could not be identified.');
        const webProject = ['htmlEditor', 'cssEditor', 'javascriptEditor'].every(id => doc.getElementById(id)?.matches('.ace_editor'))
            && ['HTML', 'CSS', 'JAVASCRIPT'].every(name => doc.querySelector(`[data-testid="${name}"]`));
        const language = webProject ? 'web' : findLanguage(doc, editor);
        // Require an explicit language; do not overwrite an editor using a guessed default.
        if (!language) return unavailable('CODE-LANGUAGE: Editor and description found, but the selected language is missing or ambiguous.');
        const description = region.cloneNode(true);
        for (const node of description.querySelectorAll('button,[role="tab"],script,style')) node.remove();
        for (const node of [...description.querySelectorAll('*')].reverse()) {
            if (/^(solved|in progress|not attempted)$/i.test(text(node))) node.remove();
        }
        const statuses = [...region.querySelectorAll('span,div,p')].filter(node => visible(node)
            && !node.children.length && /^(solved|in progress|not attempted)$/i.test(text(node)));
        const problemStatus = statuses.length === 1 ? text(statuses[0]).toLowerCase() : null;
        const sectionLabel = /^(input|output|explanation|description|submissions|tutorial|get help|note|topics|companies|easy|medium|hard|sample.*)$/i;
        const heading = [...description.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
            .find(node => text(node) && text(node).length < 200 && !sectionLabel.test(text(node)));
        const portalTitle = region.querySelector('[class*="QuestionShortText-"]');
        let title = text(portalTitle) || text(heading);
        // CCBP often uses a styled div beside "In Progress", not h1/h2.
        // Do not use the Input heading or the entire description as its title.
        if (!title && statuses.length === 1) {
            for (let branch = statuses[0], depth = 0; branch && region.contains(branch) && depth < 3 && !title; branch = branch.parentElement, depth++) {
                for (let sibling = branch.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                    const candidate = text(sibling);
                    if (candidate.length >= 3 && candidate.length < 200 && !sectionLabel.test(candidate)
                        && !/description.*submissions/i.test(candidate)
                        && !sibling.querySelector('input,textarea,pre,.ace_editor')) { title = candidate; break; }
                }
            }
        }
        return { type: 'code', title, text: text(description), language, problemStatus, editorSelector: selectorFor(editor), options: [] };
    }
    function getOnlineIdeQuestion(doc, location) {
        if (location.origin !== 'https://learning.ccbp.in'
            || !/^\/question\/[a-f0-9-]{36}\/?$/i.test(location.pathname)) return null;
        const description = doc.querySelector('#codingQuestionInfoContainer #mark-down')
            || doc.querySelector('#codingQuestionInfoContainer');
        const buttons = [...doc.querySelectorAll('button:not(:disabled),a[href],[role="button"]:not([aria-disabled="true"])')]
            .filter(node => visible(node) && /^open ide$/i.test(text(node)));
        if (!description || !visible(description) || buttons.length !== 1) return null;
        const requirements = text(description);
        if (!/\bapp\.js\b/i.test(requirements) || !/\b(?:express|common\s*js|node\.?js)\b/i.test(requirements)) return null;
        const title = text(description.querySelector('h1,h2')) || 'Node.js IDE assignment';
        const panel = doc.querySelector('#codingQuestionInfoContainer');
        const solved = [...panel.querySelectorAll('span,div')].some(node => !node.children.length && visible(node) && /^solved$/i.test(text(node)));
        const commands = new Set([...doc.querySelectorAll('code,span,div,p,input')]
            .filter(node => visible(node) && !description.contains(node))
            .map(node => (node.value || text(node)).match(/^ccbp\s+submit\s+([a-z0-9]{6,24})$/i)?.[1]).filter(Boolean));
        return { title, text: requirements, button: buttons[0], solved, workspace: commands.size === 1 ? [...commands][0] : null };
    }
    function getSubmit(doc) {
        const buttons = [...doc.querySelectorAll('button:not(:disabled),[role="button"]:not([aria-disabled="true"])')]
            .filter(visible).filter(button => /^(submit|submit code|submit solution)$/i.test(text(button)));
        return buttons.length === 1 ? buttons[0] : null;
    }
    function getResult(doc) {
        const webResult = doc.querySelector('#submitResultContainer');
        if (webResult && visible(webResult)) {
            const cards = [...webResult.querySelectorAll('[class*="TestCaseSummaryCard-"]')];
            const counts = {};
            for (const card of cards) {
                const label = text(card.querySelector('[class*="TestCaseSummaryLabel-"]')).toLowerCase();
                const value = text(card.querySelector('[class*="TestCaseSummaryCount-"]'));
                if (/^\d+$/.test(value)) counts[label] = Number(value);
            }
            if (counts.total > 0 && counts.passed + counts.failed === counts.total) {
                return counts.failed > 0 ? 'failed' : counts.passed === counts.total ? 'passed' : null;
            }
        }
        const resultNodes = [...doc.querySelectorAll('[data-coding-result],[role="status"],[role="alert"],.submission-result,.test-results')];
        const labels = [...doc.querySelectorAll('span,p,div')].filter(node => !node.closest('table,[role="table"],tr,[role="row"]') && !node.children.length
            && /^(accepted|all test cases passed|all tests passed|correct answer|wrong answer|compilation error|runtime error|time limit exceeded|tests? failed)[.!\s]*$/i.test(text(node)));
        const results = [...resultNodes, ...labels].filter(visible).map(text).join('\n');
        const latest = labels.filter(visible)[0];
        if (latest) return /^(accepted|all test cases passed|all tests passed|correct answer)/i.test(text(latest)) ? 'passed' : 'failed';
        if (/wrong answer|compilation error|runtime error|time limit exceeded|tests? failed/i.test(results)) return 'failed';
        if (/^(accepted|all test cases passed|all tests passed|correct answer)[.!\s]*$/im.test(results)) return 'passed';
        // Only the selected problem's status counts; sidebar/course completion does not.
        if (getQuestion(doc)?.problemStatus === 'solved') return 'passed';
        return null;
    }
    function getFailureFeedback(doc) {
        const copy = doc.body.cloneNode(true);
        for (const node of copy.querySelectorAll('#assistant-root,.ace_editor,.monaco-editor,.CodeMirror,script,style,table,[role="table"]')) node.remove();
        return text(copy).slice(0, 16000);
    }
    function getDescriptionTab(doc) {
        const tabs = [...doc.querySelectorAll('button,[role="tab"],a,span,div')].filter(node => visible(node)
            && /^description$/i.test(text(node)) && ![...node.children].some(child => /^description$/i.test(text(child))));
        return tabs.length === 1 ? tabs[0] : null;
    }
    window.BrowserAssistantCoding = { getQuestion, getOnlineIdeQuestion, getSubmit, getResult, getFailureFeedback, getDescriptionTab, getDetectionError: () => detectionError };
})();
