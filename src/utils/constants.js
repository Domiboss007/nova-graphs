// Shared constants used by App.jsx and child chart components.
// Kept in a separate file to avoid circular import issues.

export const COMPANY_ORDER = [
  'ADEX', 'AMPERMETEO', 'ENERCAST', 'ENLITIA',
  'EUROWIND', 'FORESIA', 'METEOMATICS', 'SOLCAST', 'METEOLOGICA', 'OGRE',
];

// Deterministic 6-char alphanumeric anonymisation codes
export const COMPANY_CODES = {
  ADEX:        'A1X1K2',
  AMPERMETEO:  'P5R2M8',
  ENERCAST:    'E3T1W9',
  ENLITIA:     'N8L4A2',
  EUROWIND:    'W6U3D5',
  FORESIA:     'F4R9S1',
  METEOMATICS: 'M7T3X8',
  SOLCAST:     'S2C6L0',
  METEOLOGICA: 'G9O1C4',
  OGRE:        'O5G7R3',
};

// Companies excluded from anonymised aggregate charts
export const ANON_EXCLUDE = new Set(['METEOLOGICA', 'OGRE']);
