// Shared helpers for reasoning about episode identifiers that may include suffix letters.
'use strict';

function toEpisodeString(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}

function parseEpisodeId(raw) {
    const token = toEpisodeString(raw);
    const match = token.match(/^(\d+)([A-Za-z]+)?$/);
    if (!match) {
        return {
            raw: token,
            numeric: Number.NaN,
            suffix: '',
        };
    }

    return {
        raw: token,
        numeric: parseInt(match[1], 10),
        suffix: (match[2] || '').toLowerCase(),
    };
}

function compareEpisodeIds(left, right) {
    const a = parseEpisodeId(left);
    const b = parseEpisodeId(right);
    const aHasNumber = Number.isFinite(a.numeric);
    const bHasNumber = Number.isFinite(b.numeric);

    if (aHasNumber && bHasNumber) {
        if (a.numeric !== b.numeric) {
            return a.numeric - b.numeric;
        }

        if (a.suffix !== b.suffix) {
            if (!a.suffix) {
                return -1;
            }
            if (!b.suffix) {
                return 1;
            }
            return a.suffix.localeCompare(b.suffix);
        }

        return a.raw.localeCompare(b.raw);
    }

    if (aHasNumber) {
        return -1;
    }
    if (bHasNumber) {
        return 1;
    }

    return a.raw.localeCompare(b.raw);
}

function sortEpisodeIds(ids) {
    return [...ids].sort(compareEpisodeIds);
}

function compareSeasonEpisodeTuples(a, b) {
    if (a.season !== b.season) {
        return a.season - b.season;
    }
    return compareEpisodeIds(a.episode, b.episode);
}

module.exports = {
    compareEpisodeIds,
    compareSeasonEpisodeTuples,
    parseEpisodeId,
    sortEpisodeIds,
};
