// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // React Compiler rules (reactCompiler is on in app.json). They flag patterns this app uses deliberately:
      // useRef(new Animated.Value()) (React Native's animation pattern), Date.now() for live countdowns, and resetting
      // state when an input changes. The compiler skips optimising a component that breaks them, and that component
      // runs as normal React, so these are not bugs. Warnings, so they stay visible.
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Apostrophes in text render correctly.
      'react/no-unescaped-entities': 'off',
    },
  },
  { ignores: ['dist/*', 'dist-next/*', 'dist-old/*', 'dist-preview/*'] },
]);
