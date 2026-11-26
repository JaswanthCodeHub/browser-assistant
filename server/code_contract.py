"""Compare supplied editor interfaces without executing generated code."""
import re
from tree_sitter_language_pack import get_parser

SUPPORTED = {'cpp', 'java', 'python', 'javascript'}
CLASSES = {'class_specifier', 'struct_specifier', 'class_declaration', 'class_definition'}
FUNCTIONS = {'function_definition', 'function_declaration', 'generator_function_declaration',
             'method_definition', 'method_declaration', 'constructor_declaration'}

SAMPLE_HEADING = re.compile(r'(?im)^[ \t]*(?:#{1,6}[ \t]+)?Sample[ \t]+(Input|Output)'
                            r'(?:[ \t]+(\d+))?[ \t]*:?[ \t]*$')
SAMPLE_END = re.compile(r'(?im)^[ \t]*(?:#{1,6}[ \t]+)?(?:Explanation|Note|Constraints|Input Format|'
                        r'Output Format|Example)(?:[ \t]+\d+)?[ \t]*(?::[^\n]*)?$')


def coding_samples(text):
    """Read explicit, paired sample blocks while preserving significant spaces."""
    statement = text.replace('\r\n', '\n').split('\nCurrent code:\n', 1)[0]
    statement = statement.split('\nPreserve the required function signature and input/output format.', 1)[0]
    statement = statement.split('\n\nGenerate the complete app.js for the online Node.js IDE.', 1)[0]
    headings = list(SAMPLE_HEADING.finditer(statement))
    samples = []
    for index in range(0, len(headings) - 1, 2):
        start, output = headings[index:index + 2]
        if start[1].lower() != 'input' or output[1].lower() != 'output' or start[2] != output[2]:
            return []
        next_heading = headings[index + 2].start() if index + 2 < len(headings) else len(statement)
        input_text = SAMPLE_END.split(statement[start.end():output.start()], maxsplit=1)[0].strip('\n')
        expected = SAMPLE_END.split(statement[output.end():next_heading], maxsplit=1)[0].strip('\n')
        input_text, expected = (re.sub(r'\A```[^\n]*\n([\s\S]*)\n```\Z', r'\1', value)
                                for value in (input_text, expected))
        if not input_text or not expected:
            return []
        samples.append((input_text, expected))
    # Keep output traces within the compact review response budget.
    return samples if len(headings) == 2 * len(samples) and sum(len(output) for _, output in samples) <= 2000 else []


def function_header(node, data, language):
    """Compare C++ callable types without treating local parameter names as ABI."""
    body = node.child_by_field_name('body')
    end = body.start_byte if body else node.end_byte
    header = data[node.start_byte:end]
    if language == 'cpp':
        ignored = set()

        def inspect(child):
            if child.start_byte >= end:
                return
            if child.type == 'comment':
                ignored.add((child.start_byte, child.end_byte))
                return
            if child.type in {'parameter_declaration', 'optional_parameter_declaration'}:
                declarator = child.child_by_field_name('declarator')
                # Follow only the declarator chain: identifiers inside template
                # types, dimensions, defaults and qualifiers must remain checked.
                while declarator:
                    if declarator.type == 'identifier':
                        ignored.add((declarator.start_byte, declarator.end_byte))
                        break
                    nested = declarator.child_by_field_name('declarator')
                    if nested is None and declarator.type in {'reference_declarator', 'parenthesized_declarator'}:
                        nested = next((part for part in declarator.named_children
                                       if part.type != 'comment'), None)
                    declarator = nested
            for part in child.named_children:
                inspect(part)

        inspect(node)
        for start, stop in sorted(ignored, reverse=True):
            header = header[:start-node.start_byte] + header[stop-node.start_byte:]
        header = header.decode('utf-8')
    elif language == 'python':
        # Python comments between ':' and the first statement are not API.
        spans = []
        def comments(child):
            if child.type == 'comment' and child.start_byte < end:
                spans.append((child.start_byte, min(child.end_byte, end)))
            for part in child.named_children:
                comments(part)
        comments(node)
        for start, stop in sorted(spans, reverse=True):
            header = header[:start-node.start_byte] + header[stop-node.start_byte:]
        header = header.decode('utf-8')
    else:
        header = re.sub(r'/\*.*?\*/|//[^\n]*', '', header.decode('utf-8'), flags=re.DOTALL)
    return re.sub(r'\s+', '', header)


def prepare_starter(source, language):
    """Recover a C++ portal scaffold without repairing generated output."""
    if language != 'cpp':
        return source
    # An accidentally pasted Python program is not part of a C++ interface.
    if re.search(r'\b(?:class|struct)\s+\w+\s*\{', source):
        source = re.split(r'(?m)^def\s+\w+\s*\(', source, maxsplit=1)[0]
    data = source.encode('utf-8')
    root = get_parser('cpp').parse(data).root_node
    balance = 0
    def braces(node):
        nonlocal balance
        if node.type == '{' and not node.is_missing:
            balance += 1
        elif node.type == '}' and not node.is_missing:
            balance -= 1
        else:
            for child in node.children:
                braces(child)
    braces(root)
    if 0 < balance <= 8:
        source += '\n' + '\n'.join('}' for _ in range(balance)) + ';\n'
    return source


def interface(source, language, *, starter=False):
    if starter:
        source = prepare_starter(source, language)
    data = source.encode('utf-8')
    root = get_parser(language).parse(data).root_node
    classes, functions = set(), set()

    def value(node):
        return data[node.start_byte:node.end_byte].decode('utf-8') if node else ''

    def walk(node, owner=(), access=None):
        if node.type in CLASSES:
            name = value(node.child_by_field_name('name'))
            if not name:
                return
            scope = (*owner, name)
            classes.add(scope)
            body = node.child_by_field_name('body')
            visibility = 'private' if language == 'cpp' and node.type == 'class_specifier' else 'public'
            for child in body.named_children if body else []:
                if child.type == 'access_specifier':
                    visibility = value(child)
                else:
                    walk(child, scope, visibility)
            return
        if node.type in FUNCTIONS:
            body = node.child_by_field_name('body')
            if body:
                header = function_header(node, data, language)
                functions.add((owner, header, access if language == 'cpp' else None))
            return
        for child in node.named_children:
            walk(child, owner, access)

    walk(root)
    return classes, functions


def validate_starter_interface(code, starter, language):
    if not starter or language not in SUPPORTED:
        return
    classes, functions = interface(starter, language, starter=True)
    actual_classes, actual_functions = interface(code, language)
    missing_classes = classes - actual_classes
    if missing_classes:
        raise ValueError('Starter interface class name changed (case-sensitive): '
                         + ', '.join('.'.join(name) for name in sorted(missing_classes)))
    missing_functions = functions - actual_functions
    if missing_functions:
        raise ValueError('Starter interface function signature/access changed: '
                         + '; '.join(f'{".".join(owner)}::{header} ({access or "declared access"})'
                                     for owner, header, access in sorted(missing_functions))
                         + '. Generated interfaces: '
                         + ('; '.join(f'{".".join(owner)}::{header} ({access or "declared access"})'
                                      for owner, header, access in sorted(actual_functions)) or 'none'))
    if language == 'cpp' and (classes or functions):
        has_main = lambda items: any(not owner and re.search(r'^(?:int|signed(?:int)?|auto)main\(', header)
                                    for owner, header, _access in items)
        if not has_main(functions) and has_main(actual_functions):
            raise ValueError('Starter interface is function/class-only; do not add main()')


def normalize_starter_code(code, starter, language):
    """Remove one added C++ driver only when the complete required interface remains."""
    if language != 'cpp' or not starter:
        return code
    classes, functions = interface(starter, language, starter=True)
    if not (classes or functions) or any(not owner and re.search(r'^(?:int|signed(?:int)?|auto)main\(', header)
                                        for owner, header, _access in functions):
        return code
    data = code.encode('utf-8')
    root = get_parser('cpp').parse(data).root_node
    drivers = []
    for node in root.named_children:
        if node.type != 'function_definition':
            continue
        declarator = node.child_by_field_name('declarator')
        while declarator and declarator.type != 'function_declarator':
            declarator = declarator.child_by_field_name('declarator')
        name = declarator.child_by_field_name('declarator') if declarator else None
        if name and name.type == 'identifier' and data[name.start_byte:name.end_byte] == b'main':
            drivers.append(node)
    if len(drivers) != 1:
        return code
    driver = drivers[0]
    normalized = (data[:driver.start_byte] + b'\n' + data[driver.end_byte:]).decode('utf-8').strip()
    # A missing/renamed class or method cannot be hidden by removing the driver.
    validate_starter_interface(normalized, starter, language)
    return normalized
