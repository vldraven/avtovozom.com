# Commit Command

Use this workflow when the user asks to create a git commit.

1. Review the working tree:
   ```bash
   git status --short --branch
   git diff
   git log -5 --oneline
   ```

2. Stage only files related to the requested change. Do not stage local spreadsheets, `.env`, credentials, or unrelated user changes.

3. Commit with a concise conventional message:
   ```bash
   git commit -m "$(cat <<'EOF'
   fix(scope): concise summary

   EOF
   )"
   ```

4. Verify:
   ```bash
   git status --short --branch
   ```

5. Push only if the user explicitly asked for it:
   ```bash
   git push origin main
   ```

