<?php

require_once __DIR__ . '/_control_schema.php';
require_once __DIR__ . '/_tenant_storage.php';

const LEHRFAHRER_MASTER_TEMPLATE_VERSION = 1;

function lehrfahrer_master_tenant_template(): array {
    return [
        'template_version' => LEHRFAHRER_MASTER_TEMPLATE_VERSION,
        'roles' => lehrfahrer_control_role_definitions(),
        'capabilities' => lehrfahrer_control_capability_definitions(),
        'system_settings' => [
            'locale' => 'de-DE',
            'time_zone' => 'Europe/Berlin',
            'display' => [
                'theme' => 'system',
                'show_operational_notes' => true,
            ],
            'operations' => [
                'dispatch_phone' => null,
            ],
        ],
        'feature_flags' => [
            'routes' => true,
            'drivers' => true,
            'trainings' => true,
            'packages' => true,
            'catalogs' => true,
            'gtfs_import' => true,
        ],
        'tenant_areas' => LEHRFAHRER_TENANT_AREAS,
    ];
}
