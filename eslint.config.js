import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-*/**',
      'backups/**',
      'covers/**',
      'data/**',
      'themes/**',
      '*.min.js'
    ]
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' }
  }
];
