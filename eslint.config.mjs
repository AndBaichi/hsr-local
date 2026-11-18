import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', '_attic/**', 'scripts/**', '*.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'react-hooks/exhaustive-deps': 'warn',
      // 现有代码大量使用「effect 内同步 setState 做加载/同步」的写法，
      // 这是项目既有架构（数据加载 effect），不按 React 19 新规则强拆。
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'no-useless-assignment': 'off',
    },
  },
);
