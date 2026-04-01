import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    typeAware: true,
  },
  plugins: ["typescript", "import", "unicorn", "react"],
  ignorePatterns: ["dist", "web/dist", "node_modules"],
  rules: {
    // Core
    "no-unused-vars": "error",
    "no-console": "error",
    eqeqeq: "error",
    "no-var": "error",
    "prefer-const": "error",
    "no-constant-binary-expression": "error",
    "no-await-in-loop": "error",
    "no-param-reassign": "error",
    "sort-imports": [
      "error",
      { ignoreDeclarationSort: true, memberSyntaxSortOrder: ["none", "all", "multiple", "single"] },
    ],

    // Import
    "import/no-duplicates": "error",
    "import/no-self-import": "error",
    "import/no-cycle": "error",
    "import/first": "error",
    "import/no-mutable-exports": "error",
    "import/no-commonjs": "error",
    "import/no-default-export": "error",

    // TypeScript
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-confusing-void-expression": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/no-unnecessary-type-arguments": "error",
    "typescript/no-unnecessary-type-constraint": "error",
    "typescript/no-unnecessary-boolean-literal-compare": "error",
    "typescript/no-unnecessary-template-expression": "error",
    "typescript/no-unsafe-type-assertion": "error",
    "typescript/no-import-type-side-effects": "error",
    "typescript/no-require-imports": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/consistent-type-imports": ["error", { prefer: "type-imports" }],
    "typescript/no-unused-vars": "error",

    // Unicorn
    "unicorn/prefer-node-protocol": "error",
    "unicorn/no-array-for-each": "error",
    "unicorn/prefer-number-properties": "error",
    "unicorn/prefer-array-find": "error",
    "unicorn/prefer-array-flat-map": "error",
    "unicorn/prefer-array-flat": "error",
    "unicorn/prefer-array-some": "error",
    "unicorn/prefer-includes": "error",
    "unicorn/prefer-string-slice": "error",
    "unicorn/prefer-string-replace-all": "error",
    "unicorn/prefer-at": "error",
    "unicorn/prefer-set-has": "error",
    "unicorn/prefer-date-now": "error",
    "unicorn/prefer-structured-clone": "error",
    "unicorn/prefer-optional-catch-binding": "error",
    "unicorn/prefer-top-level-await": "error",
    "unicorn/prefer-modern-math-apis": "error",
    "unicorn/prefer-type-error": "error",
    "unicorn/prefer-regexp-test": "error",
    "unicorn/prefer-logical-operator-over-ternary": "error",
    "unicorn/no-useless-promise-resolve-reject": "error",
    "unicorn/no-useless-undefined": "error",
    "unicorn/no-lonely-if": "error",
    "unicorn/no-negation-in-equality-check": "error",
    "unicorn/no-typeof-undefined": "error",
    "unicorn/throw-new-error": "error",
    "unicorn/error-message": "error",
    "unicorn/catch-error-name": "error",
    "unicorn/explicit-length-check": "error",
    "unicorn/no-instanceof-array": "error",
    "unicorn/no-null": "off",
    "unicorn/filename-case": ["error", { cases: { kebabCase: true, pascalCase: true } }],

    // React
    "react/jsx-no-target-blank": "error",
    "react/self-closing-comp": "error",
    "react/jsx-boolean-value": ["error", "never"],
    "react/exhaustive-deps": "error",
    "react/jsx-key": "error",
    "react/jsx-no-duplicate-props": "error",
    "react/jsx-no-constructed-context-values": "error",
    "react/no-array-index-key": "error",
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/__tests__/**"],
      rules: {
        "typescript/no-explicit-any": "off",
        "typescript/no-non-null-assertion": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "no-unused-vars": "off",
        "typescript/no-unused-vars": "off",
      },
    },
    {
      files: ["scripts/**"],
      rules: {
        "no-console": "off",
      },
    },
    {
      files: ["*.config.ts", "web/vite.config.ts", "vitest.config.ts"],
      rules: {
        "import/no-default-export": "off",
      },
    },
  ],
});
