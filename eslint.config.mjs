import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "no-console": "error" } },
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
      "packages/db/generated/**",
      ".gitnexus/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/triple-slash-reference": "warn",
    },
  },
  { files: ["packages/db/src/seed.ts"], rules: { "no-console": "warn" } },
);
