import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import unicornPlugin from "eslint-plugin-unicorn";
import stylistic from "@stylistic/eslint-plugin";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      import: importPlugin,
      unicorn: unicornPlugin,
      "@stylistic": stylistic,
    },
    rules: {
      //
      // TypeScript - Type-aware rules (require type information)
      //

      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/return-await": [
        "error",
        "error-handling-correctness-only",
      ],

      //
      // TypeScript - Regular rules
      //

      "@typescript-eslint/consistent-type-imports": [
        "error",
        { disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/method-signature-style": "error",
      "@typescript-eslint/no-empty-function": "off",

      //
      // ESLint core - Code quality
      //

      curly: ["error", "all"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-param-reassign": "error",
      "no-else-return": ["error", { allowElseIf: false }],
      "no-lonely-if": "error",
      "no-var": "error",
      "prefer-const": "error",
      "prefer-template": "error",
      "object-shorthand": "error",
      "prefer-arrow-callback": "error",
      "prefer-rest-params": "error",
      "prefer-object-spread": "error",
      "logical-assignment-operators": "error",
      "no-useless-concat": "error",
      "no-useless-computed-key": "error",
      "one-var": ["error", "never"],
      "operator-assignment": "error",
      radix: "error",

      //
      // Import - Organization
      //

      "import/extensions": ["error", "always", { ignorePackages: true }],
      "import/order": [
        "error",
        { groups: ["builtin", "external", "internal"] },
      ],
      "import/no-duplicates": "error",
      "import/first": "error",
      "import/consistent-type-specifier-style": "error",

      //
      // Unicorn - Modern JavaScript
      //

      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-at": "error",
      "unicorn/prefer-string-replace-all": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/no-useless-spread": "error",
      "unicorn/no-lonely-if": "error",
      "unicorn/no-typeof-undefined": "error",
      "unicorn/prefer-array-some": "error",

      //
      // Stylistic
      //

      "@stylistic/no-trailing-spaces": "error",
    },
  }
);
