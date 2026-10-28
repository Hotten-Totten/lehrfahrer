<?php

// Compare the persisted route content, not JSON formatting or save bookkeeping.
function lehrfahrer_route_comparable_content(array $route): array {
    foreach (['savedAt', 'updatedAt', 'modifiedAt', 'forceOverwrite', 'mapView', 'bounds'] as $key) {
        unset($route[$key]);
    }
    if (isset($route['meta']) && is_array($route['meta'])) {
        foreach (['exportedAt', 'savedAt', 'updatedAt', 'modifiedAt', 'importedAt', 'formatVersion', 'source'] as $key) {
            unset($route['meta'][$key]);
        }
        if ($route['meta'] === []) unset($route['meta']);
    }
    return lehrfahrer_route_sort_content_keys($route);
}

function lehrfahrer_route_sort_content_keys(array $value): array {
    if (!array_is_list($value)) ksort($value, SORT_STRING);
    foreach ($value as $key => $item) {
        if (is_array($item)) $value[$key] = lehrfahrer_route_sort_content_keys($item);
    }
    return $value;
}

function lehrfahrer_route_content_change(array $existing, array $incoming): string {
    return lehrfahrer_route_comparable_content($existing) === lehrfahrer_route_comparable_content($incoming)
        ? 'UNCHANGED' : 'CHANGED';
}
