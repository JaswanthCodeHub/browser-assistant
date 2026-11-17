// Browser Assistant automation authorization policy.
// Site-specific adapters take precedence; ordinary websites use semantic detection.
// Runs begin from the user's Start control and remain tied to their starting origin.
(function () {
    const targets = [
        {
            id: 'local-practice',
            origins: ['http://127.0.0.1:8000'],
            paths: ['/practice'],
            marker: '[data-browser-assistant-automation="authorized"]',
            adapter: 'practice-fixture',
            pageTypes: ['practice'],
            capabilities: { detect: true, read: true, fill: true, select: true, click: true, navigate: true, validate: true, submit: true },
        },
        {
            id: 'ccbp-learning-practice',
            origins: ['https://learning.ccbp.in'],
            paths: [],
            adapter: 'semantic-mcq',
            pageTypes: ['practice', 'quiz'],
            capabilities: { detect: true, read: true, fill: true, select: true, click: true, navigate: true, validate: true, submit: true },
        },
        // Example for an explicitly authorized remote QA app:
        // {
        //     id: 'my-staging-qa',
        //     origins: ['https://staging.example.com'],
        //     paths: ['/qa/'], // path prefix; omit to allow all paths on that exact origin
        //     marker: '[data-browser-assistant-automation="authorized"]',
        //     adapter: 'semantic-mcq',
        //     pageTypes: ['practice', 'quiz', 'form'],
        //     capabilities: { detect: true, read: true, fill: true, select: true, click: true, navigate: false, validate: true, submit: false },
        // },
    ];

    const adapters = new Map();
    function registerAdapter(adapter) {
        if (!adapter || typeof adapter.id !== 'string' || typeof adapter.getQuestion !== 'function') {
            throw new TypeError('Adapter requires an id and getQuestion(page) function.');
        }
        adapters.set(adapter.id, adapter);
    }

    function resolveTarget(location, doc) {
        let url;
        try { url = new URL(location.href); } catch { return null; }
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        const origin = url.origin;
        return targets.find((target) => target.origins.includes(origin)
            && (!target.paths?.length || target.paths.some((path) => location.pathname === path || location.pathname.startsWith(path)))
            && (!target.marker || doc.querySelector(target.marker))) || {
            id: `website:${origin}`,
            origins: [origin],
            adapter: 'semantic-mcq',
            pageTypes: ['practice', 'quiz', 'code'],
            capabilities: { detect: true, read: true, fill: true, select: true, click: true, navigate: true, validate: true, submit: true },
        };
    }

    function determineMode(context) {
        if (!context?.authorizationVerified) return 'ASSIST';
        if (context.target?.restricted) return 'DISABLED';
        if (!context.target?.authorized || !context.page?.authorized) return 'ASSIST';
        return 'FULL';
    }

    function canExecute(action, context) {
        return determineMode(context) === 'FULL' && context.target.capabilities?.[action] === true;
    }

    registerAdapter({
        id: 'practice-fixture',
        getQuestion(doc) {
            const question = doc.querySelector('[data-practice-question-text]');
            const optionNodes = [...doc.querySelectorAll('[data-practice-option]')];
            if (!question || optionNodes.length < 2) return null;
            const options = optionNodes.map((node, index) => {
                const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                const label = String.fromCharCode(65 + index) + '. ';
                return {
                    index, text: text.startsWith(label) ? text.slice(label.length) : text, node,
                    input: node.querySelector('input:not(:disabled)'),
                };
            });
            if (options.some((option) => !option.input) || !question.textContent.trim()) return null;
            return { text: question.textContent.replace(/\s+/g, ' ').trim(), options, form: question.closest('form') || doc.querySelector('form') };
        },
        getSubmit(doc, question) { return question.form?.querySelector('[data-practice-submit]:not(:disabled)') || null; },
        isComplete(doc) { return Boolean(doc.querySelector('[data-practice-complete]')); },
    });

    // Semantic fallback for authorized pages that use ordinary radio forms.
    registerAdapter({
        id: 'semantic-mcq',
        getQuestion(doc) {
            const visible = (element) => element.getClientRects().length > 0;
            const preserveMatrices = (clone) => {
                for (const math of clone.querySelectorAll('math')) {
                    const tables = math.querySelectorAll('mtable');
                    if (tables.length !== 1) continue;
                    const matrix = tables[0];
                    const surrounding = math.cloneNode(true);
                    surrounding.querySelectorAll('mtable,annotation,annotation-xml').forEach(node => node.remove());
                    if (!/^[\s()[\]{}|‖]*$/.test(surrounding.textContent || '')) continue;
                    const rows = [...matrix.children];
                    if (!rows.length || rows.some(row => !row.matches('mtr'))) continue;
                    const cells = rows.map(row => [...row.children].map(cell => {
                        if (!cell.matches('mtd')) return '';
                        const value = (cell.textContent || '').trim().replace(/−/g, '-').replace(/^([+-])\s+/, '$1');
                        return /^[+-]?\d+(?:\.\d+)?$/.test(value) ? value : '';
                    }));
                    if (!cells[0].length || cells.some(row => row.length !== cells[0].length || row.some(value => !value))) continue;
                    const renderer = math.closest('.katex,mjx-container') || math;
                    renderer.replaceWith(doc.createTextNode(` ${JSON.stringify(cells).replace(/"/g, '')} `));
                }
            };
            const textOf = (element) => {
                if (!element) return '';
                const clone = element.cloneNode(true);
                preserveMatrices(clone);
                const editors = element.querySelectorAll('.ace_editor,.CodeMirror,.monaco-editor');
                [...clone.querySelectorAll('.ace_editor,.CodeMirror,.monaco-editor')].forEach((block, index) => {
                    const source = typeof browserAssistantCachedMcqSnippet === 'function'
                        ? browserAssistantCachedMcqSnippet(editors[index]) : undefined;
                    if (typeof source === 'string') block.textContent = '\n' + source + '\n';
                });
                clone.querySelectorAll('.ace_gutter,.line-numbers,.line-numbers-rows,.linenumber,.margin-view-overlays,script,style').forEach(node => node.remove());
                return (clone.textContent || '').replace(/\s+/g, ' ').trim();
            };
            const optionIdentity = element => {
                if (!element) return '';
                const clone = element.cloneNode(true);
                // Full source is checked separately before selection. A viewport
                // repaint or editor warning must not look like a new option.
                clone.querySelectorAll('.ace_editor,.CodeMirror,.monaco-editor').forEach(node => {
                    const marker = doc.createElement('span');
                    marker.textContent = ' [code editor] ';
                    node.replaceWith(marker);
                });
                return textOf(clone);
            };
            const labelledText = (element) => (element?.getAttribute('aria-labelledby') || '')
                .split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean).map(textOf).join(' ');
            const radioSelector = 'input[type="radio"],[role="radio"]';
            const readingFieldSelector = 'textarea,input[type="text"],input:not([type])';
            const blankPrompt = /^(?:\d+[.)]\s*)?which (?:word|sentence) (?:best )?fits (?:the )?(?:blank|gap)\s*\(\s*(\d+)\s*\)\s*\?$/i;
            const phrasePrompt = /^(?:\d+[.)]\s*)?which phrase best completes (?:the )?sentence\s*\(\s*(\d+)\s*\)\s*\?$/i;
            const numberedPrompt = /^(\d+)[.)]\s+.{3,1000}\?$/;
            const blankNumbers = (text: string) => [...text.matchAll(/\(\s*(\d+)\s*\)\s*(?:_{2,}|\.{3,}|…)/g)]
                .map(match => Number(match[1]));
            const readingText = (node, separateInline = false) => {
                const copy = node.cloneNode(true);
                copy.querySelectorAll('script,style,template,[hidden],[aria-hidden="true"]').forEach(child => child.remove());
                copy.querySelectorAll(separateInline ? 'br,p,div,li,span,strong,b,em' : 'br,p,div,li').forEach(child => {
                    child.before('\n'); child.after('\n');
                });
                return (copy.textContent || '').trim();
            };
            const phraseKeywords = (context: string) => {
                const keywords = new Map<number, string>();
                // Preserve rendered lines when available. Some portals join
                // the end of one item directly to the next item number.
                const items = [...context.matchAll(/(?:^|[^\w])([1-9]\d*)\s*[.)]\s*(?=[A-Za-z])/g)];
                for (const [index, item] of items.entries()) {
                    const pair = context.slice(item.index + item[0].length, items[index + 1]?.index);
                    const standalone = [...pair.matchAll(/^\s*([A-Z]{2,})\s*$/gm)].map(match => match[1]);
                    const candidates = standalone.length ? standalone : pair.match(/\b[A-Z]{2,}\b/g) || [];
                    if ((pair.match(/_{2,}/g) || []).length !== 1 || candidates.length !== 1
                        || keywords.has(Number(item[1]))) return null;
                    keywords.set(Number(item[1]), candidates[0]);
                }
                return keywords;
            };
            const pageText = doc.body.innerText || doc.body.textContent || '';
            const readingRange = /questions\s+(\d+)\s*[-–—]\s*(\d+)/i.exec(pageText);
            const phraseSet = /which\s+phrase\s+best\s+completes/i.test(pageText)
                && /(?:two\s+and\s+five|2\s*(?:and|to|[-–—])\s*5)\s+words/i.test(pageText);
            const gapSet = blankNumbers(pageText).length >= 2 && /which (?:word|sentence) (?:best )?fits/i.test(pageText);
            if (gapSet || phraseSet || readingRange) {
                const promptPattern = phraseSet ? phrasePrompt : gapSet ? blankPrompt : numberedPrompt;
                const blocks = [...doc.querySelectorAll('div,p,h1,h2,h3,h4,span,label,section,article,legend,[role="heading"]')]
                    .filter(node => visible(node) && !node.closest('#assistant-root,nav,aside'));
                const headings = blocks.filter(node => promptPattern.test((node.textContent || '').trim())
                    && ![...node.querySelectorAll('div,p,h1,h2,h3,h4,span,label,section,article,legend,[role="heading"]')]
                        .some(child => promptPattern.test((child.textContent || '').trim())));
                const headingNumbers = headings.map(node => Number(textOf(node).match(promptPattern)?.[1]));
                let phraseContext: string;
                let phrases: Map<number, string>;
                let passage = !phraseSet && gapSet && blocks.find(node => {
                    const text = node.textContent || '';
                    return text.length <= 12000 && blankNumbers(text).length >= 2
                        && !/which (?:word|sentence) (?:best )?fits/i.test(text) && !node.querySelector(radioSelector)
                        && ![...node.children].some(child => blankNumbers(child.textContent || '').length >= 2);
                });
                if (phraseSet && headings.length >= 2) {
                    // Some layouts place directions and the numbered source
                    // text in different wrappers. Find the source by its gaps,
                    // independent of where the directions are rendered.
                    const sources = blocks.filter(node => {
                        const raw = node.textContent || '';
                        return raw.length <= 12000 && (raw.match(/_{2,}/g) || []).length >= 2
                            && !node.querySelector(`${radioSelector},${readingFieldSelector}`);
                    });
                    const gapCount = node => (node.textContent.match(/_{2,}/g) || []).length;
                    const total = Math.max(0, ...sources.map(gapCount));
                    if (total !== headings.length) return null;
                    for (const source of sources.reverse()) {
                        if (gapCount(source) !== total) continue;
                        for (const context of [source.innerText?.trim(), readingText(source), readingText(source, true)]) {
                            if (!context) continue;
                            const found = phraseKeywords(context);
                            if (found?.size !== total || !headingNumbers.every(number => found.has(number))) continue;
                            passage = source;
                            phraseContext = context;
                            phrases = found;
                            break;
                        }
                        if (passage) break;
                    }
                } else if (!gapSet && !phraseSet && headings.length) {
                    // The passage occupies a separate column preceding the
                    // shared answer column. Never use the timer or palette.
                    const instruction = /read the (?:text|comments|passage)/i;
                    for (let column = headings[0].parentElement; column && column !== doc.body && !passage; column = column.parentElement) {
                        if (!headings.every(heading => column.contains(heading))) continue;
                        for (let node = column.previousElementSibling; node; node = node.previousElementSibling) {
                            const content = textOf(node);
                            if (visible(node) && content.length <= 12000 && instruction.test(content)
                                && !node.querySelector(`${radioSelector},${readingFieldSelector}`)) {
                                passage = node;
                                break;
                            }
                        }
                    }
                }
                if (passage && headings.length) {
                    const context = phraseContext || readingText(passage);
                    const count = readingRange ? Number(readingRange[2]) - Number(readingRange[1]) + 1 : 0;
                    const numbers = (phraseSet ? [...phrases.keys()] : gapSet ? blankNumbers(context)
                        : count >= 2 && count <= 30 ? Array.from({length: count}, (_, index) => Number(readingRange[1]) + index) : [])
                        .sort((a, b) => a - b);
                    // A partially rendered or unrecognized reading set must
                    // never fall through to the ordinary single-answer solver.
                    if (numbers.length < 2 || new Set(numbers).size !== numbers.length
                        || [...headingNumbers].sort((a, b) => a - b).join() !== numbers.join()) return null;
                    const submitSelector = 'button,input[type="submit"],[role="button"]';
                    let scope = headings[0].parentElement;
                    let submit: Element | undefined;
                    for (; scope && scope !== doc.body; scope = scope.parentElement) {
                        if (!headings.every(node => scope.contains(node))) continue;
                        const submits = [...scope.querySelectorAll(submitSelector)].filter(node => visible(node)
                            && !node.closest('#assistant-root')
                            && /^submit(?: answer)?$/i.test(textOf(node) || node.getAttribute('value') || node.getAttribute('aria-label') || ''));
                        if (submits.length > 1) return null;
                        if (submits.length === 1) { [submit] = submits; break; }
                    }
                    if (!submit) return null;
                    const controls = [...scope.querySelectorAll(radioSelector)].filter(node =>
                        !node.parentElement?.closest('[role="radio"]') && (visible(node)
                            || (node.matches('input') && ([...(node.labels || [])].some(visible)
                                || (node.parentElement !== scope && visible(node.parentElement))))));
                    const fields = [...scope.querySelectorAll(readingFieldSelector)].filter(node => visible(node)
                        && !node.closest('#assistant-root,.monaco-editor,.ace_editor,.CodeMirror'));
                    const positions = new Map([...scope.querySelectorAll('*')].map((node, index) => [node, index]));
                    const follows = (before: Element, after: Element) => positions.get(before) < positions.get(after);
                    if (!controls.length && fields.length && (phraseSet || (gapSet && headings.every(heading => /which word/i.test(textOf(heading)))))) {
                        const questions = headings.map((heading, position) => {
                            const next = headings[position + 1] || submit;
                            const group = fields.filter(node => follows(heading, node) && follows(node, next));
                            return { text: textOf(heading), options: [], input: group.length === 1 ? group[0] : null,
                                requiredWord: phrases?.get(headingNumbers[position]), container: scope };
                        });
                        if (questions.some(question => !question.input) || fields.length !== questions.length) return null;
                        return { ...questions[0], type: 'compound-short-answer', compoundQuestions: questions,
                            compoundContext: context, compoundSubmit: submit };
                    }
                    if (fields.length || phraseSet) return null;
                    const questions = headings.map((heading, position) => {
                        const next = headings[position + 1] || submit;
                        const group = controls.filter(node => follows(heading, node) && follows(node, next));
                        const options = group.map((control, index) => {
                            const input = control.matches('input') ? control : control.querySelector('input[type="radio"]');
                            let label: Element = input?.labels?.[0] || control.closest('label') || control;
                            // Some reading options have an unlabelled radio
                            // alongside a text span in the clickable row.
                            while (!textOf(label) && label.parentElement && label.parentElement !== scope
                                && !label.parentElement.contains(heading)
                                && label.parentElement.querySelectorAll(radioSelector).length === 1) {
                                label = label.parentElement;
                            }
                            const text = textOf(label) || control.getAttribute('aria-label') || labelledText(control);
                            return { index, text, input, control, node: label,
                                isSelected: () => Boolean(input?.checked || control.getAttribute('aria-checked') === 'true'),
                                disabled: control.matches(':disabled,[aria-disabled="true"]') || Boolean(input?.disabled) };
                        });
                        return { text: textOf(heading), options, selectionType: 'single', container: scope };
                    });
                    if (questions.some(question => question.options.length < 2
                        || question.options.some(option => !option.text)
                        || new Set(question.options.map(option => option.text)).size !== question.options.length)) return null;
                    return { ...questions[0], type: 'compound-mcq', compoundQuestions: questions,
                        compoundContext: context, compoundSubmit: submit };
                }
                if (gapSet || phraseSet || (headings.length && /read the (?:text|comments|passage)/i.test(pageText))) return null;
            }
            const nativeRegion = doc.querySelector('#generic-question-container');
            const nativeLabels = [...(nativeRegion?.querySelectorAll('.drag-and-drop-option-label') || [])].filter(visible);
            const nativePrompt = nativeRegion?.querySelector('#generic-question-wrapper-id');
            if (nativeLabels.length >= 2 && nativeLabels.length <= 30 && nativePrompt
                && nativeLabels.every(label => label.parentElement.querySelector('.drag-icon-container[draggable="true"]'))) {
                const options = nativeLabels.map((label, index) => ({ index, text: textOf(label), node: label.parentElement }));
                if (new Set(options.map(option => option.text)).size === options.length) return {
                    type: 'ordering', dragKind: 'native-ccbp', text: textOf(nativePrompt), container: nativeRegion, options,
                };
            }
            const dragSelector = '[data-rbd-draggable-id],[data-rfd-draggable-id]';
            const rows = [...doc.querySelectorAll(dragSelector)].filter(visible);
            if (rows.length >= 2 && rows.length <= 30) {
                const scope = rows[0].closest('[data-rbd-droppable-id],[data-rfd-droppable-id]');
                if (scope && rows.every(row => scope.contains(row))) {
                    for (let region = scope.parentElement; region && region !== doc.body; region = region.parentElement) {
                        const clone = region.cloneNode(true);
                        clone.querySelectorAll(`${dragSelector},button,[role="button"],script,style`).forEach(node => node.remove());
                        const prompt = textOf(clone);
                        if (/rearrange|correct order|order the|sort the/i.test(prompt) && prompt.length < 7000) return {
                            type: 'ordering', text: prompt, container: region, options: rows.map((row, index) => ({
                                index, text: textOf(row), node: row,
                                id: row.getAttribute('data-rbd-draggable-id') || row.getAttribute('data-rfd-draggable-id'),
                            })),
                        };
                    }
                }
            }
            const allControls = [...doc.querySelectorAll('input[type="radio"]:not(:disabled),input[type="checkbox"]:not(:disabled),[role="radio"]:not([aria-disabled="true"]),[role="checkbox"]:not([aria-disabled="true"])')]
                .filter((control) => visible(control) || (control.matches('input[type="radio"],input[type="checkbox"]') && [...(control.labels || [])].some(visible)));
            const groups = new Map();
            for (const control of allControls) {
                // Radio buttons with the same name are one question even when
                // each option lives in a different React/CSS wrapper.
                const isCheckbox = control.matches('input[type="checkbox"],[role="checkbox"]');
                const key = isCheckbox
                    ? `checkbox:${control.form?.id || '__page__'}`
                    : control.matches('input[type="radio"]')
                    ? `native:${control.form?.id || ''}:${control.name || control.closest('form')?.id || ''}`
                    : control.closest('[role="radiogroup"]') || control.parentElement;
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(control);
            }
            const radioCandidates = [];
            const choiceSelector = 'input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]';
            const codeSelector = 'pre,code,.ace_editor,.CodeMirror,.monaco-editor';
            const promptSelector = '#generic-question-wrapper-id,#exam-question-wrapper-id,[data-question-text]';
            const readable = node => visible(node) && !node.closest('[hidden],[aria-hidden="true"],[inert],#assistant-root')
                && doc.defaultView?.getComputedStyle?.(node)?.visibility !== 'hidden';
            const proseText = node => {
                if (!readable(node) || node.matches(codeSelector)) return '';
                const clone = node.cloneNode(true);
                clone.querySelectorAll(`${codeSelector},[hidden],[aria-hidden="true"],[inert]`).forEach(child => child.remove());
                return textOf(clone);
            };
            for (const group of groups.values()) {
                if (group.length < 2) continue;
                const container = group[0].closest('fieldset,[role="radiogroup"],form')
                    || group[0].parentElement?.parentElement?.parentElement
                    || group[0].parentElement;
                if (!container) continue;
                const options = group.map((control, index) => {
                    const input = control.matches('input[type="radio"],input[type="checkbox"]') ? control : control.querySelector('input[type="radio"],input[type="checkbox"]');
                    const label = input?.labels?.[0]
                        || (input?.id ? doc.querySelector(`[for="${CSS.escape(input.id)}"]`) : null)
                        || input?.closest('label')
                        || (control.matches('label') ? control : null);
                    const optionControl = label && input ? label : control;
                    const optionText = textOf(label) || textOf(control) || control.getAttribute('aria-label') || control.getAttribute('value') || '';
                    return {
                        index, input, control: optionControl, node: label || control,
                        text: optionText.replace(/\s+/g, ' ').trim(),
                        identityText: optionIdentity(label || control) || optionText.replace(/\s+/g, ' ').trim(),
                        isSelected: () => Boolean(input?.checked || optionControl.getAttribute('aria-checked') === 'true'),
                    };
                });
                if (options.some((option) => !option.text)) continue;
                const fieldset = container.closest('fieldset') || group[0].closest('fieldset');
                const radioGroup = group[0].closest('[role="radiogroup"]');
                const optionScope = fieldset || radioGroup || group[0].parentElement?.parentElement || container;
                const heading = [fieldset?.querySelector('legend'), radioGroup?.querySelector('h1,h2,h3,h4,[role="heading"]'),
                    container.querySelector?.('h1,h2,h3,h4,[role="heading"]')].find(node => node && readable(node));
                const localPrompt = [...optionScope.querySelectorAll('p,h1,h2,h3,h4,[role="heading"],div,span')]
                    .find(node => readable(node) && !node.matches(choiceSelector) && !node.querySelector(choiceSelector)
                        && !options.some(option => option.node.contains(node))
                        && textOf(node).length >= 12 && textOf(node).length <= 1200);
                let nearbyPrompt = '';
                for (let branch = optionScope; branch && branch !== doc.body && !nearbyPrompt; branch = branch.parentElement) {
                    for (let sibling = branch.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
                        const candidate = proseText(sibling);
                        if (candidate.length >= 20 && candidate.length <= 1200
                            && !sibling.matches(choiceSelector) && !sibling.querySelector(choiceSelector)
                            && !options.some(option => option.node === sibling || option.node.contains(sibling))) {
                            nearbyPrompt = candidate;
                            break;
                        }
                    }
                }
                const text = textOf(heading) || textOf(localPrompt) || labelledText(radioGroup) || labelledText(container)
                    || radioGroup?.getAttribute('aria-label') || container.getAttribute('aria-label') || nearbyPrompt;
                if (!text.trim()) continue;
                // Coding MCQs often render the code separately from the prose
                // question. Preserve that visible context before asking the AI.
                const questionRegion = optionScope.closest('[data-question],#generic-question-container,#exam-question-container,article,section,main')
                    || optionScope.parentElement;
                const promptRegion = [...(questionRegion?.querySelectorAll(promptSelector) || [])].find(node => {
                    if (node.querySelector(choiceSelector)) return false;
                    const prose = proseText(node);
                    return prose.length >= 12 && (prose.includes(text.trim()) || text.includes(prose));
                });
                const sourceRegion = promptRegion || questionRegion;
                const snippets = [...(sourceRegion?.querySelectorAll(codeSelector) || [])]
                    .filter(node => readable(node) && !node.parentElement?.closest(codeSelector)
                        && (!node.closest(promptSelector) || node.closest(promptSelector) === promptRegion));
                const codeText = node => {
                    const lines = [...node.querySelectorAll('.ace_line,.view-line,.CodeMirror-line')];
                    if (lines.length) return lines.map(line => line.textContent || '').join('\n');
                    const clone = node.cloneNode(true);
                    clone.querySelectorAll('.ace_gutter,.line-numbers,.linenumber,script,style').forEach(item => item.remove());
                    return (clone.textContent || '').trim();
                };
                let questionText;
                if (promptRegion) {
                    // Preserve filenames, prose and ALL snippets together; the
                    // last code block alone is not the question's full context.
                    const clone = promptRegion.cloneNode(true);
                    preserveMatrices(clone);
                    for (const block of clone.querySelectorAll('pre,.ace_editor,.CodeMirror,.monaco-editor')) {
                        const plain = doc.createElement('pre');
                        plain.textContent = '\n' + codeText(block) + '\n';
                        block.replaceWith(plain);
                    }
                    clone.querySelectorAll('button,input,textarea,script,style,.ace_gutter').forEach(node => node.remove());
                    questionText = (clone.textContent || '').trim();
                } else {
                    questionText = [text.trim(), ...snippets.map(codeText)].join('\n');
                }
                questionText = questionText.slice(0, 12000);
                const identityRegion = promptRegion?.cloneNode(true);
                identityRegion?.querySelectorAll('pre,code,.ace_editor,.CodeMirror,.monaco-editor,button,input,textarea,script,style').forEach(node => node.remove());
                const identityText = identityRegion ? textOf(identityRegion) : text.trim();
                radioCandidates.push({
                    text: questionText, identityText: identityText || text.trim(), options, visualRegion: sourceRegion,
                    selectionType: group[0].matches('input[type="checkbox"],[role="checkbox"]') ? 'multiple' : 'single',
                    form: container.matches('form') ? container : container.closest('form'), container: optionScope,
                });
            }
            if (radioCandidates.length === 1) return radioCandidates[0];
            if (radioCandidates.length > 1) {
                const unanswered = radioCandidates.find(candidate => !candidate.options.some(option => option.isSelected?.() || option.input?.checked));
                const active = unanswered || radioCandidates[0];
                const pageCopy = doc.body.cloneNode(true);
                pageCopy.querySelectorAll('#assistant-root,input,button,[role="button"],script,style').forEach(node => node.remove());
                return {
                    ...active,
                    type: 'compound-mcq',
                    compoundQuestions: radioCandidates,
                    compoundContext: textOf(pageCopy).slice(0, 12000),
                };
            }
            // Letter-badge cards (A, B, C...) do not always expose native
            // radios. Require a consecutive sibling group and an explicit
            // question region so palette numbers/navigation are never options.
            const cardGroups = new Map();
            for (const badge of doc.querySelectorAll('span,div,b,strong')) {
                if (!visible(badge) || badge.children.length || !/^[A-H]$/.test(textOf(badge))) continue;
                const card = badge.parentElement;
                if (!card || !visible(card) || card.closest('#assistant-root,nav,aside')
                    || card.querySelector('input') || textOf(card).length <= 1) continue;
                const group = card.parentElement;
                if (!cardGroups.has(group)) cardGroups.set(group, []);
                cardGroups.get(group).push({ badge, card });
            }
            const candidates = [];
            for (const [group, cards] of cardGroups) {
                if (cards.length < 2 || cards.length > 8
                    || !cards.every(({ badge }, index) => textOf(badge) === String.fromCharCode(65 + index))) continue;
                const region = group.closest('main,article,section,[data-question]') || group.parentElement;
                const heading = region?.querySelector('[data-question-text],h1,h2,h3,[role="heading"]');
                const preceding = cards[0].card.previousElementSibling || group.previousElementSibling;
                const prompt = textOf(heading) || textOf(preceding);
                if (prompt.length < 10 || prompt.length > 2000) continue;
                candidates.push({ text: prompt, selectionType: 'single', container: group, visualRegion: region,
                    options: cards.map(({ badge, card }, index) => {
                        const copy = card.cloneNode(true);
                        const savedMarkers = element => {
                            // React layouts may nest the autosave indicator in
                            // the answer wrapper instead of a third direct child.
                            const markers = [...element.querySelectorAll('span,small,em,div')]
                                .filter(node => !node.children.length && /^(?:saved|saving(?:\.{3}|…)?)$/i.test(textOf(node)));
                            const remaining = element.cloneNode(true);
                            for (const node of [...remaining.querySelectorAll('*')].reverse()) {
                                if ((!node.children.length && /^(?:saved|saving(?:\.{3}|…)?)$/i.test(textOf(node))) || textOf(node) === textOf(badge)) node.remove();
                            }
                            // An answer whose literal text is "Saved" is not
                            // itself a selection indicator.
                            return textOf(remaining) ? markers : [];
                        };
                        for (const marker of savedMarkers(copy)) marker.remove();
                        const letter = [...copy.children].find(node => textOf(node) === textOf(badge));
                        letter?.remove();
                        return { index, text: textOf(copy), node: card, control: card,
                            getSaveState: () => savedMarkers(card).some(node => visible(node) && /^saving/i.test(textOf(node))) ? 'saving'
                                : savedMarkers(card).some(node => visible(node) && /^saved$/i.test(textOf(node))) ? 'saved' : null,
                            isSelected: () => card.getAttribute('aria-checked') === 'true'
                                || card.getAttribute('aria-pressed') === 'true'
                                || card.getAttribute('data-selected') === 'true'
                                || /(?:^|\s)(?:selected|active|is-selected)(?:\s|$)/.test(card.className || '')
                                || savedMarkers(card).some(node => visible(node) && /^saved$/i.test(textOf(node))) };
                    }),
                });
            }
            if (candidates.length === 1 && candidates[0].options.every(option => option.text)) return candidates[0];
            // Short-answer practice questions have no option controls.
            const fields = [...doc.querySelectorAll('textarea:not(:disabled):not([readonly]),input[type="text"]:not(:disabled):not([readonly]),input[type="number"]:not(:disabled):not([readonly])')]
                .filter(field => visible(field) && /answer/i.test(`${field.getAttribute('placeholder') || ''} ${field.getAttribute('aria-label') || ''}`)
                    && !field.closest('.monaco-editor,.ace_editor,.CodeMirror'));
            if (fields.length === 1) {
                const input = fields[0];
                for (let region = input.parentElement; region && region !== doc.body; region = region.parentElement) {
                    const submits = [...region.querySelectorAll('button,[role="button"],input[type="submit"]')]
                        .filter(button => visible(button) && /^submit(?: answer)?$/i.test(textOf(button) || button.getAttribute('value') || button.getAttribute('aria-label') || ''));
                    const submit = submits.length === 1 ? submits[0] : null;
                    if (!submit) continue;
                    // CCBP's question body is separate from its changing skip
                    // countdown and feedback. Only the body identifies a question.
                    const promptRegion = region.querySelector('#generic-question-wrapper-id');
                    const clone = (promptRegion || region).cloneNode(true);
                    clone.querySelectorAll('textarea,input,button,[role="button"],script,style,[role="timer"],[class*="SkipButtonContainer"],[class*="TimerText"],#next-button-container').forEach(node => node.remove());
                    const prompt = textOf(clone);
                    if (prompt.length >= 15 && prompt.length <= 7000) return {
                        type: 'short-answer', text: prompt, options: [], input, submit, container: region, form: input.closest('form'),
                    };
                    // The answer/actions wrapper may be separate from the prompt.
                    // Keep walking until their common question container is found.
                }
            }
            return null;
        },
        getSubmit(_doc, question) {
            if (question.type === 'short-answer') {
                const button = question.submit;
                return button?.isConnected && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
            }
            const scope = question.form || question.container?.closest('fieldset,[role="group"],article,section,main') || question.container?.parentElement;
            const enabled = button => button.isConnected && button.getClientRects().length > 0
                && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.closest('#assistant-root');
            if (question.compoundQuestions) {
                if (question.compoundSubmit) return enabled(question.compoundSubmit) ? question.compoundSubmit : null;
                const buttons = question.compoundQuestions.map(group => this.getSubmit(_doc, group));
                return buttons[0] && buttons.every(button => button === buttons[0]) ? buttons[0] : null;
            }
            const explicitSubmits = [...(scope?.querySelectorAll('button[type="submit"],input[type="submit"],[role="button"][type="submit"]') || [])].filter(enabled);
            if (explicitSubmits.length) return explicitSubmits.length === 1 ? explicitSubmits[0] : null;
            const namedSubmit = [...(_doc.querySelectorAll('button:not(:disabled),[role="button"]:not([aria-disabled="true"])'))]
                .filter(enabled)
                .filter((button) => /^(submit|check answer|submit answer|verify answer|save\s*&\s*next|save and next)$/i.test((button.innerText || button.textContent || button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
            const local = namedSubmit.filter(button => scope?.contains(button));
            return local.length === 1 ? local[0] : local.length ? null : namedSubmit.length === 1 ? namedSubmit[0] : null;
        },
        getSubmittedAdvance(doc) {
            if (this.isSaving(doc)) return null;
            // CCBP renders this actions container only with the submitted
            // question's Next/Retry controls. An unrelated Next is insufficient.
            const candidates = [...doc.querySelectorAll('#default-question-next-button,#next-button-container button,#next-button-container [role="button"],[class*="SubmittedQuestionButtonsContainer"] button,[class*="SubmittedQuestionButtonsContainer"] [role="button"]')]
                .filter(button => button.getClientRects().length > 0 && !button.disabled
                    && button.getAttribute('aria-disabled') !== 'true' && !button.closest('#assistant-root')
                    && /^next$/i.test((button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim()));
            const unique = [...new Set(candidates)];
            return unique.length === 1 ? unique[0] : null;
        },
        getPracticeSkip(doc, question) {
            const anchor = question.form || question.container;
            if (!anchor) return null;
            const skips = [...doc.querySelectorAll('button,[role="button"]')].filter(button =>
                button.isConnected && button.getClientRects().length && !button.disabled
                && button.getAttribute('aria-disabled') !== 'true' && !button.closest('#assistant-root')
                && /^skip(?: question)?$/i.test((button.innerText || button.textContent || button.getAttribute('aria-label') || '').trim()));
            if (skips.length !== 1) return null;
            for (let scope = anchor; scope && scope !== doc.body; scope = scope.parentElement) {
                if (!scope.contains(skips[0])) continue;
                const submits = [...scope.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(button =>
                    button.getClientRects().length && !button.closest('#assistant-root')
                    && /^submit(?: answer)?$/i.test((button.innerText || button.textContent || button.value || button.getAttribute('aria-label') || '').trim()));
                if (submits.length === 1) return skips[0];
            }
            return null;
        },
        getBlockingReason(doc) {
            const expired = [...doc.querySelectorAll('p,span,div,h1,h2,h3,h4')].some(node =>
                node.getClientRects().length && !node.closest('#assistant-root') && !node.children.length
                && /^time['’]s up!\s*you cannot attempt this assessment now\.?$/i.test((node.innerText || node.textContent || '').trim()));
            return expired ? 'The portal says this assessment has expired. Start a new attempt in the portal before restarting automation.' : null;
        },
        isSaving(doc) {
            return [...doc.querySelectorAll('span,small,p,div')].some(node => !node.children.length
                && node.getClientRects().length && !node.closest('#assistant-root')
                && /^saving(?:\s*(?:\.{3}|…))?$/i.test((node.innerText || node.textContent || '').trim()));
        },
        getFinalQuizSubmit(doc) {
            if (this.isSaving(doc)) return null;
            const body = doc.body.cloneNode(true);
            body.querySelector('#assistant-root')?.remove();
            const text = (body.textContent || '').replace(/\s+/g, ' ');
            if (!/question palette/i.test(text)) return null;
            const current = text.match(/(\d+)\s*(?:of|\/)\s*(\d+)\s*questions/i);
            const answered = text.match(/(\d+)\s*Answered/i);
            const pending = text.match(/(\d+)\s*Pending/i);
            if (!current || !answered || !pending || Number(current[2]) <= 0
                || Number(current[1]) !== Number(current[2]) || Number(answered[1]) !== Number(current[2]) || Number(pending[1]) !== 0) return null;
            const actions = [...doc.querySelectorAll('button,[role="button"]')].filter(node => node.getClientRects().length
                && !node.closest('#assistant-root') && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
            const local = actions.filter(node => /^submit$/i.test((node.innerText || node.textContent || '').trim()));
            const quiz = actions.filter(node => /^submit quiz$/i.test((node.innerText || node.textContent || '').trim()));
            return local.length === 1 ? local[0] : local.length === 0 && quiz.length === 1 ? quiz[0] : null;
        },
        getQuizConfirmation(doc) {
            if (this.isSaving(doc)) return null;
            const dialogs = [...doc.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(node => node.getClientRects().length);
            for (const title of doc.querySelectorAll('h1,h2,h3,p,span,div')) {
                if (title.children.length || !title.getClientRects().length || !/^submit (?:quiz|assessment)\?$/i.test((title.textContent || '').trim())) continue;
                for (let scope=title.parentElement; scope && scope!==doc.body; scope=scope.parentElement) {
                    const buttons=[...scope.querySelectorAll('button,[role="button"]')];
                    if (buttons.some(node=>/^cancel$/i.test((node.textContent || '').trim()))
                        && buttons.some(node=>/^confirm submit$/i.test((node.textContent || '').trim()))) {dialogs.push(scope);break;}
                }
            }
            const choices = dialogs.filter(node => /(?:submit (?:the |your |this )?(?:quiz|assessment)|(?:quiz|assessment) submission)/i.test(node.textContent || ''))
                .flatMap(dialog => [...dialog.querySelectorAll('button,[role="button"]')].filter(node => node.getClientRects().length && !node.disabled
                    && /^(?:submit|submit quiz|confirm|confirm submit|yes,? submit)$/i.test((node.innerText || node.textContent || '').trim())));
            const unique = [...new Set(choices)];
            return unique.length === 1 ? unique[0] : null;
        },
        async applyOrder(doc, question, order, active, nativeDrag) {
            if (order.length !== question.options.length || new Set(order).size !== order.length
                || !order.every(index => Number.isInteger(index) && index >= 0 && index < question.options.length)) return false;
            if (question.dragKind === 'native-ccbp') {
                const desired = order.map(index => question.options[index].text);
                const read = () => this.getQuestion(doc);
                const delay = () => new Promise(resolve => setTimeout(resolve, 180));
                for (let position = 0; position < desired.length; position++) {
                    if (!active()) return false;
                    const current = read();
                    if (current?.dragKind !== 'native-ccbp' || current.text !== question.text || current.options.length !== desired.length) return false;
                    const from = current.options.findIndex(option => option.text === desired[position]);
                    if (from < 0) return false;
                    if (from === position) continue;
                    if (nativeDrag) {
                        const result = await nativeDrag(current.text, current.options.map(option => option.text), from, position);
                        if (!active() || !result?.ok) return false;
                        const moved = read();
                        if (moved?.text !== question.text || moved.options[position]?.text !== desired[position]) return false;
                        continue;
                    }
                    const source = current.options[from].node.querySelector('.drag-icon-container[draggable="true"]');
                    let target = current.options[position].node.querySelector('.drag-icon-container[draggable="true"]');
                    const transfer = new DataTransfer();
                    transfer.effectAllowed = 'move';
                    const send = (node, type) => {
                        const rect = node.getBoundingClientRect();
                        node.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer,
                            clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
                    };
                    send(source, 'dragstart');
                    try {
                        // React may commit the active dragged item on the next
                        // render. A synchronous drop can see the previous state.
                        await delay();
                        if (!active()) return false;
                        const started = read();
                        if (started?.text !== question.text || started.options.length !== desired.length) return false;
                        target = started.options.find(option => option.text === current.options[position].text)?.node.querySelector('.drag-icon-container[draggable="true"]');
                        if (!target) return false;
                        send(target, 'dragenter'); send(target, 'dragover'); await delay();
                        if (!active()) return false;
                        const hovered = read();
                        if (hovered?.text !== question.text) return false;
                        // Some handlers reorder on hover, others on drop.
                        target = hovered.options.find(option => option.text === current.options[position].text)?.node.querySelector('.drag-icon-container[draggable="true"]');
                        if (!target) return false;
                        send(target, 'drop');
                    } finally { send(source, 'dragend'); }
                    let moved = false;
                    for (let attempt = 0; attempt < 10 && active(); attempt++) {
                        await delay();
                        const updated = read();
                        if (updated?.text !== question.text) return false;
                        if (updated.options[position]?.text === desired[position]) { moved = true; break; }
                    }
                    if (!moved) return false;
                }
                const final = read();
                return active() && final?.text === question.text && final.options.length === desired.length
                    && final.options.every((option, index) => option.text === desired[index]);
            }
            const selector = '[data-rbd-draggable-id],[data-rfd-draggable-id]';
            const ids = () => [...doc.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => node.getAttribute('data-rbd-draggable-id') || node.getAttribute('data-rfd-draggable-id'));
            const desired = order.map(index => question.options[index].id);
            const delay = () => new Promise(resolve => setTimeout(resolve, 180));
            const press = (node, key, code, keyCode) => node.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }));
            for (let position = 0; position < desired.length; position++) {
                if (!active()) return false;
                const current = ids();
                const from = current.indexOf(desired[position]);
                if (from < 0 || current.length !== desired.length) return false;
                if (from === position) continue;
                const row = [...doc.querySelectorAll(selector)].find(node => (node.getAttribute('data-rbd-draggable-id') || node.getAttribute('data-rfd-draggable-id')) === desired[position]);
                const handle = row.matches('[data-rbd-drag-handle-draggable-id],[data-rfd-drag-handle-draggable-id]') ? row : row.querySelector('[data-rbd-drag-handle-draggable-id],[data-rfd-drag-handle-draggable-id]');
                if (!handle) return false;
                handle.focus(); press(handle, ' ', 'Space', 32); await delay();
                for (let step = from; step > position; step--) {
                    if (!active()) { press(handle, 'Escape', 'Escape', 27); return false; }
                    press(handle, 'ArrowUp', 'ArrowUp', 38); await delay();
                }
                press(handle, ' ', 'Space', 32); await delay();
                if (ids()[position] !== desired[position]) return false;
            }
            return ids().join('\n') === desired.join('\n');
        },
        getAdvance(doc) {
            const buttons = [...doc.querySelectorAll('button:not(:disabled),[role="button"]:not([aria-disabled="true"])')]
                .filter((button) => button.getClientRects().length > 0);
            const next = buttons.filter((button) => /^(next|continue)$/i.test((button.innerText || button.getAttribute('aria-label') || '').trim()));
            return next.length === 1 ? next[0] : null;
        },
        isWaitingForParticipants(doc) {
            const labels = [...doc.querySelectorAll('p,span,div,h1,h2,h3,h4')]
                .filter(node => node.getClientRects().length && !node.closest('#assistant-root') && !node.children.length)
                .map(node => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim());
            return labels.some(value => /^answer submitted[.!]?$/i.test(value))
                && labels.some(value => /^waiting for all students to submit[.!]?$/i.test(value));
        },
        getNextPractice(doc) {
            const actions = [...doc.querySelectorAll('a[href],button:not(:disabled),[role="button"]:not([aria-disabled="true"])')]
                .filter((element) => element.getClientRects().length > 0);
            const next = actions.filter((element) => /^(next practice|start next practice|continue to next practice)$/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()));
            return next.length === 1 ? next[0] : null;
        },
        getCompletionProceed(doc) {
            const actions = [...doc.querySelectorAll('a[href],button:not(:disabled),[role="button"]:not([aria-disabled="true"])')]
                .filter((element) => element.getClientRects().length > 0);
            const proceed = actions.filter((element) => /^proceed$/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()));
            return proceed.length === 1 ? proceed[0] : null;
        },
        getCurrentPracticeTitle(doc) {
            const match = (doc.body?.innerText || '').match(/MCQ\s+Practice\s*\|\s*[^\n]+/i);
            return match ? match[0].replace(/\s+/g, ' ').trim() : '';
        },
        getNextCoursePractice(doc, currentTitle) {
            const textOf = (element) => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
            const visible = (element) => element.getClientRects().length > 0;
            const candidates = [...doc.querySelectorAll('body *')]
                .filter((element) => visible(element) && /^MCQ\s+Practice\s*\|/i.test(textOf(element)))
                .filter((element) => ![...element.children].some((child) => /^MCQ\s+Practice\s*\|/i.test(textOf(child))));
            if (!candidates.length) return null;
            const normalizedCurrent = currentTitle.replace(/\s+/g, ' ').toLowerCase();
            const currentIndex = candidates.findIndex((element) => textOf(element).toLowerCase() === normalizedCurrent);
            return candidates[currentIndex >= 0 ? currentIndex + 1 : 0] || null;
        },
        getStartPractice(doc) {
            const actions = [...doc.querySelectorAll('a[href],button:not(:disabled),[role="button"]:not([aria-disabled="true"])')]
                .filter((element) => element.getClientRects().length > 0);
            const start = actions.filter((element) => /^start practice$/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()));
            return start.length === 1 ? start[0] : null;
        },
        // The course sidebar and instructions contain words such as
        // "completed", so whole-page text is not a reliable completion
        // signal. The runner instead advances only through getCompletionProceed.
        isComplete(doc) {
            return [...doc.querySelectorAll('p,span,div,h1,h2,h3,h4')].some(node => node.getClientRects().length
                && !node.closest('#assistant-root') && !node.children.length
                && /^(?:quiz completed|quiz ended|the quiz has ended|quiz submitted(?: successfully)?|assessment submitted(?: successfully)?)[.!]?$/i.test((node.innerText || node.textContent || '').trim()));
        },
    });

    window.BrowserAssistantAutomationPolicy = Object.freeze({
        resolveTarget, determineMode, canExecute,
        getAdapter(id) { return adapters.get(id) || null; },
        registerAdapter,
        get targets() { return targets.map((target) => ({ ...target })); },
    });
})();
