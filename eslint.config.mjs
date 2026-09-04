import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "warn",
    // v2.1.0: previously-off safety rules, now enforced
    "@typescript-eslint/no-unused-vars": ["error", {
      args: "all",
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrors: "all",
      caughtErrorsIgnorePattern: "^_",
      destructuredArrayIgnorePattern: "^_",
    }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "error",

    // React rules
    "react-hooks/exhaustive-deps": "off",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules
    // v2.1.0: previously-off correctness rules, now enforced
    "prefer-const": ["error", { destructuring: "all" }],
    "no-debugger": "error",
    "no-unreachable": "error",
    "no-redeclare": "error",
    "no-useless-escape": "warn",
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-unused-vars": "off", // handled by @typescript-eslint/no-unused-vars
    "no-empty": ["warn", { allowEmptyCatch: true }],
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "error",
    // v2.1.0: downgraded to warn — 49 pre-existing cosmetic indentation issues
    // (mixed tabs+spaces, mostly tailwind.config.ts) are scheduled for a dedicated
    // formatting pass (prettier/editor-config). Not re-indenting by hand now.
    "no-mixed-spaces-and-tabs": "warn",
    "no-undef": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills"]
}];

export default eslintConfig;
