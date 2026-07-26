import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import { globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config(
  globalIgnores([
    ".next/**",
    ".wrangler/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/pdf.worker.min.mjs",
    "public/pdfjs/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);

export default eslintConfig;
