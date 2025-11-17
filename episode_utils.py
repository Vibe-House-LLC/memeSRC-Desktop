import re

_EPISODE_TOKEN_PATTERN = re.compile(r'^(\d+)([A-Za-z]+)?$')


def _parse_episode_components(value):
    if value is None:
        return None

    text = str(value).strip()
    if not text:
        return None

    match = _EPISODE_TOKEN_PATTERN.match(text)
    if not match:
        return None

    digits = match.group(1)
    suffix = match.group(2).lower() if match.group(2) else ''
    return digits, suffix


def normalize_episode_id(value):
    components = _parse_episode_components(value)
    if not components:
        return None
    digits, suffix = components
    return f"{digits}{suffix}"


def episode_sort_key(value):
    components = _parse_episode_components(value)
    if not components:
        return (float('inf'), str(value).lower())

    digits, suffix = components
    return (int(digits), suffix, f"{digits}{suffix}")
