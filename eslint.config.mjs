import globals from "globals";
import js from "@eslint/js";

export default [
	js.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.mocha,
			},
			ecmaVersion: 2021,
			sourceType: "module",
		},
		rules: {
			// Spacing
			"arrow-spacing": ["warn", { before: true, after: true }],
			"comma-spacing": "error",
			"keyword-spacing": "error",
			"space-before-blocks": "error",
			"space-before-function-paren": ["error", {
				anonymous: "ignore",
				named: "ignore",
				asyncArrow: "always",
			}],
			"space-in-parens": "error",
			"space-infix-ops": "error",
			"space-unary-ops": "error",
			"object-curly-spacing": ["error", "always"],

			// Braces - use 1tbs style (allows } else { on same line)
			"brace-style": ["error", "1tbs", { allowSingleLine: true }],
			curly: ["error", "multi-line", "consistent"],

			// Formatting
			"comma-dangle": ["error", "always-multiline"],
			"comma-style": "error",
			"dot-location": ["error", "property"],
			indent: ["error", "tab"],
			quotes: ["error", "single"],
			semi: ["error", "always"],
			"no-trailing-spaces": "error",
			"no-multiple-empty-lines": ["error", { max: 2, maxEOF: 1, maxBOF: 0 }],

			// Code quality
			"no-var": "error",
			"prefer-const": "error",
			"no-empty-function": "error",
			"no-floating-decimal": "error",
			"max-nested-callbacks": ["error", { max: 4 }],
			"max-statements-per-line": ["error", { max: 2 }],
			"spaced-comment": "error",
			yoda: "error",

			// Relaxed rules
			"no-console": "off",
			"no-inline-comments": "off",
			"no-lonely-if": "warn",
			"no-unused-vars": ["error", {
				argsIgnorePattern: "^_",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_|^err$",
			}],
			"no-shadow": ["error", { allow: ["err", "resolve", "reject"] }],
		},
	},
	{
		// Ignore patterns
		ignores: [
			"node_modules/**",
			"artifacts/**",
			"cache/**",
			"coverage/**",
			"typechain-types/**",
		],
	},
];
