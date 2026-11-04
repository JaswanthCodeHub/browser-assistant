"""Compare supplied editor interfaces without executing generated code."""
import re
from tree_sitter_language_pack import get_parser

SUPPORTED = {'cpp', 'java', 'python', 'javascript'}
CLASSES = {'class_specifier', 'struct_specifier', 'class_declaration', 'class_definition'}
FUNCTIONS = {'function_definition', 'function_declaration', 'generator_function_declaration',
             'method_definition', 'method_declaration', 'constructor_declaration'}


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
    else:
        header = re.sub(r'/\*.*?\*/|//[^\n]*', '', header.decode('utf-8'), flags=re.DOTALL)
    return re.sub(r'\s+', '', header)


def interface(source, language):
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
    classes, functions = interface(starter, language)
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
    classes, functions = interface(starter, language)
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
