interface AssistantJournalTimer {
    path: string;
    deadline: number;
}

interface AssistantJournalReminderData {
    assistantJournalTimer?: AssistantJournalTimer;
    assistantJournalReminderConfig?: {url: string; token: string};
    [key: string]: unknown;
}

interface AssistantMessage {
    action: string;
    url?: string;
    path?: string;
    method?: string;
    body?: unknown;
    operation?: string;
    selector?: string;
    expected?: string;
    value?: string;
    prompt?: string;
    options?: string[];
    from?: number;
    to?: number;
    workspace?: string;
    token?: string;
    code?: string;
}

interface AssistantMessageResponse {
    ok?: boolean;
    status?: number;
    error?: string;
    dataUrl?: string;
    images?: string[];
    value?: string;
    sources?: string[];
    editorSources?: string[];
    found?: boolean;
    retry?: boolean;
    started?: boolean;
    alreadyPassed?: boolean;
    done?: boolean;
    passed?: boolean;
    submitted?: boolean;
    data?: {
        results?: string;
        provider?: string;
        language?: string;
        code_reviewed?: boolean;
        answer_verified?: boolean;
        items?: unknown[];
        groq_configured?: boolean;
        vision_question_context?: boolean;
        vision_batching?: boolean;
        detail?: string | { message?: string; errors?: string[] };
        message?: string;
    };
}

interface AssistantTarget {
    authorized: boolean;
    id?: string;
    adapter?: string;
    pageTypes?: string[];
    submitPolicy?: string;
}
interface AssistantContext {
    authorizationVerified: boolean;
    target: AssistantTarget;
    page: { type: string; authorized: boolean };
    mode?: string;
}
interface AssistantOnlineIdeQuestion {
    title: string;
    text: string;
    workspace: string;
    solved: boolean;
    button: HTMLElement;
}
interface AssistantBatch {
    title?: string;
    href?: string;
    [key: string]: unknown;
}
interface AssistantAutomationState {
    state: string;
    running: boolean;
    paused: boolean;
    runId: number;
    processed: Set<string>;
    deferredQuestions?: Set<string>;
    completed: number;
    error: string;
    currentSignature: string;
    targetId?: string;
    batch?: AssistantBatch;
    pendingNavigation?: boolean;
    codingQuestionText?: string;
}
interface AssistantJournalSession {
    path: string;
    mount(slot: HTMLElement): void;
    detach(): void;
    stop(): void;
    pause(): void;
    start(): void | Promise<void>;
    getState(): {
        state: string;
        completed: number;
        running?: boolean;
        paused?: boolean;
        message?: string;
        title?: string;
        submitting?: boolean;
    };
}
interface AssistantJournal extends Omit<AssistantJournalSession, 'path'> {
    current: AssistantJournalSession;
    opening: boolean;
    matches(): boolean;
    active?(): AssistantJournalSession;
}
interface AssistantAceEditor {
    getValue(): string;
    getReadOnly(): boolean;
    session?: { getValue(): string };
    setValue(code: string, position: number): void;
}
interface AssistantCodeMirror {
    getValue(): string;
    getOption(name: string): unknown;
    setValue(code: string): void;
}
interface AssistantMonacoModel {
    getValue(): string;
    getFullModelRange(): object;
    isDisposed?(): boolean;
    uri?: { toString(): string };
}
interface AssistantMonacoEditor {
    getDomNode(): HTMLElement;
    getModel(): AssistantMonacoModel;
    getOption(option: number): unknown;
    pushUndoStop(): void;
    executeEdits(source: string, edits: { range: object; text: string }[]): void;
}
interface AssistantEditorElement extends HTMLTextAreaElement {
    env?: { editor?: AssistantAceEditor };
    CodeMirror?: AssistantCodeMirror;
}
interface Window {
    BrowserAssistantAnswerRequests: {
        failure(response: AssistantMessageResponse): Error;
        temporary(error: Error): boolean;
        run(options): Promise<AssistantMessageResponse>;
    };
    BrowserAssistantAutomationPolicy: {
        resolveTarget(location: Location, doc: Document): Omit<AssistantTarget, 'authorized'>;
        determineMode(context: AssistantContext): string;
        canExecute(action: string, context: AssistantContext): boolean;
        getAdapter(id: string): any;
        registerAdapter(id, adapter): void;
        readonly targets: object[];
    };
    BrowserAssistantCoding: {
        getQuestion(doc: Document, location?: Location): any;
        getOnlineIdeQuestion(doc: Document, location?: Location): AssistantOnlineIdeQuestion;
        getSubmit(doc: Document, question?): HTMLElement;
        getResult(doc: Document): string;
        getFailureFeedback(doc: Document): string;
        getDescriptionTab(doc: Document): HTMLElement;
        getDetectionError(): string;
    };
    BrowserAssistantCodingBatch: {
        rows(doc: Document): any[];
        nextPage(doc: Document): HTMLElement;
        pageKey(doc: Document): string;
        pageRange(doc: Document): { start: number; end: number; total: number };
        getBackControl(doc: Document, listUrl: string): HTMLElement;
        getSaveBeforeLeaving(doc: Document): HTMLElement;
        matchesQuestion(candidate, question, listUrl?: string): boolean;
        courseFilterStep(doc: Document, step?: string): any;
    };
    BrowserAssistantQuestionVisuals: {
        nodes(question): Element[];
        fingerprint(question): string;
        capture(question, sendMessage): Promise<{images: string[]; fingerprint: string}>;
        requireBackend(apiRequest, imageCount?: number): Promise<void>;
    };
    BrowserAssistantJournal: AssistantJournal;
    BrowserAssistantJournalBusy?: boolean;
    BrowserAssistantJournalListShortcut?: boolean;
    BrowserAssistantJournalBoot?: boolean;
    monaco?: { editor?: {
        getEditors?(): AssistantMonacoEditor[];
        getModels?(): AssistantMonacoModel[];
        EditorOption?: { readOnly: number };
    } };
}

declare const module: { exports: unknown };
